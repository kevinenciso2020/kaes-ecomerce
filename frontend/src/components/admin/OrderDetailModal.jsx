import React, { useState } from 'react'
import OrderStatusTimeline from './OrderStatusTimeline.jsx'

const STATUS_LABELS = {
  PENDING:    { label: 'Pendiente',   cls: 'pending'    },
  CONFIRMED:  { label: 'Confirmado',  cls: 'confirmed'  },
  PROCESSING: { label: 'Procesando',  cls: 'processing' },
  SHIPPED:    { label: 'Enviado',     cls: 'shipped'    },
  DELIVERED:  { label: 'Entregado',   cls: 'delivered'  },
  CANCELLED:  { label: 'Cancelado',   cls: 'cancelled'  },
  REFUNDED:   { label: 'Reembolsado', cls: 'refunded'   },
}

// Debe coincidir con ALLOWED_TRANSITIONS del backend (admin-orders.service.js)
const ALLOWED_TRANSITIONS = {
  PENDING:    ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:  ['PROCESSING', 'SHIPPED', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED:    ['DELIVERED', 'REFUNDED'],
  DELIVERED:  ['REFUNDED'],
  CANCELLED:  [],
  REFUNDED:   [],
}

const TRANSITION_HINTS = {
  CONFIRMED: 'Confirmar manualmente (p. ej. pago por transferencia): descuenta el stock.',
  CANCELLED: 'Si la orden estaba pagada, el stock se devuelve. El reembolso del dinero se hace en el panel de Wompi/MercadoPago.',
  REFUNDED: 'Marca la orden como reembolsada y devuelve el stock. Haz el reembolso en el panel de la pasarela.',
}

const PAYMENT_LABELS = {
  PENDING:   { label: 'Pendiente', cls: 'pending' },
  COMPLETED: { label: 'Completado', cls: 'completed' },
  FAILED:    { label: 'Fallido',   cls: 'failed' },
  REFUNDED:  { label: 'Reembolsado', cls: 'refunded' },
}

export default function OrderDetailModal({ order, onClose, onStatusChange, onResolveReview, showToast }) {
  const allowed = ALLOWED_TRANSITIONS[order.status] || []
  const [newStatus, setNewStatus] = useState(allowed[0] || order.status)
  const [note, setNote]           = useState('')
  const [busy, setBusy]           = useState(false)

  if (!order) return null

  const handleUpdate = async () => {
    if (newStatus === order.status) {
      showToast?.({ type: 'info', message: 'El estado no cambió' })
      return
    }
    setBusy(true)
    try {
      await onStatusChange(order.id, newStatus, note.trim() || undefined)
      setNote('')
    } catch (err) {
      showToast?.({ type: 'error', message: err.message || 'Error al actualizar estado' })
    } finally {
      setBusy(false)
    }
  }

  const sInfo = STATUS_LABELS[order.status] || { label: order.status, cls: '' }
  const pInfo = order.payment ? (PAYMENT_LABELS[order.payment.status] || { label: order.payment.status, cls: '' }) : null

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="modal-content large">
        <div className="modal-header">
          <h2>
            Orden #{order.id.slice(-6).toUpperCase()}
            <span className={`status-badge large ${sInfo.cls}`}>{sInfo.label}</span>
          </h2>
          <button className="modal-close" onClick={onClose} type="button">×</button>
        </div>

        <div className="order-detail-body">
          {order.needsReview && (
            <section className="review-alert" role="alert">
              <strong>⚠️ Requiere revisión</strong>
              <p>{order.reviewNote || 'Esta orden necesita revisión manual.'}</p>
              {onResolveReview && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={async () => {
                  const resolution = prompt('¿Cómo se resolvió? (queda en el historial)')
                  if (resolution === null) return
                  setBusy(true)
                  try { await onResolveReview(order.id, resolution) } catch (err) {
                    showToast?.({ type: 'error', message: err.message })
                  } finally { setBusy(false) }
                }}>Marcar como resuelta</button>
              )}
            </section>
          )}
          <section className="detail-section">
            <div className="detail-grid">
              <div>
                <span className="detail-label">Cliente</span>
                <p className="detail-value">{order.user?.name || '—'}</p>
                <p className="detail-sub">{order.user?.email}</p>
                {order.user?.phone && <p className="detail-sub">{order.user.phone}</p>}
              </div>
              <div>
                <span className="detail-label">Fecha</span>
                <p className="detail-value">{new Date(order.createdAt).toLocaleString('es-CO')}</p>
              </div>
              <div>
                <span className="detail-label">Pago</span>
                <p className="detail-value">
                  {pInfo ? <span className={`status-badge ${pInfo.cls}`}>{pInfo.label}</span> : 'Sin pago'}
                </p>
                {order.payment && (
                  <p className="detail-sub">
                    {order.payment.provider} · ${Number(order.payment.amount).toLocaleString('es-CO')} {order.payment.currency}
                  </p>
                )}
              </div>
              {order.shippingAddress && (
                <div>
                  <span className="detail-label">Envío a</span>
                  <p className="detail-value">{order.shippingAddress.fullName || order.shippingAddress.label}</p>
                  <p className="detail-sub">{order.shippingAddress.street}</p>
                  <p className="detail-sub">{order.shippingAddress.municipio}, {order.shippingAddress.departamento}</p>
                  {order.shippingAddress.phone && <p className="detail-sub">📞 {order.shippingAddress.phone}</p>}
                </div>
              )}
            </div>
            {order.notes && (
              <div className="order-notes">
                <span className="detail-label">Notas del cliente</span>
                <p>{order.notes}</p>
              </div>
            )}
          </section>

          <section className="detail-section">
            <h3>Productos ({order.items?.length || 0})</h3>
            <table className="items-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Variante</th>
                  <th>Cant.</th>
                  <th>Precio</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(order.items || []).map((item) => {
                  const img = item.product?.images?.[0]?.url
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="item-cell">
                          {img && <img src={img} alt="" className="item-thumb" />}
                          <span>{item.product?.name || 'Producto'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="variant-cell">
                          {item.color && (
                            <span
                              className="color-dot"
                              style={{
                                backgroundColor: item.variant?.colorHex || '#ccc',
                                border: `1px solid #ddd`,
                              }}
                              title={item.color}
                            />
                          )}
                          <span>{[item.color, item.size].filter(Boolean).join(' / ') || '—'}</span>
                        </div>
                      </td>
                      <td>{item.quantity}</td>
                      <td>${Number(item.price).toLocaleString('es-CO')}</td>
                      <td>${(item.quantity * Number(item.price)).toLocaleString('es-CO')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="totals">
              <p><span>Subtotal</span><span>${Number(order.subtotal).toLocaleString('es-CO')}</span></p>
              {Number(order.discount) > 0 && (
                <p className="discount"><span>Descuento {order.couponCode && `(${order.couponCode})`}</span>
                  <span>-${Number(order.discount).toLocaleString('es-CO')}</span></p>
              )}
              <p><span>Envío</span>
                <span>{Number(order.shipping) === 0 ? 'Gratis' : `$${Number(order.shipping).toLocaleString('es-CO')}`}</span>
              </p>
              <p className="total-row"><span><strong>Total</strong></span>
                <span><strong>${Number(order.total).toLocaleString('es-CO')}</strong></span></p>
            </div>
          </section>

          <section className="detail-section">
            <h3>Cambiar estado</h3>
            {allowed.length === 0 ? (
              <p className="muted">Esta orden está {sInfo.label.toLowerCase()} y no admite más cambios de estado.</p>
            ) : (
            <>
            <div className="status-control">
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} disabled={busy}>
                {allowed.map((key) => (
                  <option key={key} value={key}>{STATUS_LABELS[key]?.label || key}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Nota interna (opcional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                disabled={busy}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleUpdate}
                disabled={busy || newStatus === order.status}
              >
                {busy ? 'Guardando…' : 'Actualizar estado'}
              </button>
            </div>
            {TRANSITION_HINTS[newStatus] && <p className="muted hint">{TRANSITION_HINTS[newStatus]}</p>}
            </>
            )}
          </section>

          <section className="detail-section">
            <h3>Historial de cambios ({order.statusLogs?.length || 0})</h3>
            <OrderStatusTimeline logs={order.statusLogs || []} />
          </section>
        </div>
      </div>

      <style>{`
        .modal-content.large { max-width: 820px; }
        .review-alert { background: #fff7ed; border: 1px solid #fb923c; color: #9a3412; border-radius: 8px; padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 1rem; }
        .review-alert p { margin: 0; font-size: 0.85rem; }
        .review-alert button { align-self: flex-start; }
        .muted { color: #777; font-size: 0.8rem; }
        .hint { margin-top: 0.5rem; }
        .modal-header h2 { display: flex; align-items: center; gap: 0.75rem; font-size: 1.1rem; margin: 0; }
        .status-badge.large { font-size: 0.75rem; padding: 0.25rem 0.7rem; }
        .order-detail-body { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; max-height: 75vh; overflow-y: auto; }
        .detail-section { display: flex; flex-direction: column; gap: 0.75rem; }
        .detail-section h3 { font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-gray-500, #555); margin: 0; }
        .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; padding: 1rem; background: var(--color-gray-50, #fafafa); border-radius: 8px; }
        .detail-label { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-gray-500, #555); margin-bottom: 0.25rem; }
        .detail-value { margin: 0; font-weight: 500; font-size: 0.9rem; }
        .detail-sub { margin: 0; font-size: 0.8rem; color: var(--color-gray-500, #555); }
        .order-notes { padding: 0.75rem; background: #fef3c7; border-radius: 6px; font-size: 0.85rem; }
        .order-notes p { margin: 0.25rem 0 0; }
        .items-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .items-table th, .items-table td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--color-gray-100, #f5f5f5); }
        .items-table th { font-size: 0.7rem; text-transform: uppercase; color: var(--color-gray-500, #555); font-weight: 600; }
        .item-cell { display: flex; align-items: center; gap: 0.5rem; }
        .item-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 4px; }
        .variant-cell { display: flex; align-items: center; gap: 0.5rem; }
        .color-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
        .totals { margin-top: 0.75rem; }
        .totals p { display: flex; justify-content: space-between; padding: 0.35rem 0; font-size: 0.85rem; border-bottom: 1px solid var(--color-gray-100, #f5f5f5); }
        .totals .total-row { font-size: 1rem; padding-top: 0.75rem; border-bottom: none; }
        .totals .discount { color: #16a34a; }
        .status-control { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
        .status-control select, .status-control input {
          padding: 0.5rem 0.75rem; border: 1px solid var(--color-gray-200, #eee);
          border-radius: 6px; font-size: 0.875rem; font-family: inherit;
        }
        .status-control input { flex: 1; min-width: 200px; }
        .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: flex-start; justify-content: center; z-index: 1000; padding: 2rem 1rem; overflow-y: auto; }
        .modal-content { background: var(--color-white); border-radius: 12px; width: 100%; max-width: 600px; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--color-gray-200); }
        .modal-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; line-height: 1; padding: 4px 8px; }
        .btn { padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; cursor: pointer; border: 1px solid transparent; }
        .btn-primary { background: var(--color-black, #000); color: var(--color-white, #fff); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .status-badge.pending    { background: #fef3c7; color: #92400e; }
        .status-badge.confirmed  { background: #dbeafe; color: #1e40af; }
        .status-badge.processing { background: #e0e7ff; color: #3730a3; }
        .status-badge.shipped    { background: #d1fae5; color: #065f46; }
        .status-badge.delivered  { background: #dcfce7; color: #166534; }
        .status-badge.cancelled  { background: #fee2e2; color: #991b1b; }
        .status-badge.refunded   { background: #f3e8ff; color: #6b21a8; }
        .status-badge.completed  { background: #dcfce7; color: #166534; }
        .status-badge.failed     { background: #fee2e2; color: #991b1b; }
      `}</style>
    </div>
  )
}
