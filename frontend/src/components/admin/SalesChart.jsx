import React, { useState, useEffect } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Area, AreaChart,
} from 'recharts'
import { api } from '../../lib/api.js'

const RANGE_OPTIONS = [
  { value: '7d',  label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: '12m', label: 'Último año' },
]

const COLORS = {
  line:   '#000000',
  area:   '#000000',
  grid:   '#e5e7eb',
  tooltip: '#1f2937',
}

function formatDateLabel(iso, bucket) {
  const d = new Date(iso)
  if (bucket === 'month') {
    return d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' })
  }
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

function formatCOP(n) {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

export default function SalesChart() {
  const [range, setRange] = useState('30d')
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.admin.dashboard.sales({ range })
      .then((res) => { if (!cancelled) { setData(res); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [range])

  const total = data?.series?.reduce((sum, d) => sum + (d.revenue || 0), 0) || 0
  const totalOrders = data?.series?.reduce((sum, d) => sum + (d.orders || 0), 0) || 0

  return (
    <div className="chart-card">
      <div className="chart-header">
        <div>
          <h3>Ventas en el tiempo</h3>
          {data && (
            <p className="chart-summary">
              <strong>{formatCOP(total)}</strong>
              <span className="chart-summary-sub">{totalOrders} órdenes</span>
            </p>
          )}
        </div>
        <select value={range} onChange={(e) => setRange(e.target.value)} className="range-select">
          {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="chart-body">
        {loading ? (
          <div className="chart-placeholder">Cargando…</div>
        ) : error ? (
          <div className="chart-placeholder error">{error}</div>
        ) : !data?.series?.length ? (
          <div className="chart-placeholder">Sin datos para este rango</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.series} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={COLORS.area} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={COLORS.area} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => formatDateLabel(v, data.bucket)}
                tick={{ fontSize: 11, fill: '#888' }}
                stroke="#ccc"
              />
              <YAxis
                tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v}
                tick={{ fontSize: 11, fill: '#888' }}
                stroke="#ccc"
              />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12 }}
                labelFormatter={(v) => new Date(v).toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                formatter={(value, name) => name === 'revenue' ? [formatCOP(value), 'Ingresos'] : [value, 'Órdenes']}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke={COLORS.line}
                strokeWidth={2}
                fill="url(#salesGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <style>{`
        .chart-card { background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
        .chart-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
        .chart-header h3 { font-size: 0.95rem; font-weight: 600; margin: 0; }
        .chart-summary { margin: 0.25rem 0 0; font-size: 1.5rem; font-weight: 700; display: flex; align-items: baseline; gap: 0.5rem; }
        .chart-summary-sub { font-size: 0.75rem; color: var(--color-gray-500, #555); font-weight: 400; }
        .range-select { padding: 0.35rem 0.6rem; border: 1px solid var(--color-gray-200); border-radius: 6px; font-size: 0.8rem; }
        .chart-body { min-height: 240px; display: flex; align-items: center; justify-content: center; }
        .chart-placeholder { color: var(--color-gray-400, #888); font-size: 0.85rem; padding: 2rem; }
        .chart-placeholder.error { color: #991b1b; }
      `}</style>
    </div>
  )
}
