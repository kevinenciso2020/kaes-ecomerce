// Etiquetas de estado de orden para el cliente.
export const ORDER_STATUS = {
  PENDING:    { label: 'Pendiente de pago', cls: 'pending' },
  CONFIRMED:  { label: 'Pagado',            cls: 'confirmed' },
  PROCESSING: { label: 'Preparando',        cls: 'processing' },
  SHIPPED:    { label: 'Enviado',           cls: 'shipped' },
  DELIVERED:  { label: 'Entregado',         cls: 'delivered' },
  CANCELLED:  { label: 'Cancelado',         cls: 'cancelled' },
  REFUNDED:   { label: 'Reembolsado',       cls: 'refunded' },
}

export const statusLabel = (status) => ORDER_STATUS[status]?.label || status
