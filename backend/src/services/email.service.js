import { emailTransporter } from '../config/email.js'
import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'

const log = logger.child({ component: 'email' })

const FROM_NAME = 'KAES STORE'
const FROM_EMAIL = process.env.SMTP_FROM_EMAIL || 'noreply@kaesstore.com'

const formatPrice = (price) => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(price)
}

export const sendOrderConfirmation = async (orderId) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { name: true, email: true } },
        items: { include: { product: true } },
        payment: true,
      },
    })

    if (!order) {
      log.error({ orderId }, 'email.order_not_found')
      return false
    }

    const orderNumber = order.id.slice(-8).toUpperCase()
    const itemsHtml = order.items
      .map(
        (item) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #eee;">
            <strong>${item.product.name}</strong>
            ${item.size && item.color ? `<br><small style="color: #666;">Talla: ${item.size} / Color: ${item.color}</small>` : ''}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">${formatPrice(item.price)}</td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">${formatPrice(item.price * item.quantity)}</td>
        </tr>
      `
      )
      .join('')

    const statusText = {
      PENDING: 'Pendiente',
      CONFIRMED: 'Confirmado',
      PROCESSING: 'Procesando',
      SHIPPED: 'Enviado',
      DELIVERED: 'Entregado',
      CANCELLED: 'Cancelado',
    }[order.status] || order.status

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
    <div style="background: #1a1a1a; color: white; padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">${FROM_NAME}</h1>
    </div>
    
    <div style="padding: 24px;">
      <h2 style="color: #333; margin-top: 0;">¡Tu pedido está confirmado! 🎉</h2>
      <p style="color: #666;">Hola <strong>${order.user.name}</strong>,</p>
      <p style="color: #666;">Gracias por tu compra. Tu pedido ha sido confirmado y está siendo procesado.</p>
      
      <div style="background: #f9f9f9; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Número de pedido:</strong> #${orderNumber}</p>
        <p style="margin: 8px 0 0 0;"><strong>Estado:</strong> <span style="color: #22c55e; font-weight: bold;">${statusText}</span></p>
      </div>
      
      <h3 style="color: #333; margin-bottom: 12px;">Detalles del pedido</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Producto</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd;">Cant.</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Precio</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding: 12px; text-align: right; font-weight: bold; border-top: 2px solid #ddd;">Total:</td>
            <td style="padding: 12px; text-align: right; font-weight: bold; font-size: 18px; color: #1a1a1a; border-top: 2px solid #ddd;">${formatPrice(order.total)}</td>
          </tr>
        </tfoot>
      </table>
      
      <div style="margin-top: 24px; padding: 16px; background: #f0f9ff; border-radius: 8px; border-left: 4px solid #0ea5e9;">
        <p style="margin: 0; color: #333;">
          <strong>💡 ¿Tienes preguntas?</strong><br>
          Contáctanos respondiendo este email o visitando nuestra tienda.
        </p>
      </div>
    </div>
    
    <div style="background: #f5f5f5; padding: 16px; text-align: center; font-size: 12px; color: #999;">
      <p style="margin: 0;">© ${new Date().getFullYear()} ${FROM_NAME}. Todos los derechos reservados.</p>
    </div>
  </div>
</body>
</html>
    `.trim()

    const result = await emailTransporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: order.user.email,
      subject: `Tu pedido #${orderNumber} ha sido confirmado - ${FROM_NAME}`,
      html: htmlContent,
    })

    log.info({ orderId, to: order.user.email, messageId: result.messageId }, 'email.order_confirmation_sent')
    return true
  } catch (error) {
    log.error({ err: error, orderId }, 'email.order_confirmation_failed')
    return false
  }
}

export const sendOrderCancelled = async (orderId) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: { select: { name: true, email: true } } },
    })

    if (!order) {
      return false
    }

    const orderNumber = order.id.slice(-8).toUpperCase()

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
    <div style="background: #dc2626; color: white; padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">${FROM_NAME}</h1>
    </div>
    
    <div style="padding: 24px;">
      <h2 style="color: #333;">Tu pedido ha sido cancelado</h2>
      <p style="color: #666;">Hola <strong>${order.user.name}</strong>,</p>
      <p style="color: #666;">Tu pedido #${orderNumber} ha sido cancelado. Si realizaste el pago, el reembolso será procesado según las políticas de tu método de pago.</p>
      <p style="color: #666;">Si tienes alguna pregunta, contáctanos respondiendo este email.</p>
    </div>
    
    <div style="background: #f5f5f5; padding: 16px; text-align: center; font-size: 12px; color: #999;">
      <p style="margin: 0;">© ${new Date().getFullYear()} ${FROM_NAME}. Todos los derechos reservados.</p>
    </div>
  </div>
</body>
</html>
    `.trim()

    await emailTransporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: order.user.email,
      subject: `Tu pedido #${orderNumber} ha sido cancelado - ${FROM_NAME}`,
      html: htmlContent,
    })

    log.info({ orderId, to: order.user.email }, 'email.order_cancellation_sent')
    return true
  } catch (error) {
    log.error({ err: error, orderId }, 'email.order_cancellation_failed')
    return false
  }
}

export const sendVerificationEmail = async (user, verificationToken) => {
  try {
    const verificationUrl = `${process.env.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`
    const expiresInHours = 24

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
    <div style="background: #1a1a1a; color: white; padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">${FROM_NAME}</h1>
    </div>
    
    <div style="padding: 24px;">
      <h2 style="color: #333; margin-top: 0;">¡Bienvenido a ${FROM_NAME}! 👋</h2>
      <p style="color: #666;">Hola <strong>${user.name}</strong>,</p>
      <p style="color: #666;">Gracias por crear tu cuenta. Para empezar a comprar y acceder a todas las funciones, necesitamos confirmar tu correo electrónico.</p>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="${verificationUrl}" style="display: inline-block; background: #1a1a1a; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Verificar mi correo
        </a>
      </div>
      
      <div style="background: #f9f9f9; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; color: #666; font-size: 14px;">
          Este enlace expira en <strong>${expiresInHours} horas</strong>. Si no solicitaste esta cuenta, puedes ignorar este mensaje.
        </p>
      </div>
      
      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; margin: 0;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:
        </p>
        <p style="color: #666; font-size: 12px; word-break: break-all; margin: 8px 0 0 0;">
          ${verificationUrl}
        </p>
      </div>
    </div>
    
    <div style="background: #f5f5f5; padding: 16px; text-align: center; font-size: 12px; color: #999;">
      <p style="margin: 0;">© ${new Date().getFullYear()} ${FROM_NAME}. Todos los derechos reservados.</p>
    </div>
  </div>
</body>
</html>
    `.trim()

    const result = await emailTransporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: user.email,
      subject: `Verifica tu correo - ${FROM_NAME}`,
      html: htmlContent,
    })

    log.info({ to: user.email, messageId: result.messageId }, 'email.verification_sent')
    return true
  } catch (error) {
    log.error({ err: error, to: user.email }, 'email.verification_failed')
    return false
  }
}

export const sendPasswordResetEmail = async (user, code) => {
  try {
    const expiresInMinutes = 10

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
    <div style="background: #1a1a1a; color: white; padding: 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">${FROM_NAME}</h1>
    </div>

    <div style="padding: 24px;">
      <h2 style="color: #333; margin-top: 0;">Restablece tu contraseña 🔒</h2>
      <p style="color: #666;">Hola <strong>${user.name}</strong>,</p>
      <p style="color: #666;">Recibimos una solicitud para restablecer la contraseña de tu cuenta. Usa el siguiente código de 6 dígitos para continuar:</p>

      <div style="text-align: center; margin: 32px 0;">
        <div style="display: inline-block; background: #f9f9f9; border: 2px dashed #1a1a1a; border-radius: 12px; padding: 20px 32px; letter-spacing: 12px; font-family: 'Courier New', monospace; font-size: 36px; font-weight: bold; color: #1a1a1a;">
          ${code}
        </div>
      </div>

      <p style="color: #666; text-align: center; margin: 0 0 16px;">
        Ingresa este código en la página de recuperación para crear una nueva contraseña.
      </p>

      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 12px 16px; margin: 20px 0;">
        <p style="margin: 0; color: #92400e; font-size: 14px;">
          ⏱️ Este código expira en <strong>${expiresInMinutes} minutos</strong>. Si no solicitaste este cambio, puedes ignorar este mensaje — tu contraseña seguirá siendo la misma.
        </p>
      </div>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; margin: 0;">
          Por seguridad, nunca pedimos tu contraseña por correo, teléfono o redes sociales.
        </p>
      </div>
    </div>

    <div style="background: #f5f5f5; padding: 16px; text-align: center; font-size: 12px; color: #999;">
      <p style="margin: 0;">© ${new Date().getFullYear()} ${FROM_NAME}. Todos los derechos reservados.</p>
    </div>
  </div>
</body>
</html>
    `.trim()

    const result = await emailTransporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: user.email,
      subject: `Código para restablecer tu contraseña - ${FROM_NAME}`,
      html: htmlContent,
    })

    log.info({ to: user.email, messageId: result.messageId }, 'email.password_reset_sent')
    return true
  } catch (error) {
    log.error({ err: error, to: user.email }, 'email.password_reset_failed')
    return false
  }
}