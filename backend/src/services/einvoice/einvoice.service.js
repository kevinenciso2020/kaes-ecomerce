// Orquestación de la facturación electrónica: encolar, numerar, generar, firmar,
// enviar a la DIAN, interpretar la respuesta, entregar al cliente y reintentar.
//
// Estados de ElectronicDocument:
//   PENDING  → por enviar (o reintentar tras un error de red / configuración)
//   SENT     → enviado en habilitación (asíncrono); se consulta con GetStatusZip
//   ACCEPTED → validado por la DIAN (inmutable; se corrige con nota crédito)
//   REJECTED → la DIAN lo rechazó; requiere corregir y "Reintentar" desde el admin
//   ERROR    → falló el envío; se reintenta con backoff hasta MAX_ATTEMPTS
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { logger } from '../../config/logger.js'
import { captureError } from '../../config/sentry.js'
import { sendElectronicInvoice, sendEinvoiceAlert } from '../email.service.js'
import { getConfig, isEnabled } from './config.js'
import { computeInvoiceAmounts, formatMoney } from './amounts.js'
import { computeCufe, computeCude, softwareSecurityCode, qrUrl } from './cufe.js'
import { buildInvoiceXml, buildCreditNoteXml, buildAttachedDocument, normalizeBuyer } from './ubl-builder.js'
import { signUblXml, colombiaDateTime } from './signer.js'
import { createDianClient, dianFileName, zipBase64, DianSoapError } from './dian-client.js'
import { resolveLocation } from './divipola.js'
import { renderPdf } from './pdf.js'
import { zipSync, strToU8 } from 'fflate'

const log = logger.child({ component: 'einvoice' })

export const MAX_ATTEMPTS = 10
const LEASE_MS = 5 * 60 * 1000
const DUPLICATE_RULE = /procesado anteriormente|Regla:\s*90\b/i

// Inyectable en pruebas.
let clientFactory = createDianClient
export const __setDianClientFactory = (factory) => { clientFactory = factory ?? createDianClient }

const backoffMs = (attempts) => Math.min(6 * 3600_000, 5 * 60_000 * 2 ** Math.max(0, attempts - 1))

// ── Encolar ──────────────────────────────────────────────────────────────────

/** Crea (si no existe) la factura PENDING de una orden pagada. No hace nada si está apagado. */
export const enqueueInvoice = async (orderId, { db = prisma } = {}) => {
  if (!isEnabled()) return null
  const existing = await db.electronicDocument.findUnique({ where: { orderId_type: { orderId, type: 'INVOICE' } } })
  if (existing) return existing
  try {
    return await db.electronicDocument.create({ data: { orderId, type: 'INVOICE', status: 'PENDING', nextAttemptAt: new Date() } })
  } catch (err) {
    if (err.code === 'P2002') return db.electronicDocument.findUnique({ where: { orderId_type: { orderId, type: 'INVOICE' } } })
    throw err
  }
}

/**
 * Crea la nota crédito de anulación de una orden facturada (cancelada o reembolsada).
 * Si la orden no tiene factura (p. ej. pagada antes de activar la facturación) no hace nada.
 */
export const enqueueCreditNote = async (orderId, reason, { db = prisma } = {}) => {
  if (!isEnabled()) return null
  const invoice = await db.electronicDocument.findUnique({ where: { orderId_type: { orderId, type: 'INVOICE' } } })
  if (!invoice) return null
  const existing = await db.electronicDocument.findUnique({ where: { orderId_type: { orderId, type: 'CREDIT_NOTE' } } })
  if (existing) return existing
  try {
    return await db.electronicDocument.create({
      data: { orderId, type: 'CREDIT_NOTE', status: 'PENDING', referenceId: invoice.id, reason: reason || 'Anulación de factura electrónica', nextAttemptAt: new Date() },
    })
  } catch (err) {
    if (err.code === 'P2002') return db.electronicDocument.findUnique({ where: { orderId_type: { orderId, type: 'CREDIT_NOTE' } } })
    throw err
  }
}

/** Encola y procesa en segundo plano (no bloquea la respuesta ni el webhook). */
export const triggerInvoice = (orderId) => {
  if (!isEnabled()) return
  enqueueInvoice(orderId)
    .then((doc) => doc && doc.status === 'PENDING' && processDocument(doc.id))
    .catch((err) => log.error({ err, orderId }, 'einvoice.trigger_failed'))
}

export const triggerCreditNote = (orderId, reason) => {
  if (!isEnabled()) return
  enqueueCreditNote(orderId, reason)
    .then((doc) => doc && doc.status === 'PENDING' && processDocument(doc.id))
    .catch((err) => log.error({ err, orderId }, 'einvoice.credit_note_trigger_failed'))
}

// ── Numeración ───────────────────────────────────────────────────────────────

/** Toma el siguiente consecutivo del prefijo con bloqueo de fila (sin huecos). */
export const nextSequence = async (tx, prefix, start) => {
  await tx.$executeRaw`INSERT INTO "invoice_sequences" ("prefix", "next", "updatedAt") VALUES (${prefix}, ${start}, NOW()) ON CONFLICT ("prefix") DO NOTHING`
  const rows = await tx.$queryRaw`SELECT "next" FROM "invoice_sequences" WHERE "prefix" = ${prefix} FOR UPDATE`
  const value = Number(rows[0].next)
  await tx.$executeRaw`UPDATE "invoice_sequences" SET "next" = ${value + 1}, "updatedAt" = NOW() WHERE "prefix" = ${prefix}`
  return value
}

const assignNumber = async (doc, config) => {
  if (doc.number != null) return doc
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "electronic_documents" WHERE "id" = ${doc.id} FOR UPDATE`
    const fresh = await tx.electronicDocument.findUnique({ where: { id: doc.id } })
    if (fresh.number != null) return fresh
    const isInvoice = doc.type === 'INVOICE'
    const prefix = isInvoice ? config.resolution.prefix : config.creditNotePrefix
    const number = await nextSequence(tx, prefix, isInvoice ? config.resolution.from : 1)
    if (isInvoice && number > config.resolution.to) {
      const err = new Error(`Se agotó el rango de numeración autorizado (${config.resolution.prefix} ${config.resolution.from}-${config.resolution.to}). Solicita una nueva resolución a la DIAN.`)
      err.code = 'EINVOICE_RANGE_EXHAUSTED'
      throw err
    }
    return tx.electronicDocument.update({
      where: { id: doc.id },
      data: { prefix, number, fullNumber: `${prefix}${number}`, issuedAt: new Date(), environment: config.environment },
    })
  }, { timeout: 15_000 })
}

// ── Construcción del documento ───────────────────────────────────────────────

const ORDER_INCLUDE = {
  items: { include: { product: { select: { name: true, slug: true, taxRate: true } } } },
  user: { select: { email: true, name: true } },
  shippingAddress: true,
}

const describeItem = (item) => {
  const variant = [item.size, item.color].filter(Boolean).join(' / ')
  return `${item.product.name}${variant ? ` — ${variant}` : ''}`
}

export const buyerFromOrder = (order) => {
  const addr = order.shippingAddress
  const location = addr ? resolveLocation(addr.departamento || addr.department, addr.municipio || addr.city) : null
  if (addr && !location) log.warn({ orderId: order.id, departamento: addr.departamento, municipio: addr.municipio }, 'einvoice.location_unresolved')
  return normalizeBuyer({
    docType: order.buyerDocType,
    docNumber: order.buyerDocNumber,
    dv: order.buyerDv,
    name: order.buyerName,
    personType: order.buyerPersonType,
    email: order.user?.email,
    location: location ? { ...location, postalZone: addr.zipCode || null } : null,
    addressLine: addr?.street ?? null,
  })
}

export const amountsFromOrder = (order, config) =>
  computeInvoiceAmounts({
    items: order.items.map((i) => ({
      description: describeItem(i),
      code: i.variantSnapshot?.sku || i.product.slug || i.productId,
      quantity: i.quantity,
      unitPrice: i.price,
      taxRate: i.taxRate ?? i.product.taxRate ?? 0,
    })),
    discount: order.discount,
    shipping: order.shipping,
    shippingTaxRate: config.shippingTaxRate,
    total: order.total,
  })

const buildSignedDocument = async (doc, config) => {
  const order = await prisma.order.findUnique({ where: { id: doc.orderId }, include: ORDER_INCLUDE })
  const invoice = doc.type === 'CREDIT_NOTE' ? await prisma.electronicDocument.findUnique({ where: { id: doc.referenceId } }) : null
  // El adquiriente se congela en la primera generación; la nota crédito usa el de su factura.
  const buyer = doc.buyerSnapshot ?? invoice?.buyerSnapshot ?? buyerFromOrder(order)
  const amounts = amountsFromOrder(order, config)
  const { date: issueDate, time: issueTime } = colombiaDateTime(doc.issuedAt)
  const isInvoice = doc.type === 'INVOICE'
  const keyFields = {
    number: doc.fullNumber,
    issueDate,
    issueTime,
    lineExtension: formatMoney(amounts.totals.lineExtension),
    taxIva: formatMoney(amounts.totals.taxTotal),
    payable: formatMoney(amounts.totals.payable),
    supplierNit: config.issuer.nit,
    customerId: buyer.docNumber,
    environment: config.environment,
  }
  const cufe = isInvoice
    ? computeCufe({ ...keyFields, technicalKey: config.resolution.technicalKey })
    : computeCude({ ...keyFields, softwarePin: config.software.pin })
  const base = {
    fullNumber: doc.fullNumber,
    issueDate,
    issueTime,
    cufe,
    orderId: order.id,
    note: `Pedido ${order.id}`,
    securityCode: softwareSecurityCode(config.software.id, config.software.pin, doc.fullNumber),
    qr: qrUrl(config.environment, cufe),
  }

  let xml
  if (isInvoice) {
    xml = buildInvoiceXml({ config, doc: base, buyer, amounts })
  } else {
    xml = buildCreditNoteXml({
      config,
      buyer,
      amounts,
      doc: { ...base, reason: doc.reason, invoice: { fullNumber: invoice.fullNumber, cufe: invoice.cufe, issueDate: colombiaDateTime(invoice.issuedAt).date } },
    })
  }
  const signed = signUblXml(xml, config.cert)

  const year = Number(issueDate.slice(0, 4))
  const fileSeq = await prisma.$transaction((tx) => nextSequence(tx, `__archivos_${year}`, 1))
  const kind = isInvoice ? 'fv' : 'nc'
  return {
    signed,
    cufe,
    buyer,
    fileName: dianFileName({ kind, nit: config.issuer.nit, providerCode: config.software.providerCode, year, sequence: fileSeq }),
    zipName: dianFileName({ kind: 'z', nit: config.issuer.nit, providerCode: config.software.providerCode, year, sequence: fileSeq, ext: 'zip' }),
  }
}

// ── Proceso ──────────────────────────────────────────────────────────────────

const notLocked = (now) => ({ OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] })

/**
 * Reclama el documento con un bloqueo temporal (lockedUntil) para que el job, el
 * disparo inmediato y el reintento manual nunca lo procesen a la vez. Si el
 * proceso muere a mitad, el bloqueo expira solo a los 5 minutos.
 */
const claim = async (id) => {
  const now = new Date()
  const res = await prisma.electronicDocument.updateMany({
    where: {
      id,
      status: { in: ['PENDING', 'ERROR', 'SENT'] },
      AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, notLocked(now)],
    },
    data: { lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
  })
  return res.count === 1
}

const release = (id) => prisma.electronicDocument.updateMany({ where: { id }, data: { lockedUntil: null } })

const summarize = (r) => ({
  isValid: r.isValid,
  statusCode: r.statusCode,
  statusDescription: r.statusDescription,
  statusMessage: r.statusMessage,
  errors: r.errors,
  receivedAt: new Date().toISOString(),
})

/**
 * Procesa un documento: numera, genera, firma y envía (o consulta su estado si
 * ya fue enviado en habilitación). Nunca lanza: registra el resultado en la fila.
 */
export const processDocument = async (id) => {
  if (!(await claim(id))) return null
  try {
    return await processClaimed(id)
  } finally {
    await release(id).catch((err) => log.error({ err, id }, 'einvoice.release_failed'))
  }
}

const processClaimed = async (id) => {
  let doc = await prisma.electronicDocument.findUnique({ where: { id } })

  try {
    const config = getConfig()
    const client = clientFactory({ environment: config.environment, cert: config.cert })

    if (doc.type === 'CREDIT_NOTE') {
      const invoice = await prisma.electronicDocument.findUnique({ where: { id: doc.referenceId } })
      const invoiceDead = invoice?.status === 'REJECTED' || (invoice?.status === 'ERROR' && !invoice.nextAttemptAt)
      if (invoiceDead) {
        // No se reintenta sola: se reactiva cuando la factura quede validada (markAccepted).
        const problem = `la factura ${invoice.fullNumber ?? ''} que anula no está validada por la DIAN (${invoice.status === 'REJECTED' ? 'rechazada' : 'con error'}). Corrígela y reintenta la factura primero.`
        sendEinvoiceAlert({ fullNumber: doc.fullNumber, orderId: doc.orderId, type: doc.type, problem }).catch(() => {})
        return prisma.electronicDocument.update({
          where: { id },
          data: { status: 'ERROR', nextAttemptAt: null, lastError: `No se puede emitir: ${problem}` },
        })
      }
      if (invoice?.status !== 'ACCEPTED') {
        // Espera a que la factura quede validada antes de anularla.
        return prisma.electronicDocument.update({
          where: { id },
          data: { status: 'PENDING', attempts: { decrement: 1 }, nextAttemptAt: new Date(Date.now() + 10 * 60_000), lastError: 'Esperando que la factura referenciada sea validada por la DIAN' },
        })
      }
    }

    // Habilitación: el documento ya fue enviado, solo se consulta el estado.
    if (doc.status === 'SENT' && doc.trackId) {
      const [result] = await client.getStatusZip(doc.trackId)
      return applyDianResult(doc, result, config)
    }

    doc = await assignNumber(doc, config)

    if (!doc.xmlSigned) {
      const built = await buildSignedDocument(doc, config)
      doc = await prisma.electronicDocument.update({
        where: { id },
        data: { xmlSigned: built.signed, cufe: built.cufe, fileName: built.fileName, buyerSnapshot: built.buyer },
      })
      doc.zipName = built.zipName
    }
    const zipName = doc.zipName ?? doc.fileName.replace(/^(fv|nc)/, 'z').replace(/\.xml$/, '.zip')
    const content = zipBase64(doc.fileName, doc.xmlSigned)

    if (config.environment === '2') {
      const { zipKey, errors } = await client.sendTestSetAsync(zipName, content, config.software.testSetId)
      if (!zipKey) {
        return markRejected(doc, { isValid: false, statusCode: null, statusDescription: 'Envío rechazado', errors })
      }
      log.info({ id, fullNumber: doc.fullNumber, zipKey }, 'einvoice.test_set_sent')
      return prisma.electronicDocument.update({
        where: { id },
        data: { status: 'SENT', trackId: zipKey, nextAttemptAt: new Date(Date.now() + 60_000), lastError: null },
      })
    }

    const result = await client.sendBillSync(zipName, content)
    return applyDianResult(doc, result, config, client)
  } catch (err) {
    return markError(doc, err)
  }
}

const applyDianResult = async (doc, result, config, client) => {
  if (result.isValid) return markAccepted(doc, result, config)

  // Reenvío de un documento que la DIAN ya tiene: se consulta su estado real.
  if (result.errors.some((e) => DUPLICATE_RULE.test(e)) && doc.cufe) {
    const c = client ?? clientFactory({ environment: config.environment, cert: config.cert })
    const status = await c.getStatus(doc.cufe)
    if (status.isValid) return markAccepted(doc, status, config)
  }

  // Habilitación: la DIAN todavía está validando el ZIP.
  if (doc.status === 'SENT' && !result.isValid && (!result.statusCode || /proceso de validaci/i.test(result.statusDescription ?? ''))) {
    return prisma.electronicDocument.update({
      where: { id: doc.id },
      data: { attempts: { decrement: 1 }, nextAttemptAt: new Date(Date.now() + 2 * 60_000) },
    })
  }

  return markRejected(doc, result)
}

const markAccepted = async (doc, result, config) => {
  const updated = await prisma.electronicDocument.update({
    where: { id: doc.id },
    data: {
      status: 'ACCEPTED',
      dianResponse: summarize(result),
      applicationResponse: result.applicationResponse ?? null,
      lastError: null,
      nextAttemptAt: null,
    },
  })
  log.info({ id: doc.id, orderId: doc.orderId, fullNumber: doc.fullNumber, type: doc.type }, 'einvoice.accepted')
  await deliverDocument(updated, config).catch((err) => log.error({ err, id: doc.id }, 'einvoice.delivery_failed'))
  if (doc.type === 'INVOICE') {
    // Notas crédito que esperaban (o se detuvieron por) esta factura: se reactivan.
    const woken = await prisma.electronicDocument.updateMany({
      where: { referenceId: doc.id, status: { in: ['PENDING', 'ERROR'] } },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    })
    if (woken.count) log.info({ id: doc.id, count: woken.count }, 'einvoice.credit_notes_woken')
  }
  return updated
}

const markRejected = async (doc, result) => {
  const updated = await prisma.electronicDocument.update({
    where: { id: doc.id },
    data: {
      status: 'REJECTED',
      dianResponse: summarize(result),
      lastError: result.errors?.join('\n') || result.statusDescription || 'Rechazado por la DIAN',
      nextAttemptAt: null,
    },
  })
  log.error({ id: doc.id, orderId: doc.orderId, fullNumber: doc.fullNumber, errors: result.errors }, 'einvoice.rejected')
  captureError(new Error(`Documento electrónico rechazado por la DIAN: ${doc.fullNumber}`), { orderId: doc.orderId, errors: result.errors })
  sendEinvoiceAlert({ fullNumber: doc.fullNumber, orderId: doc.orderId, type: doc.type, problem: 'la DIAN lo rechazó.', errors: result.errors ?? [] }).catch(() => {})
  return updated
}

const markError = async (doc, err) => {
  const attempts = doc?.attempts ?? 1
  const configProblem = err.code === 'EINVOICE_CONFIG' || err.code === 'EINVOICE_RANGE_EXHAUSTED'
  // Todo se reintenta (red, DIAN caída, cortes de la base de datos…) salvo los
  // errores que la DIAN atribuye al cliente (SOAP Fault "Sender").
  const retryable = !(err instanceof DianSoapError && err.retryable === false)
  const giveUp = attempts >= MAX_ATTEMPTS || !retryable
  const updated = await prisma.electronicDocument.update({
    where: { id: doc.id },
    data: {
      status: 'ERROR',
      lastError: err.message?.slice(0, 2000) ?? String(err),
      nextAttemptAt: giveUp ? null : new Date(Date.now() + (configProblem ? 3600_000 : backoffMs(attempts))),
    },
  })
  log.error({ err, id: doc.id, orderId: doc.orderId, attempts, giveUp }, 'einvoice.error')
  if (giveUp || attempts === 1) {
    captureError(err, { orderId: doc.orderId, einvoiceId: doc.id })
    sendEinvoiceAlert({
      fullNumber: doc.fullNumber,
      orderId: doc.orderId,
      type: doc.type,
      problem: giveUp ? `no se pudo enviar después de ${attempts} intentos: ${err.message}` : `falló el envío (se reintentará): ${err.message}`,
    }).catch(() => {})
  }
  return updated
}

// ── Entrega al cliente ───────────────────────────────────────────────────────

const validatedAt = (doc) => (doc.status === 'ACCEPTED' && doc.dianResponse?.receivedAt ? new Date(doc.dianResponse.receivedAt) : null)
export const MAX_DELIVERY_ATTEMPTS = 5

export const buildDeliveryFiles = async (doc, config) => {
  const order = await prisma.order.findUnique({ where: { id: doc.orderId }, include: ORDER_INCLUDE })
  const buyer = doc.buyerSnapshot ?? buyerFromOrder(order)
  // Fecha real de validación de la DIAN (no la última modificación de la fila).
  const now = colombiaDateTime(validatedAt(doc) ?? new Date())
  const { date: issueDate, time: issueTime } = colombiaDateTime(doc.issuedAt)
  const attached = signUblXml(
    buildAttachedDocument({
      config,
      doc: { fullNumber: doc.fullNumber, issueDate, issueTime, cufe: doc.cufe, type: doc.type },
      buyer,
      signedXml: doc.xmlSigned,
      applicationResponse: doc.applicationResponse ?? doc.dianResponse?.applicationResponse ?? '',
      validation: { date: now.date, time: now.time },
    }),
    config.cert,
  )
  const adName = doc.fileName.replace(/^(fv|nc)/, 'ad')
  const zipName = doc.fileName.replace(/^(fv|nc)/, 'z').replace(/\.xml$/, '.zip')
  const pdf = await renderPdf(doc.xmlSigned, { validatedAt: validatedAt(doc) })
  const zip = Buffer.from(zipSync({ [adName]: strToU8(attached), [`${doc.fullNumber}.pdf`]: new Uint8Array(pdf) }))
  return { order, buyer, pdf, zip, zipName }
}

/** Envía el correo al adquiriente. Devuelve true si salió. */
const deliverDocument = async (doc, config) => {
  if (doc.emailedAt) return true
  const { order, pdf, zip, zipName } = await buildDeliveryFiles(doc, config)
  const ok = await sendElectronicInvoice({
    to: order.user?.email,
    name: order.buyerName || order.user?.name,
    fullNumber: doc.fullNumber,
    isCreditNote: doc.type === 'CREDIT_NOTE',
    orderId: order.id,
    zipFileName: zipName,
    zipBuffer: zip,
    pdfBuffer: pdf,
  })
  await prisma.electronicDocument.update({
    where: { id: doc.id },
    data: ok ? { emailedAt: new Date() } : { deliveryAttempts: { increment: 1 } },
  })
  return ok
}

// ── Job y acciones del admin ─────────────────────────────────────────────────

/** Paso del job de mantenimiento: procesa pendientes y reenvía correos fallidos. */
export const processPending = async ({ limit = 20 } = {}) => {
  if (!isEnabled()) return { processed: 0, delivered: 0 }
  const now = new Date()
  const due = await prisma.electronicDocument.findMany({
    where: { status: { in: ['PENDING', 'ERROR', 'SENT'] }, nextAttemptAt: { lte: now } },
    orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true },
  })
  for (const { id } of due) await processDocument(id)

  let delivered = 0
  const undelivered = await prisma.electronicDocument.findMany({
    where: {
      status: 'ACCEPTED',
      emailedAt: null,
      deliveryAttempts: { lt: MAX_DELIVERY_ATTEMPTS },
      // Espera 10 min desde el último intento (cada intento fallido toca updatedAt).
      updatedAt: { lte: new Date(now.getTime() - 10 * 60_000) },
      ...notLocked(now),
    },
    take: limit,
    select: { id: true },
  })
  if (undelivered.length) {
    const config = getConfig()
    for (const { id } of undelivered) {
      const lock = await prisma.electronicDocument.updateMany({
        where: { id, emailedAt: null, ...notLocked(new Date()) },
        data: { lockedUntil: new Date(Date.now() + LEASE_MS) },
      })
      if (lock.count !== 1) continue
      try {
        const doc = await prisma.electronicDocument.findUnique({ where: { id } })
        if (await deliverDocument(doc, config)) delivered++
      } catch (err) {
        log.error({ err, id }, 'einvoice.delivery_retry_failed')
      } finally {
        await release(id)
      }
    }
  }
  return { processed: due.length, delivered }
}

const notFound = (msg) => Object.assign(new Error(msg), { status: 404 })
const conflict = (msg) => Object.assign(new Error(msg), { status: 409 })

/** Reintento manual desde el admin (tras corregir datos o configuración). */
export const retryDocument = async (id) => {
  const doc = await prisma.electronicDocument.findUnique({ where: { id } })
  if (!doc) throw notFound('Documento electrónico no encontrado')
  if (!['REJECTED', 'ERROR', 'PENDING'].includes(doc.status)) {
    throw conflict('Solo se pueden reintentar documentos rechazados o con error')
  }
  const now = new Date()
  const res = await prisma.electronicDocument.updateMany({
    where: { id, status: doc.status, ...notLocked(now) },
    data: {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: now,
      // Tras un rechazo se regenera el XML (mismo número) con los datos corregidos.
      ...(doc.status === 'REJECTED'
        ? { xmlSigned: null, cufe: null, trackId: null, issuedAt: now, ...(doc.type === 'INVOICE' ? { buyerSnapshot: Prisma.DbNull } : {}) }
        : {}),
    },
  })
  if (res.count !== 1) throw conflict('El documento se está procesando en este momento. Intenta de nuevo en unos minutos.')
  await processDocument(id)
  return getDocumentsForOrder(doc.orderId)
}

const PUBLIC_FIELDS = {
  id: true, orderId: true, type: true, status: true, fullNumber: true, cufe: true, environment: true,
  issuedAt: true, attempts: true, lastError: true, nextAttemptAt: true, emailedAt: true, reason: true,
  dianResponse: true, createdAt: true, updatedAt: true,
}

export const getDocumentsForOrder = async (orderId) => {
  const docs = await prisma.electronicDocument.findMany({ where: { orderId }, select: PUBLIC_FIELDS, orderBy: { createdAt: 'asc' } })
  return {
    enabled: isEnabled(),
    documents: docs,
  }
}

export const getDocumentXml = async (id) => {
  const doc = await prisma.electronicDocument.findUnique({ where: { id }, select: { xmlSigned: true, fileName: true } })
  if (!doc?.xmlSigned) throw notFound('El documento aún no tiene XML')
  return { xml: doc.xmlSigned, fileName: doc.fileName }
}

export const getDocumentPdf = async (id) => {
  const doc = await prisma.electronicDocument.findUnique({ where: { id } })
  if (!doc?.xmlSigned) throw notFound('El documento aún no tiene XML')
  const pdf = await renderPdf(doc.xmlSigned, { validatedAt: validatedAt(doc) ?? undefined })
  return { pdf, fileName: `${doc.fullNumber}.pdf` }
}

/** PDF de la factura para el cliente dueño de la orden (solo si fue validada). */
export const getCustomerInvoicePdf = async (userId, orderId) => {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true } })
  if (!order) throw notFound('Orden no encontrada')
  const doc = await prisma.electronicDocument.findUnique({ where: { orderId_type: { orderId, type: 'INVOICE' } } })
  if (!doc || doc.status !== 'ACCEPTED') throw notFound('La factura electrónica de esta orden aún no está disponible')
  return getDocumentPdf(doc.id)
}
