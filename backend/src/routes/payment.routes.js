import { Router } from 'express'

import express from "express";
import crypto from "crypto";
import { Preference, Payment } from "mercadopago";
import mpClient from "../config/mercadopago.js";
import wompi from "../config/wompi.js";
import { prisma } from "../config/prisma.js";
import { isAuth } from "../middleware/auth.middleware.js";
import { requireVerifiedEmail } from "../middleware/requireVerifiedEmail.middleware.js";
import { discountStock } from "../services/stock.service.js";
import { sendOrderConfirmation } from "../services/email.service.js";
import { logger } from "../config/logger.js";

const router = express.Router();

// ─────────────────────────────────────────
// POST /api/payments/create-preference
// Crea la preferencia de pago y devuelve la URL de checkout
// ─────────────────────────────────────────
router.post("/create-preference", isAuth, requireVerifiedEmail, async (req, res) => {
  try {
    const { orderId, items, payer } = req.body;

    // Validaciones básicas de seguridad
    if (!orderId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Datos de orden inválidos" });
    }

    if (!payer?.email) {
      return res.status(400).json({ error: "Email del comprador requerido" });
    }

    // Verificar que la orden existe en tu DB y pertenece al usuario
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    if (order.status !== "PENDING") {
      return res.status(400).json({ error: "Esta orden ya fue procesada" });
    }

    // Construir items desde la DB (no desde el cliente — seguridad)
    const mpItems = order.items.map((item) => ({
      id: item.productId.toString(),
      title: item.product.name,
      quantity: item.quantity,
      unit_price: parseFloat(item.product.price),
      currency_id: "COP",
      picture_url: item.product.imageUrl || undefined,
    }));

    const preference = new Preference(mpClient);

    const preferenceData = {
      items: mpItems,
      payer: {
        email: payer.email,
        name: payer.name || "",
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL}/checkout/success`,
        failure: `${process.env.FRONTEND_URL}/checkout/failure`,
        pending: `${process.env.FRONTEND_URL}/checkout/pending`,
      },
      auto_return: "approved",
      external_reference: orderId.toString(),
      notification_url: `${process.env.BACKEND_URL}/api/payments/webhook`,
      statement_descriptor: "KAES STORE",
      expires: true,
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // expira en 30 min
    };

    const result = await preference.create({ body: preferenceData });

    // Guardar el preference ID en la orden
    await prisma.order.update({
      where: { id: orderId },
      data: { mpPreferenceId: result.id },
    });

    return res.json({
      preferenceId: result.id,
      initPoint: result.init_point,         // URL producción
      sandboxInitPoint: result.sandbox_init_point, // URL sandbox (pruebas)
    });
  } catch (error) {
    req.log?.error({ err: error, orderId }, 'payment.mp.create_preference_failed');
    return res.status(500).json({ error: "Error procesando el pago" });
  }
});

// ─────────────────────────────────────────
// POST /api/payments/webhook
// MercadoPago notifica aquí el resultado del pago
// ─────────────────────────────────────────
router.post("/webhook", async (req, res) => {
  try {
    // 1. Verificar firma del webhook (seguridad anti-spoofing)
    const xSignature = req.headers["x-signature"];
    const xRequestId = req.headers["x-request-id"];

    if (!xSignature || !xRequestId) {
      req.log?.warn({ provider: 'mercadopago', reason: 'missing_signature' }, 'payment.webhook.signature_missing');
      return res.status(401).json({ error: "Firma requerida" });
    }

    // Parsear la firma de MP: "ts=...,v1=..."
    const parts = xSignature.split(",");
    const ts = parts.find((p) => p.startsWith("ts="))?.split("=")[1];
    const v1 = parts.find((p) => p.startsWith("v1="))?.split("=")[1];

    if (!ts || !v1) {
      return res.status(401).json({ error: "Formato de firma inválido" });
    }

    // Construir el string a firmar según docs de MP
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const queryId = req.query.id || "";
    const manifest = `id:${queryId};request-id:${xRequestId};ts:${ts};`;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.MP_WEBHOOK_SECRET)
      .update(manifest)
      .digest("hex");

    if (expectedSignature !== v1) {
      req.log?.warn({ provider: 'mercadopago', reason: 'invalid_signature' }, 'payment.webhook.signature_invalid');
      return res.status(401).json({ error: "Firma inválida" });
    }

    // 2. Procesar la notificación
    // req.body es un Buffer (express.raw en server.js); nunca aplicar JSON.stringify
    // sobre un Buffer o la firma nunca coincidirá.
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
    const notification = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;

    // MP solo nos interesa el evento "payment"
    if (notification.type !== "payment") {
      return res.sendStatus(200);
    }

    const paymentId = notification.data?.id;
    if (!paymentId) {
      return res.sendStatus(200);
    }

    // 3. Consultar el pago directamente a la API de MP (no confiar en el body del webhook)
    const paymentApi = new Payment(mpClient);
    const payment = await paymentApi.get({ id: paymentId });

    const orderId = payment.external_reference;
    const status = payment.status; // "approved", "rejected", "pending", etc.

    if (!orderId) {
      return res.sendStatus(200);
    }

    // 4. Actualizar el estado de la orden y crear/actualizar el pago en tu DB
    let newOrderStatus;
    let paymentStatus;

    switch (status) {
      case "approved":
        newOrderStatus = "CONFIRMED";
        paymentStatus = "COMPLETED";
        break;
      case "rejected":
        newOrderStatus = "CANCELLED";
        paymentStatus = "FAILED";
        break;
      case "pending":
      case "in_process":
        newOrderStatus = "PENDING";
        paymentStatus = "PENDING";
        break;
      default:
        newOrderStatus = "PENDING";
        paymentStatus = "PENDING";
    }

    // Actualizar orden
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: newOrderStatus,
        paidAt: status === "approved" ? new Date() : null,
      },
    });

    // Descontar stock solo si el pago fue aprobado
    if (status === "approved") {
      await discountStock(orderId);
      await sendOrderConfirmation(orderId);
    }

    // Crear o actualizar registro de Payment
    await prisma.payment.upsert({
      where: { orderId: orderId },
      create: {
        orderId: orderId,
        provider: "MERCADOPAGO",
        providerPaymentId: paymentId.toString(),
        status: paymentStatus,
        amount: parseFloat(payment.transaction_amount) || 0,
        currency: payment.currency_id || "COP",
      },
      update: {
        providerPaymentId: paymentId.toString(),
        status: paymentStatus,
        amount: parseFloat(payment.transaction_amount) || 0,
      },
    });

    req.log?.info({
      provider: 'mercadopago',
      orderId,
      paymentId,
      mpStatus: status,
      newOrderStatus,
      paymentStatus,
    }, 'payment.webhook.order_updated');

    // MP requiere 200 o reintenta por hasta 4 días
    return res.sendStatus(200);
  } catch (error) {
    req.log?.error({ err: error, provider: 'mercadopago' }, 'payment.webhook.processing_failed');
    // Retornar 200 igual para que MP no reintente indefinidamente en errores nuestros
    return res.sendStatus(200);
  }
});

// ─────────────────────────────────────────
// GET /api/payments/status/:orderId
// El frontend consulta si ya se aprobó el pago
// ─────────────────────────────────────────
router.get("/status/:orderId", isAuth, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        paidAt: true,
        total: true,
        userId: true,
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    if (order.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "No tienes acceso a esta orden" });
    }

    return res.json({ id: order.id, status: order.status, paidAt: order.paidAt, total: order.total });
  } catch (error) {
    req.log?.error({ err: error, orderId }, 'payment.status_lookup_failed');
    return res.status(500).json({ error: "Error consultando el pago" });
  }
});

// ─────────────────────────────────────────
// POST /api/payments/wompi/create-checkout
// Crea una transacción en Wompi y devuelve la URL de pago
// ─────────────────────────────────────────
router.post("/wompi/create-checkout", isAuth, requireVerifiedEmail, async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "orderId requerido" });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true, items: { include: { product: true } } },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    if (order.status !== "PENDING") {
      return res.status(400).json({ error: "Esta orden ya fue procesada" });
    }

    const acceptanceData = await wompi.getPresignedAcceptance();

    const amountInCents = Math.round(Number(order.total) * 100)
    const reference = `ORDER-${order.id}`
    const redirectUrl = `${process.env.FRONTEND_URL}/checkout/wompi-callback?orderId=${order.id}`

    const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1'
    const cleanedIp = clientIp.replace(/^::ffff:/, '')

    const transaction = await wompi.createTransaction({
      amountInCents,
      currency: 'COP',
      customerEmail: order.user.email,
      reference,
      acceptanceToken: acceptanceData.acceptance_token,
      acceptPersonalAuth: acceptanceData.accept_personal_auth,
      paymentMethod: { type: 'CARD' },
      paymentMethodType: 'CARD',
      redirectUrl,
      ip: cleanedIp,
    })

    await prisma.order.update({
      where: { id: orderId },
      data: { mpPreferenceId: transaction.id },
    })

    return res.json({
      transactionId: transaction.id,
      paymentLink: transaction.redirect_url,
    })
  } catch (error) {
    req.log?.error({ err: error, orderId }, 'payment.wompi.create_checkout_failed')
    return res.status(500).json({ error: "Error al crear el pago" })
  }
})

// ─────────────────────────────────────────
// POST /api/payments/wompi/webhook
// Wompi notifica aquí el resultado del pago
// ─────────────────────────────────────────
router.post("/wompi/webhook", async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
    const event = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;

    if (event.event !== "transaction.updated") {
      return res.sendStatus(200)
    }

    const wompiId        = req.headers["x-wompi-event-id"]
    const wompiTimestamp = req.headers["x-wompi-timestamp"]
    const wompiSignature = req.headers["x-wompi-signature"]

    if (!wompiId || !wompiTimestamp || !wompiSignature) {
      req.log?.warn({ provider: 'wompi', reason: 'missing_signature' }, 'payment.webhook.signature_missing')
      return res.status(401).json({ error: "Firma requerida" })
    }

    const bodyString = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
    const manifest  = `${wompiId}.${wompiTimestamp}.${bodyString}`

    const expectedSignature = crypto
      .createHmac("sha256", process.env.WOMPI_WEBHOOK_SECRET)
      .update(manifest)
      .digest("hex")

    // timingSafeEqual requiere buffers de igual longitud — si difieren, rechazar
    // sin throw. También eliminar el bloque "basic length check fallback" muerto.
    const expectedBuffer = Buffer.from(expectedSignature, "utf8")
    const receivedBuffer = Buffer.from(wompiSignature, "utf8")

    if (expectedBuffer.length !== receivedBuffer.length) {
      req.log?.warn({ provider: 'wompi', reason: 'invalid_signature_length' }, 'payment.webhook.signature_invalid')
      return res.status(401).json({ error: "Firma inválida" })
    }

    if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      req.log?.warn({ provider: 'wompi', reason: 'invalid_signature' }, 'payment.webhook.signature_invalid')
      return res.status(401).json({ error: "Firma inválida" })
    }

    const transaction = event.data.object
    const transactionId = transaction.id
    const status = transaction.status

    const reference = transaction.reference
    const orderId = reference.replace('ORDER-', '')

    let newOrderStatus
    let paymentStatus

    switch (status) {
      case "APPROVED":
        newOrderStatus = "CONFIRMED"
        paymentStatus = "COMPLETED"
        break
      case "DECLINED":
        newOrderStatus = "CANCELLED"
        paymentStatus = "FAILED"
        break
      case "PENDING":
      case "PROCESSING":
        newOrderStatus = "PENDING"
        paymentStatus = "PENDING"
        break
      default:
        newOrderStatus = "PENDING"
        paymentStatus = "PENDING"
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: newOrderStatus,
        paidAt: status === "APPROVED" ? new Date() : null,
      },
    })

    // Descontar stock solo si el pago fue aprobado
    if (status === "APPROVED") {
      await discountStock(orderId)
      await sendOrderConfirmation(orderId)
    }

    await prisma.payment.upsert({
      where: { orderId: orderId },
      create: {
        orderId: orderId,
        provider: "WOMPI",
        providerPaymentId: transactionId,
        status: paymentStatus,
        amount: transaction.amount_in_cents / 100,
        currency: transaction.currency || "COP",
      },
      update: {
        providerPaymentId: transactionId,
        status: paymentStatus,
        amount: transaction.amount_in_cents / 100,
      },
    })

    req.log?.info({
      provider: 'wompi',
      orderId,
      transactionId,
      wompiStatus: status,
      newOrderStatus,
      paymentStatus,
    }, 'payment.webhook.order_updated')

    return res.sendStatus(200)
  } catch (error) {
    req.log?.error({ err: error, provider: 'wompi' }, 'payment.webhook.processing_failed')
    return res.sendStatus(200)
  }
})

// ─────────────────────────────────────────
// GET /api/payments/wompi/acceptance-token
// Devuelve el token de aceptación para el frontend (Widget)
// ─────────────────────────────────────────
router.get("/wompi/acceptance-token", async (req, res) => {
  try {
    const acceptanceData = await wompi.getPresignedAcceptance()
    return res.json(acceptanceData)
  } catch (error) {
    req.log?.error({ err: error }, 'payment.wompi.acceptance_token_failed')
    return res.status(500).json({ error: "Error obteniendo token" })
  }
})

export default router;