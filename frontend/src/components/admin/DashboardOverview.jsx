import React, { useState, useEffect } from 'react'
import { api, bootstrapAuth } from '../../lib/api.js'
import SalesChart        from './SalesChart.jsx'
import TopProductsChart  from './TopProductsChart.jsx'
import CategoryPieChart  from './CategoryPieChart.jsx'
import LowStockPanel     from './LowStockPanel.jsx'
import RecentOrdersPanel from './RecentOrdersPanel.jsx'

function formatCOP(n) {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`stat-card ${accent ? 'accent' : ''}`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  )
}

export default function DashboardOverview() {
  const [overview, setOverview] = useState(null)
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const user = await bootstrapAuth()
      if (!mounted) return
      if (!user || user.role !== 'ADMIN') {
        setAccessDenied(true)
        setLoading(false)
        return
      }
      try {
        const data = await api.admin.dashboard.overview()
        if (!mounted) return
        setOverview(data)
      } catch (err) {
        if (!mounted) return
        setError(err.message || 'Error al cargar el dashboard')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

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
        <h1 className="admin-title">Panel de administración</h1>
        <p className="admin-sub">Resumen de tu tienda Kaes</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <section className="stats-grid">
        <StatCard
          label="Usuarios (clientes)"
          value={loading ? '—' : (overview?.totalUsers ?? 0)}
        />
        <StatCard
          label="Productos"
          value={loading ? '—' : (overview?.totalProducts ?? 0)}
        />
        <StatCard
          label="Órdenes"
          value={loading ? '—' : (overview?.totalOrders ?? 0)}
          sub={overview ? `${overview.todayOrders} hoy` : ''}
        />
        <StatCard
          label="Ingresos totales"
          value={loading ? '—' : formatCOP(overview?.revenue ?? 0)}
          sub={overview ? `${formatCOP(overview.todayRevenue)} hoy` : ''}
          accent
        />
      </section>

      <section className="dashboard-grid">
        <div className="grid-cell wide">
          <SalesChart />
        </div>
        <div className="grid-cell">
          <CategoryPieChart />
        </div>
        <div className="grid-cell">
          <TopProductsChart />
        </div>
        <div className="grid-cell">
          <LowStockPanel />
        </div>
        <div className="grid-cell">
          <RecentOrdersPanel />
        </div>
      </section>

      <section className="quick-actions">
        <h2 className="section-label">Acciones rápidas</h2>
        <div className="actions-grid">
          <a href="/admin/productos" className="action-card">
            <span className="action-icon">👕</span>
            <h3>Productos</h3>
            <p>Crear, editar y eliminar</p>
          </a>
          <a href="/admin/ordenes" className="action-card">
            <span className="action-icon">📦</span>
            <h3>Órdenes</h3>
            <p>Gestionar pedidos</p>
          </a>
          <a href="/admin/descuentos" className="action-card">
            <span className="action-icon">🏷️</span>
            <h3>Descuentos</h3>
            <p>Cupones y promociones</p>
          </a>
          <a href="/admin/usuarios" className="action-card">
            <span className="action-icon">👥</span>
            <h3>Usuarios</h3>
            <p>Gestionar cuentas</p>
          </a>
        </div>
      </section>

      <style>{`
        .admin-page { padding-top: calc(60px + 2rem); padding-bottom: 4rem; }
        .admin-header { margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--color-gray-200); }
        .admin-title { font-family: var(--font-serif); font-size: 2rem; font-weight: 600; color: var(--color-black); margin: 0; }
        .admin-sub { font-size: 0.875rem; color: var(--color-gray-400); margin: 0.25rem 0 0; }
        .error-banner { background: #fee2e2; color: #991b1b; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .stat-card { background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 8px; padding: 1.25rem; }
        .stat-card.accent { background: var(--color-black, #000); color: var(--color-white, #fff); border-color: var(--color-black, #000); }
        .stat-card.accent .stat-label { color: rgba(255,255,255,0.7); }
        .stat-card.accent .stat-sub { color: rgba(255,255,255,0.7); }
        .stat-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--color-gray-400); margin: 0 0 0.5rem; }
        .stat-value { font-size: 1.75rem; font-weight: 700; margin: 0; }
        .stat-sub { font-size: 0.75rem; color: var(--color-gray-500); margin: 0.25rem 0 0; }

        .dashboard-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; margin-bottom: 2rem; }
        .dashboard-grid .grid-cell.wide { grid-column: 1 / -1; }
        @media (min-width: 1024px) {
          .dashboard-grid { grid-template-columns: 2fr 1fr; }
          .dashboard-grid .grid-cell.wide { grid-column: 1 / -1; }
          .dashboard-grid .grid-cell:nth-child(2) { grid-column: 1 / 2; }
          .dashboard-grid .grid-cell:nth-child(3) { grid-column: 2 / 3; grid-row: 2 / 4; }
          .dashboard-grid .grid-cell:nth-child(4) { grid-column: 1 / 2; }
          .dashboard-grid .grid-cell:nth-child(5) { grid-column: 1 / 2; }
        }
        @media (max-width: 1023px) {
          .dashboard-grid { grid-template-columns: 1fr; }
          .dashboard-grid .grid-cell { grid-column: 1 / -1 !important; }
        }

        .section-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: var(--color-gray-400); margin: 0 0 0.75rem; }
        .actions-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; }
        .action-card { display: flex; flex-direction: column; gap: 0.35rem; padding: 1.25rem; background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 8px; text-decoration: none; color: inherit; transition: all 0.15s; }
        .action-card:hover { border-color: var(--color-black, #000); transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.05); }
        .action-icon { font-size: 1.5rem; }
        .action-card h3 { font-size: 0.9rem; font-weight: 600; margin: 0; color: var(--color-black); }
        .action-card p { font-size: 0.75rem; color: var(--color-gray-400); margin: 0; }

        .no-access { min-height: 60vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; color: var(--color-gray-400); }
        .btn { padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; cursor: pointer; border: 1px solid transparent; text-decoration: none; display: inline-block; }
        .btn-primary { background: var(--color-black, #000); color: var(--color-white, #fff); }
      `}</style>
    </div>
  )
}
