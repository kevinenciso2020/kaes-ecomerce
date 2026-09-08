import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api.js'

export default function LowStockPanel() {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.admin.dashboard.lowStock({ limit: 10 })
      .then((res) => { if (!cancelled) { setItems(res.products || []); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Stock bajo</h3>
        <a href="/admin/productos?lowStock=true" className="panel-link">Ver todos →</a>
      </div>
      <div className="panel-body">
        {loading ? (
          <p className="panel-empty">Cargando…</p>
        ) : error ? (
          <p className="panel-empty error">{error}</p>
        ) : !items.length ? (
          <p className="panel-empty">No hay variantes con stock bajo. ¡Bien!</p>
        ) : (
          <ul className="lowstock-list">
            {items.map((p) => (
              <li key={p.id} className="lowstock-item">
                <div className="lowstock-product">
                  {p.images?.[0]?.url && (
                    <img src={p.images[0].url} alt="" className="lowstock-thumb" />
                  )}
                  <div>
                    <p className="lowstock-name">{p.name}</p>
                    <p className="lowstock-meta">
                      {p.lowVariants.length} variante{p.lowVariants.length !== 1 ? 's' : ''} baja{p.lowVariants.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="lowstock-variants">
                  {p.lowVariants.slice(0, 3).map((v, idx) => (
                    <span key={idx} className="variant-chip warn">
                      <span
                        style={{
                          display:        'inline-block',
                          width:          8, height: 8, borderRadius: '50%',
                          backgroundColor: v.colorHex || '#ccc',
                          border:         `1px solid #ddd`,
                          marginRight:    4,
                        }}
                      />
                      {v.color}/{v.size} · <strong>{v.stock}</strong>
                    </span>
                  ))}
                  {p.lowVariants.length > 3 && (
                    <span className="variant-chip more">+{p.lowVariants.length - 3}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <style>{`
        .panel { background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 8px; display: flex; flex-direction: column; min-height: 200px; }
        .panel-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-gray-100); }
        .panel-header h3 { font-size: 0.95rem; font-weight: 600; margin: 0; }
        .panel-link { font-size: 0.75rem; color: var(--color-gray-500, #555); text-decoration: none; }
        .panel-link:hover { color: var(--color-black, #000); }
        .panel-body { padding: 0.75rem 1.25rem 1rem; flex: 1; }
        .panel-empty { color: var(--color-gray-400, #888); font-size: 0.85rem; margin: 1rem 0; text-align: center; }
        .panel-empty.error { color: #991b1b; }
        .lowstock-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.75rem; }
        .lowstock-item { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.5rem; border-radius: 6px; background: var(--color-gray-50, #fafafa); }
        .lowstock-product { display: flex; align-items: center; gap: 0.5rem; min-width: 0; flex: 1; }
        .lowstock-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
        .lowstock-name { margin: 0; font-weight: 500; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lowstock-meta { margin: 0; font-size: 0.7rem; color: var(--color-gray-500, #555); }
        .lowstock-variants { display: flex; flex-wrap: wrap; gap: 0.25rem; justify-content: flex-end; max-width: 60%; }
        .variant-chip { display: inline-flex; align-items: center; padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.7rem; background: #fef3c7; color: #92400e; }
        .variant-chip.more { background: var(--color-gray-200, #eee); color: var(--color-gray-600, #555); }
      `}</style>
    </div>
  )
}
