import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api.js'

const STATUS_LABELS = {
  PENDING:    'Pendiente',
  CONFIRMED:  'Confirmado',
  PROCESSING: 'Procesando',
  SHIPPED:    'Enviado',
  DELIVERED:  'Entregado',
  CANCELLED:  'Cancelado',
  REFUNDED:   'Reembolsado',
}

export default function RecentOrdersPanel() {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.admin.dashboard.recentOrders({ limit: 8 })
      .then((res) => { if (!cancelled) { setItems(res.orders || []); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Órdenes recientes</h3>
        <a href="/admin/ordenes" className="panel-link">Ver todas →</a>
      </div>
      <div className="panel-body">
        {loading ? (
          <p className="panel-empty">Cargando…</p>
        ) : error ? (
          <p className="panel-empty error">{error}</p>
        ) : !items.length ? (
          <p className="panel-empty">Sin órdenes todavía</p>
        ) : (
          <ul className="recent-list">
            {items.map((o) => (
              <li key={o.id} className="recent-item">
                <a href="/admin/ordenes" className="recent-link">
                  <div className="recent-top">
                    <strong>#{o.id.slice(-6).toUpperCase()}</strong>
                    <span>${Number(o.total).toLocaleString('es-CO')}</span>
                  </div>
                  <div className="recent-meta">
                    <span className="recent-name">{o.user?.name || '—'}</span>
                    <span className={`status-pill ${o.status.toLowerCase()}`}>
                      {STATUS_LABELS[o.status] || o.status}
                    </span>
                  </div>
                  <p className="recent-time">{new Date(o.createdAt).toLocaleString('es-CO')}</p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <style>{`
        .panel { background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 8px; display: flex; flex-direction: column; }
        .panel-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-gray-100); }
        .panel-header h3 { font-size: 0.95rem; font-weight: 600; margin: 0; }
        .panel-link { font-size: 0.75rem; color: var(--color-gray-500, #555); text-decoration: none; }
        .panel-link:hover { color: var(--color-black, #000); }
        .panel-body { padding: 0.5rem 0.75rem 0.75rem; }
        .panel-empty { color: var(--color-gray-400, #888); font-size: 0.85rem; margin: 1rem 0; text-align: center; }
        .panel-empty.error { color: #991b1b; }
        .recent-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
        .recent-item { border-bottom: 1px solid var(--color-gray-100, #f5f5f5); }
        .recent-item:last-child { border-bottom: none; }
        .recent-link { display: block; padding: 0.75rem 0.5rem; text-decoration: none; color: inherit; border-radius: 6px; transition: background 0.1s; }
        .recent-link:hover { background: var(--color-gray-50, #fafafa); }
        .recent-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.25rem; }
        .recent-top strong { font-size: 0.85rem; }
        .recent-top span:last-child { font-weight: 600; font-size: 0.85rem; }
        .recent-meta { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
        .recent-name { font-size: 0.8rem; color: var(--color-gray-700, #333); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
        .status-pill { font-size: 0.65rem; padding: 0.1rem 0.5rem; border-radius: 999px; font-weight: 500; flex-shrink: 0; }
        .status-pill.pending    { background: #fef3c7; color: #92400e; }
        .status-pill.confirmed  { background: #dbeafe; color: #1e40af; }
        .status-pill.processing { background: #e0e7ff; color: #3730a3; }
        .status-pill.shipped    { background: #d1fae5; color: #065f46; }
        .status-pill.delivered  { background: #dcfce7; color: #166534; }
        .status-pill.cancelled  { background: #fee2e2; color: #991b1b; }
        .status-pill.refunded   { background: #f3e8ff; color: #6b21a8; }
        .recent-time { margin: 0.15rem 0 0; font-size: 0.7rem; color: var(--color-gray-400, #888); }
      `}</style>
    </div>
  )
}
