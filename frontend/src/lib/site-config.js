/**
 * Datos centralizados del sitio. Editar aquí para actualizar todas las páginas.
 * Mantener sincronizado con el backend si hay info que también viaja en emails.
 */

const EMAIL_CONFIG = {
  host: import.meta.env.PUBLIC_SMTP_HOST || 'smtp.gmail.com',
  fromEmail: import.meta.env.PUBLIC_SMTP_FROM_EMAIL || 'noreply@kaesstore.com',
}

export const SITE_CONFIG = {
  name:        'Kaes Store',
  legalName:   'Kaes Store',
  brandName:   'KAES',
  tagline:     'Moda que te define',
  description: 'Tienda de ropa online. Ropa con personalidad y estilo atemporal.',

  // Datos legales — usados en páginas /legal/* y emails
  nit:         '[NIT]',
  address:     '[DIRECCIÓN]',
  city:        '[CIUDAD]',
  department:  '[DEPARTAMENTO]',
  country:     'Colombia',
  email:       '[EMAIL_CONTACTO]',
  phone:       '[TELÉFONO]',
  whatsapp:    '[TELÉFONO]',

  // Horarios de atención
  schedule: {
    weekdays: 'Lunes a viernes: 9:00 a.m. – 6:00 p.m.',
    saturday: 'Sábados: 10:00 a.m. – 2:00 p.m.',
    sunday:   'Domingos: cerrado',
  },

  // Redes sociales — dejar vacío para ocultar
  social: {
    instagram: '[INSTAGRAM_URL]',
    facebook:  '[FACEBOOK_URL]',
    tiktok:    '[TIKTOK_URL]',
  },

  // Última actualización de textos legales
  legalUpdatedAt: '[FECHA_ACTUALIZACION]',

  // Plazo de cambios por talla/color (días calendario desde la entrega).
  // Se usa en la ficha de producto y en la política de devoluciones: deben
  // decir lo mismo (Ley 1480, información veraz). Confirma el número.
  exchangeDays: 30,

  // Días hábiles para despachar un pedido y días para reportar un defecto
  // de fabricación (garantía). Decisión de negocio: llénalos.
  processingDays: '[NÚMERO]',
  warrantyNoticeDays: '[NÚMERO]',

  // Email remitente del sistema (para "From:" en correos que envía el sitio)
  ...EMAIL_CONFIG,
}

// Campos con "[...]" que aún no se han llenado. Las páginas legales muestran
// un aviso visible mientras existan (ver components/ui/LegalPlaceholderNotice).
export const MISSING_LEGAL_FIELDS = Object.entries({
  nit: SITE_CONFIG.nit,
  address: SITE_CONFIG.address,
  city: SITE_CONFIG.city,
  department: SITE_CONFIG.department,
  email: SITE_CONFIG.email,
  phone: SITE_CONFIG.phone,
  legalUpdatedAt: SITE_CONFIG.legalUpdatedAt,
  processingDays: SITE_CONFIG.processingDays,
  warrantyNoticeDays: SITE_CONFIG.warrantyNoticeDays,
}).filter(([, v]) => typeof v === 'string' && /^\[.*\]$/.test(v)).map(([k]) => k)

export const CONTACT_TOPICS = {
  general:  'Consulta general',
  order:    'Consulta sobre un pedido',
  product:  'Información de un producto',
  change:   'Cambio o devolución',
  other:    'Otro',
}

export default SITE_CONFIG
