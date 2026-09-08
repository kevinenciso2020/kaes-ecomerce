import React, { useState, useEffect } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
} from 'recharts'
import { api } from '../../lib/api.js'

const PIE_COLORS = ['#000000', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#f3f4f6', '#1f2937', '#4b5563']

function formatCOP(n) {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

export default function CategoryPieChart() {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.admin.dashboard.byCategory({ range: '90d' })
      .then((res) => { if (!cancelled) { setData(res.categories || []); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const total = data?.reduce((sum, c) => sum + c.revenue, 0) || 0

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h3>Ventas por categoría</h3>
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
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={data}
                dataKey="revenue"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
                stroke="#fff"
                strokeWidth={2}
              >
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12 }}
                formatter={(value, name, props) => [
                  `${formatCOP(value)} (${((value / total) * 100).toFixed(1)}%)`,
                  props.payload.name,
                ]}
              />
              <Legend
                verticalAlign="bottom"
                iconSize={8}
                wrapperStyle={{ fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      <style>{`
        .chart-card { background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
        .chart-header { display: flex; justify-content: space-between; align-items: baseline; }
        .chart-header h3 { font-size: 0.95rem; font-weight: 600; margin: 0; }
        .chart-sub { font-size: 0.7rem; color: var(--color-gray-500, #555); }
        .chart-body { min-height: 240px; }
        .chart-placeholder { color: var(--color-gray-400, #888); font-size: 0.85rem; padding: 2rem; text-align: center; }
        .chart-placeholder.error { color: #991b1b; }
      `}</style>
    </div>
  )
}
