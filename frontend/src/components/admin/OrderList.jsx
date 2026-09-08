import React, { useState, useEffect, useCallback } from 'react'
import { api, bootstrapAuth } from '../../lib/api.js'
import { escapeHtml } from '../../lib/sanitize.js'
import OrderDetailModal from './OrderDetailModal.jsx'

const STATUS_LABELS = {
  PENDING:    { label: 'Pendiente',   cls: 'pending'    },
  CONFIRMED:  { label: 'Confirmado',  cls: 'confirmed'  },
  PROCESSING: { label: 'Procesando',  cls: 'processing' },
  SHIPPED:    { label: 'Enviado',     cls: 'shipped'    },
  DELIVERED:  { label: 'Entregado',   cls: 'delivered'  },
  CANCELLED:  { label: 'Cancelado',   cls: 'cancelled'  },
  REFUNDED:   { label: 'Reembolsado', cls: 'refunded'   },
}

export default function OrderList({ showToast }) {
  const [orders, setOrders]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [page, setPage]           = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [filters, setFilters]     = useState({
    status: '',
    search: '',
    dateFrom: '',
    dateTo: '',
  })
  const [activeOrder, setActiveOrder] = useState(null)
  const [showDetail, setShowDetail]   = useState(false)

  const loadOrders = useCallback(async (params = {}) => {
    try {
      const q = new URLSearchParams()
      q.set('page', params.page || page)
      q.set('limit', 20)
      if (filters.status)   q.set('status', filters.status)
      if (filters.search)   q.set('search', filters.search)
      if (filters.dateFrom) q.set('dateFrom', new Date(filters.dateFrom).toISOString())
      if (filters.dateTo)   q.set('dateTo',   new Date(filters.dateTo).toISOString())
      const result = await api.admin.orders(Object.fromEntries(q))
      setOrders(result.orders || [])
      setPage(result.page || 1)
      setTotalPages(result.totalPages || 1)
    } catch (err) {
      setError(err.message || 'Error al cargar órdenes')
    }
  }, [page, filters])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const user = await bootstrapAuth()
      if (!mounted) return
      if (!user || user.role !== 'ADMIN') { setAccessDenied(true); setLoading(false); return }
      await loadOrders()
      if (mounted) setLoading(false)
    })()
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = setTimeout(() => loadOrders({ page: 1 }), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const viewOrder = async (orderRow) => {
    try {
      const full = await api.admin.orderDetail(orderRow.id)
      setActiveOrder(full)
      setShowDetail(true)
    } catch (err) {
      showToast?.({ type: 'error', message: err.message })
    }
  }

  const handleStatusChange = async (orderId, status, note) => {
    try {
      const updated = await api.admin.updateOrder(orderId, status, note)
      setActiveOrder(updated)
      showToast?.({ type: 'success', message: `Estado actualizado a ${STATUS_LABELS[status]?.label || status}` })
      await loadOrders()
    } catch (err) {
      throw err
    }
  }

  const quickStatus = async (orderId, status) => {
    try {
      await api.admin.updateOrder(orderId, status)
      showToast?.({ type: 'success', message: 'Estado actualizado' })
      await loadOrders()
    } catch (err) {
      showToast?.({ type: 'error', message: err.message })
    }
  }

  if (accessDenied) {
    return (
      <div className="no-access">
        <p>No tienes permisos para ver esta página</p>
        <a href="/" className="btn btn-primary">Volver al inicio</a>
      </div>
    )
  }

  return (
    <div className="admin-page container">
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Órdenes</h1>
          <p className="admin-sub">Gestiona los pedidos · {orders.length} en esta página</p>
        </div>
      </div>

      <div className="filters">
        <input
          type="search"
          className="search-input"
          placeholder="Buscar por cliente, email o ID…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <select
          className="filter-select"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input
          type="date"
          className="filter-select"
          value={filters.dateFrom}
          onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
          title="Desde"
        />
        <input
          type="date"
          className="filter-select"
          value={filters.dateTo}
          onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
          title="Hasta"
        />
        {(filters.search || filters.status || filters.dateFrom || filters.dateTo) && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setFilters({ status: '', search: '', dateFrom: '', dateTo: '' })}
          >
            Limpiar
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="orders-table-wrap">
        <table className="orders-table">
          <thead>
            <tr>
              <th>Orden</th>
              <th>Cliente</th>
              <th>Items</th>
              <th>Total</th>
              <th>Pago</th>
              <th>Estado</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="loading">Cargando…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={8} className="empty">No hay órdenes con esos filtros</td></tr>
            ) : orders.map((o) => {
              const s = STATUS_LABELS[o.status] || { label: o.status, cls: '' }
              return (
                <tr key={o.id}>
                  <td><strong>#{o.id.slice(-6).toUpperCase()}</strong></td>
                  <td>
                    <div className="customer-info">
                      <span className="customer-name">{escapeHtml(o.user?.name || '—')}</span>
                      <span className="customer-email">{escapeHtml(o.user?.email || '')}</span>
                    </div>
                  </td>
                  <td>{o.items?.length || (o._count?.items ?? '—')}</td>
                  <td><strong>${Number(o.total).toLocaleString('es-CO')}</strong></td>
                  <td>
                    {o.payment ? (
                      <span className={`status-badge small ${
                        o.payment.status === 'COMPLETED' ? 'completed' :
                        o.payment.status === 'FAILED'    ? 'cancelled' :
                        'pending'
                      }`}>{o.payment.status}</span>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td><span className={`status-badge ${s.cls}`}>{s.label}</span></td>
                  <td className="muted">{new Date(o.createdAt).toLocaleDateString('es-CO')}</td>
                  <td>
                    <div className="action-buttons">
                      <button className="btn-icon" title="Ver detalle" onClick={() => viewOrder(o)}>👁️</button>
                      <select
                        className="status-select"
                        value={o.status}
                        onChange={(e) => quickStatus(o.id, e.target.value)}
                        title="Cambiar estado rápido"
                      >
                        {Object.entries(STATUS_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="page-btn" disabled={page <= 1} onClick={() => loadOrders({ page: page - 1 })}>← Anterior</button>
          <span className="page-info">Página {page} de {totalPages}</span>
          <button className="page-btn" disabled={page >= totalPages} onClick={() => loadOrders({ page: page + 1 })}>Siguiente →</button>
        </div>
      )}

      {showDetail && (
        <OrderDetailModal
          order={activeOrder}
          onClose={() => { setShowDetail(false); setActiveOrder(null) }}
          onStatusChange={handleStatusChange}
          showToast={showToast}
        />
      )}

      <style>{`
        .admin-page { padding-top: calc(60px + 2rem); padding-bottom: 4rem; }
        .admin-header { margin-bottom: 1.5rem; }
        .admin-title { font-family: var(--font-serif); font-size: 2rem; font-weight: 600; color: var(--color-black); margin: 0; }
        .admin-sub { font-size: 0.875rem; color: var(--color-gray-400); margin-top: 0.25rem; }
        .filters { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; align-items: center; }
        .search-input { flex: 1; min-width: 220px; padding: 0.5rem 0.75rem; border: 1px solid var(--color-gray-200); border-radius: 6px; font-size: 0.875rem; }
        .filter-select { padding: 0.5rem 0.75rem; border: 1px solid var(--color-gray-200); border-radius: 6px; font-size: 0.875rem; }
        .orders-table-wrap { background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 8px; overflow-x: auto; }
        .orders-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .orders-table th { text-align: left; padding: 0.75rem; background: var(--color-gray-50); font-weight: 600; color: var(--color-gray-500); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .orders-table td { padding: 0.75rem; border-top: 1px solid var(--color-gray-100); vertical-align: middle; }
        .customer-info { display: flex; flex-direction: column; }
        .customer-name { font-weight: 500; }
        .customer-email { font-size: 0.7rem; color: var(--color-gray-400); }
        .status-badge { display: inline-block; padding: 0.2rem 0.55rem; border-radius: 999px; font-size: 0.72rem; font-weight: 500; }
        .status-badge.small { font-size: 0.65rem; padding: 0.1rem 0.45rem; }
        .status-badge.pending    { background: #fef3c7; color: #92400e; }
        .status-badge.confirmed  { background: #dbeafe; color: #1e40af; }
        .status-badge.processing { background: #e0e7ff; color: #3730a3; }
        .status-badge.shipped    { background: #d1fae5; color: #065f46; }
        .status-badge.delivered  { background: #dcfce7; color: #166534; }
        .status-badge.cancelled  { background: #fee2e2; color: #991b1b; }
        .status-badge.refunded   { background: #f3e8ff; color: #6b21a8; }
        .status-badge.completed  { background: #dcfce7; color: #166534; }
        .action-buttons { display: flex; gap: 0.4rem; align-items: center; }
        .btn-icon { background: none; border: none; cursor: pointer; padding: 0.2rem; font-size: 0.95rem; }
        .status-select { padding: 0.25rem 0.5rem; border: 1px solid var(--color-gray-200); border-radius: 4px; font-size: 0.72rem; background: var(--color-white); }
        .muted { color: var(--color-gray-400, #888); }
        .loading, .empty { text-align: center; padding: 2rem; color: var(--color-gray-400); }
        .error-banner { background: #fee2e2; color: #991b1b; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.85rem; }
        .pagination { display: flex; justify-content: center; align-items: center; gap: 1rem; margin-top: 1.5rem; }
        .page-btn { padding: 0.5rem 1rem; background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 6px; cursor: pointer; font-size: 0.875rem; }
        .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .page-info { font-size: 0.875rem; color: var(--color-gray-500); }
        .no-access { min-height: 60vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; color: var(--color-gray-400); }
        .btn { padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; cursor: pointer; border: 1px solid transparent; }
        .btn-primary { background: var(--color-black, #000); color: var(--color-white, #fff); }
        .btn-secondary { background: var(--color-white); color: var(--color-black); border-color: var(--color-gray-200); }
      `}</style>
    </div>
  )
}
