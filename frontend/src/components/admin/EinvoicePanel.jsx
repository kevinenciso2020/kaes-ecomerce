import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api.js'

export const EINVOICE_STATUS = {
  PENDING:  { label: 'Pendiente',  cls: 'pending' },
  SENT:     { label: 'Enviada (validando)', cls: 'processing' },
  ACCEPTED: { label: 'Validada DIAN', cls: 'delivered' },
  REJECTED: { label: 'Rechazada', cls: 'cancelled' },
  ERROR:    { label: 'Error de envío', cls: 'cancelled' },
}

const DOC_TYPES = { 13: 'C.C.', 22: 'C.E.', 31: 'NIT', 41: 'Pasaporte', 47: 'PEP', 48: 'PPT' }

export const buyerLabel = (order) => {
  if (!order.buyerDocType || !order.buyerDocNumber) return 'Consumidor final'
  const dv = order.buyerDocType === '31' && order.buyerDv ? `-${order.buyerDv}` : ''
  return `${order.buyerName} · ${DOC_TYPES[order.buyerDocType] ?? 'Doc.'} ${order.buyerDocNumber}${dv}`
}

export default function EinvoicePanel({ order, showToast }) {
  const [data, setData] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setError('')
      setData(await api.admin.einvoice(order.id))
    } catch (err) {
      setError(err.message || 'No se pudo cargar la facturación electrónica')
    }
  }, [order.id])

  useEffect(() => { load() }, [load, order.status])

  // La emisión es asíncrona: mientras haya algo en curso se consulta de nuevo
  // cada 3 s (máximo ~1 min) para mostrar el resultado sin recargar.
  const docsInFlight = data?.documents?.some((d) => ['PENDING', 'SENT'].includes(d.status) && !d.lastError)
  const awaitingFirst = data?.enabled && data.documents.length === 0 && ['CONFIRMED', 'CANCELLED', 'REFUNDED'].includes(order.status)
  const awaitingNote = data?.enabled && ['CANCELLED', 'REFUNDED'].includes(order.status) &&
    data.documents.some((d) => d.type === 'INVOICE' && d.status === 'ACCEPTED') && !data.documents.some((d) => d.type === 'CREDIT_NOTE')
  const [polls, setPolls] = useState(0)
  useEffect(() => { setPolls(0) }, [order.status])
  useEffect(() => {
    if (!(docsInFlight || awaitingFirst || awaitingNote) || polls >= 20) return
    const t = setTimeout(() => { setPolls((n) => n + 1); load() }, 3000)
    return () => clearTimeout(t)
  }, [docsInFlight, awaitingFirst, awaitingNote, polls, load])

  const run = async (docId, fn, okMessage) => {
    setBusyId(docId)
    try {
      const result = await fn()
      if (result?.documents) setData(result)
      if (okMessage) showToast?.({ type: 'success', message: okMessage })
    } catch (err) {
      showToast?.({ type: 'error', message: err.message || 'Error' })
    } finally {
      setBusyId(null)
    }
  }

  const docs = data?.documents ?? []

  return (
    <section className="detail-section einvoice-panel">
      <h3>Factura electrónica</h3>
      <p className="detail-sub">Facturar a: <strong>{buyerLabel(order)}</strong></p>

      {error && <p className="einvoice-error">{error}</p>}
      {data && !data.enabled && docs.length === 0 && (
        <p className="detail-sub">La facturación electrónica está apagada (EINVOICE_ENABLED). Las órdenes pagadas no se facturan automáticamente.</p>
      )}
      {data?.enabled && docs.length === 0 && (
        <p className="detail-sub">{order.paidAt ? 'Aún no se ha generado la factura.' : 'Se generará automáticamente cuando se apruebe el pago.'}</p>
      )}

      {docs.map((doc) => {
        const info = EINVOICE_STATUS[doc.status] ?? { label: doc.status, cls: '' }
        const canRetry = ['REJECTED', 'ERROR'].includes(doc.status)
        return (
          <div key={doc.id} className="einvoice-doc">
            <div className="einvoice-doc-header">
              <span className="detail-value">
                {doc.type === 'CREDIT_NOTE' ? 'Nota crédito' : 'Factura'} {doc.fullNumber || '(sin número)'}
              </span>
              <span className={`status-badge ${info.cls}`}>{info.label}</span>
              {doc.environment === '2' && <span className="status-badge pending">Habilitación</span>}
            </div>
            {doc.cufe && <p className="detail-sub einvoice-cufe" title={doc.cufe}>{doc.type === 'CREDIT_NOTE' ? 'CUDE' : 'CUFE'}: {doc.cufe}</p>}
            {doc.reason && <p className="detail-sub">Motivo: {doc.reason}</p>}
            {doc.status === 'ACCEPTED' && (
              <p className="detail-sub">{doc.emailedAt ? `Enviada al cliente el ${new Date(doc.emailedAt).toLocaleString('es-CO')}` : 'Pendiente de envío por correo al cliente'}</p>
            )}
            {doc.lastError && doc.status !== 'ACCEPTED' && (
              <pre className="einvoice-error">{doc.lastError}</pre>
            )}
            {doc.status === 'ERROR' && doc.nextAttemptAt && (
              <p className="detail-sub">Próximo reintento automático: {new Date(doc.nextAttemptAt).toLocaleString('es-CO')}</p>
            )}
            <div className="action-buttons">
              {doc.fullNumber && doc.cufe && (
                <>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busyId === doc.id}
                    onClick={() => run(doc.id, () => api.admin.downloadEinvoicePdf(doc.id))}>Descargar PDF</button>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busyId === doc.id}
                    onClick={() => run(doc.id, () => api.admin.downloadEinvoiceXml(doc.id))}>Descargar XML</button>
                </>
              )}
              {canRetry && (
                <button type="button" className="btn btn-primary btn-sm" disabled={busyId === doc.id}
                  onClick={() => run(doc.id, () => api.admin.retryEinvoice(doc.id), 'Documento reenviado a la DIAN')}>
                  {busyId === doc.id ? 'Reintentando…' : 'Reintentar'}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
