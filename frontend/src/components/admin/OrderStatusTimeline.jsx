import React from 'react'

const STATUS_LABELS = {
  PENDING:    { label: 'Pendiente',   cls: 'pending'    },
  CONFIRMED:  { label: 'Confirmado',  cls: 'confirmed'  },
  PROCESSING: { label: 'Procesando',  cls: 'processing' },
  SHIPPED:    { label: 'Enviado',     cls: 'shipped'    },
  DELIVERED:  { label: 'Entregado',   cls: 'delivered'  },
  CANCELLED:  { label: 'Cancelado',   cls: 'cancelled'  },
  REFUNDED:   { label: 'Reembolsado', cls: 'refunded'   },
}

const STATUS_ORDER = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']

/**
 * Timeline visual del historial de cambios de estado de una orden.
 * Lee OrderStatusLog (ordenados por createdAt ascendente).
 *
 * Props:
 *  - logs: [{ id, fromStatus, toStatus, note, createdAt, changedBy: { name, email } }]
 */
export default function OrderStatusTimeline({ logs = [] }) {
  if (!logs.length) {
    return <p className="timeline-empty">Sin historial de cambios todavía.</p>
  }

  return (
    <ol className="status-timeline">
      {logs.map((log, idx) => {
        const toInfo = STATUS_LABELS[log.toStatus] || { label: log.toStatus, cls: '' }
        const isProgress = STATUS_ORDER.includes(log.toStatus)
        const isFinal    = log.toStatus === 'DELIVERED' || log.toStatus === 'CANCELLED' || log.toStatus === 'REFUNDED'
        return (
          <li key={log.id || idx} className={`timeline-item ${isProgress ? 'progress' : ''} ${isFinal ? 'final' : ''}`}>
            <span className={`timeline-dot ${toInfo.cls}`} aria-hidden="true" />
            <div className="timeline-content">
              <div className="timeline-row">
                <span className={`status-badge ${toInfo.cls}`}>{toInfo.label}</span>
                {log.fromStatus && (
                  <span className="from-arrow">
                    ← <span className={`status-badge ${STATUS_LABELS[log.fromStatus]?.cls || ''}`}>
                      {STATUS_LABELS[log.fromStatus]?.label || log.fromStatus}
                    </span>
                  </span>
                )}
              </div>
              <div className="timeline-meta">
                <span>{new Date(log.createdAt).toLocaleString('es-CO')}</span>
                {log.changedBy && (
                  <span>· por {log.changedBy.name || log.changedBy.email}</span>
                )}
              </div>
              {log.note && <p className="timeline-note">"{log.note}"</p>}
            </div>
          </li>
        )
      })}

      <style>{`
        .status-timeline {
          list-style: none; padding: 0; margin: 0;
          position: relative;
        }
        .status-timeline::before {
          content: ''; position: absolute; left: 7px; top: 8px; bottom: 8px;
          width: 2px; background: var(--color-gray-200, #eee);
        }
        .timeline-item {
          position: relative; padding: 0.5rem 0 1rem 1.75rem; min-height: 32px;
        }
        .timeline-dot {
          position: absolute; left: 0; top: 0.75rem;
          width: 16px; height: 16px; border-radius: 50%;
          background: var(--color-gray-300, #ccc);
          border: 2px solid var(--color-white, #fff);
          box-shadow: 0 0 0 1px var(--color-gray-200, #eee);
        }
        .timeline-dot.pending    { background: #f59e0b; }
        .timeline-dot.confirmed  { background: #2563eb; }
        .timeline-dot.processing { background: #6366f1; }
        .timeline-dot.shipped    { background: #10b981; }
        .timeline-dot.delivered  { background: #16a34a; }
        .timeline-dot.cancelled  { background: #dc2626; }
        .timeline-dot.refunded   { background: #a855f7; }
        .timeline-content { display: flex; flex-direction: column; gap: 0.25rem; }
        .timeline-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
        .from-arrow { font-size: 0.75rem; color: var(--color-gray-500, #555); display: inline-flex; align-items: center; gap: 0.35rem; }
        .status-badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.72rem; font-weight: 500; }
        .status-badge.pending    { background: #fef3c7; color: #92400e; }
        .status-badge.confirmed  { background: #dbeafe; color: #1e40af; }
        .status-badge.processing { background: #e0e7ff; color: #3730a3; }
        .status-badge.shipped    { background: #d1fae5; color: #065f46; }
        .status-badge.delivered  { background: #dcfce7; color: #166534; }
        .status-badge.cancelled  { background: #fee2e2; color: #991b1b; }
        .status-badge.refunded   { background: #f3e8ff; color: #6b21a8; }
        .timeline-meta { font-size: 0.72rem; color: var(--color-gray-500, #555); display: flex; gap: 0.25rem; }
        .timeline-note {
          margin: 0.25rem 0 0; padding: 0.5rem 0.75rem;
          background: var(--color-gray-50, #fafafa); border-radius: 6px;
          font-size: 0.8rem; color: var(--color-gray-700, #333); font-style: italic;
        }
        .timeline-empty { color: var(--color-gray-500, #555); font-size: 0.85rem; }
      `}</style>
    </ol>
  )
}
