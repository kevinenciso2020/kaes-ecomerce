import React, { useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { api } from '../../lib/api.js'

const COLORS = ['#000000', '#1f2937', '#374151', '#4b5563', '#6b7280', '#9ca3af', '#d1d5db', '#e5e7eb', '#f3f4f6', '#f9fafb']

function formatCOP(n) {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

export default function TopProductsChart() {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.admin.dashboard.topProducts({ limit: 10, range: '90d' })
      .then((res) => { if (!cancelled) { setData(res.products || []); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h3>Productos más vendidos</h3>
        <span className="chart-sub">Últimos 90 días</span>
      </div>

      <div className="chart-body">
        {loading ? (
          <div className="chart-placeholder">Cargando…</div>
        ) : error ? (
          <div className="chart-placeholder error">{error}</div>
        ) : !data?.length ? (
          <div className="chart-placeholder">Sin ventas registradas aún</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#888' }} stroke="#ccc" />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fontSize: 11, fill: '#444' }}
                stroke="#ccc"
                interval={0}
              />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12 }}
                formatter={(value) => [`${value} unidades`, 'Vendidas']}
              />
              <Bar dataKey="sold" radius={[0, 4, 4, 0]}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <style>{`
        .chart-card { background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
        .chart-header { display: flex; justify-content: space-between; align-items: baseline; }
        .chart-header h3 { font-size: 0.95rem; font-weight: 600; margin: 0; }
        .chart-sub { font-size: 0.7rem; color: var(--color-gray-500, #555); }
        .chart-body { min-height: 180px; }
        .chart-placeholder { color: var(--color-gray-400, #888); font-size: 0.85rem; padding: 2rem; text-align: center; }
        .chart-placeholder.error { color: #991b1b; }
      `}</style>
    </div>
  )
}
