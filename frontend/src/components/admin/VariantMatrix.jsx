import React, { useMemo, useEffect } from 'react'

/**
 * Matriz de variantes: filas = colores, columnas = tallas, celdas = stock + lowStockThreshold.
 *
 * Props:
 *  - colors: [{ id, name, hex }]
 *  - sizes:  [{ id, value, scale }]
 *  - value: { variants: [{ size, color, colorHex, stock, lowStockThreshold, sku, price }] }
 *  - onChange: ({ variants }) => void
 *  - defaultLowStockThreshold: número (fallback)
 *
 * Estructura del value:
 *  variants: [{
 *    key: 'size::color'   // interno, derivado
 *    size: 'M' | null
 *    color: 'Negro' | null
 *    colorHex: '#000'
 *    stock: number
 *    sku?: string
 *    lowStockThreshold?: number | null
 *    price?: number | null
 *  }, ...]
 */
export default function VariantMatrix({
  colors = [],
  sizes = [],
  value = { variants: [] },
  onChange,
  defaultLowStockThreshold = 5,
}) {
  // Convertir el array de variants en un map indexado por 'size::color'
  const variantMap = useMemo(() => {
    const map = new Map()
    for (const v of value.variants || []) {
      const key = `${v.size || ''}::${v.color || ''}`
      map.set(key, v)
    }
    return map
  }, [value.variants])

  // Si las props colors/sizes cambian (después de cargar del backend), asegurarse
  // de que las celdas vacías tengan un registro en el array.
  useEffect(() => {
    if (!colors.length || !sizes.length) return
    const expectedKeys = new Set()
    for (const c of colors) for (const s of sizes) {
      expectedKeys.add(`${s.value}::${c.name}`)
    }
    const currentKeys = new Set((value.variants || []).map((v) => `${v.size || ''}::${v.color || ''}`))
    let changed = false
    const next = [...(value.variants || [])]
    for (const key of expectedKeys) {
      if (!currentKeys.has(key)) {
        const [size, color] = key.split('::')
        const col = colors.find((c) => c.name === color)
        next.push({
          size, color,
          colorHex: col?.hex || null,
          stock: 0,
          sku: null,
          lowStockThreshold: null,
          price: null,
        })
        changed = true
      }
    }
    if (changed) onChange?.({ variants: next })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, sizes])

  const updateCell = (size, color, field, raw) => {
    const key = `${size}::${color}`
    const colObj = colors.find((c) => c.name === color)
    const next = [...(value.variants || [])]
    const idx = next.findIndex((v) => `${v.size || ''}::${v.color || ''}` === key)
    let entry = idx >= 0 ? { ...next[idx] } : {
      size, color,
      colorHex: colObj?.hex || null,
      stock: 0, sku: null, lowStockThreshold: null, price: null,
    }
    if (field === 'stock') {
      const n = parseInt(raw, 10)
      entry.stock = isNaN(n) || n < 0 ? 0 : n
    } else if (field === 'lowStockThreshold') {
      const n = parseInt(raw, 10)
      entry.lowStockThreshold = isNaN(n) || n < 0 ? null : n
    } else if (field === 'sku') {
      entry.sku = raw || null
    } else if (field === 'price') {
      const n = parseFloat(raw)
      entry.price = isNaN(n) || n < 0 ? null : n
    }
    if (idx >= 0) next[idx] = entry
    else next.push(entry)

    // Mantener solo celdas con stock > 0 O con SKU/precio/threshold seteado (no dejar
    // filas vacías que ensucien la matriz). Aquí conservamos todo lo que el usuario
    // tocó — el backend filtrará vacíos.
    onChange?.({ variants: next })
  }

  const toggleCellActive = (size, color, active) => {
    const key = `${size}::${color}`
    const next = [...(value.variants || [])]
    const idx = next.findIndex((v) => `${v.size || ''}::${v.color || ''}` === key)
    if (idx >= 0) {
      if (!active) next.splice(idx, 1)
    } else if (active) {
      const colObj = colors.find((c) => c.name === color)
      next.push({
        size, color,
        colorHex: colObj?.hex || null,
        stock: 0, sku: null, lowStockThreshold: null, price: null,
      })
    }
    onChange?.({ variants: next })
  }

  if (!colors.length || !sizes.length) {
    return <p style={{ color: '#888', fontSize: '0.85rem' }}>
      Selecciona al menos un color y una talla para ver la matriz.
    </p>
  }

  const cellValue = (size, color) => variantMap.get(`${size}::${color}`)

  return (
    <div className="variant-matrix">
      <div className="matrix-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th className="corner">Color ↓ / Talla →</th>
              {sizes.map((s) => (
                <th key={s.id}>{s.value}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {colors.map((c) => (
              <tr key={c.id}>
                <th className="row-head" title={c.name}>
                  <span
                    style={{
                      display:        'inline-block',
                      width:          12, height: 12,
                      borderRadius:   '50%',
                      backgroundColor: c.hex,
                      border:         `1px solid ${(c.hex || '').toUpperCase() === '#FFFFFF' ? '#ddd' : c.hex}`,
                      marginRight:    6,
                      verticalAlign:  'middle',
                    }}
                  />
                  {c.name}
                </th>
                {sizes.map((s) => {
                  const cell = cellValue(s.value, c.name)
                  const active = !!cell
                  return (
                    <td key={`${s.id}-${c.id}`} className={active ? 'active' : ''}>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        className="stock-input"
                        value={cell?.stock ?? ''}
                        onChange={(e) => {
                          if (!active) toggleCellActive(s.value, c.name, true)
                          updateCell(s.value, c.name, 'stock', e.target.value)
                        }}
                        onFocus={() => { if (!active) toggleCellActive(s.value, c.name, true) }}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="matrix-advanced">
        <summary>Avanzado: SKU, precio y umbral por variante</summary>
        <div className="matrix-advanced-body">
          {(value.variants || []).filter((v) => v.stock > 0 || v.sku || v.price).map((v) => {
            const colObj = colors.find((c) => c.name === v.color)
            return (
              <div key={`${v.size}::${v.color}`} className="variant-row">
                <span className="variant-label">
                  <span
                    style={{
                      display:        'inline-block',
                      width:          10, height: 10,
                      borderRadius:   '50%',
                      backgroundColor: v.colorHex || colObj?.hex || '#ccc',
                      border:         `1px solid ${((v.colorHex || colObj?.hex) || '').toUpperCase() === '#FFFFFF' ? '#ddd' : (v.colorHex || colObj?.hex)}`,
                      marginRight:    6,
                    }}
                  />
                  {v.color} · {v.size || '—'}
                </span>
                <label>
                  <span>SKU</span>
                  <input
                    type="text"
                    value={v.sku || ''}
                    placeholder="opcional"
                    onChange={(e) => updateCell(v.size, v.color, 'sku', e.target.value)}
                  />
                </label>
                <label>
                  <span>Precio</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={v.price ?? ''}
                    placeholder={`usar precio base`}
                    onChange={(e) => updateCell(v.size, v.color, 'price', e.target.value)}
                  />
                </label>
                <label>
                  <span>Low stock</span>
                  <input
                    type="number"
                    min="0"
                    value={v.lowStockThreshold ?? ''}
                    placeholder={String(defaultLowStockThreshold)}
                    onChange={(e) => updateCell(v.size, v.color, 'lowStockThreshold', e.target.value)}
                  />
                </label>
              </div>
            )
          })}
        </div>
      </details>

      <p className="matrix-help">
        Click en una celda para activarla. Stock 0 desactiva la combinación. La columna "Low stock" es el umbral de alerta por variante (por defecto <code>{defaultLowStockThreshold}</code>).
      </p>

      <style>{`
        .variant-matrix { display: flex; flex-direction: column; gap: 0.75rem; }
        .matrix-scroll { overflow-x: auto; border: 1px solid var(--color-gray-200, #eee); border-radius: 8px; }
        .matrix-table { border-collapse: collapse; font-size: 0.8rem; min-width: 100%; }
        .matrix-table th, .matrix-table td {
          border: 1px solid var(--color-gray-100, #f5f5f5);
          padding: 6px;
          text-align: center;
          white-space: nowrap;
        }
        .matrix-table thead th {
          background: var(--color-gray-50, #fafafa);
          font-weight: 600;
          color: var(--color-gray-500, #555);
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .matrix-table .corner, .matrix-table .row-head {
          text-align: left;
          background: var(--color-gray-50, #fafafa);
          font-weight: 500;
          position: sticky;
        }
        .matrix-table .row-head { left: 0; z-index: 1; }
        .matrix-table td.active { background: #f0f9ff; }
        .stock-input {
          width: 64px; padding: 4px 6px; font-size: 0.8rem;
          border: 1px solid var(--color-gray-200, #eee);
          border-radius: 4px;
          text-align: center;
        }
        .stock-input:focus { outline: none; border-color: var(--color-black, #000); }
        .matrix-advanced summary { cursor: pointer; font-size: 0.85rem; color: var(--color-gray-500, #555); }
        .matrix-advanced-body { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
        .variant-row {
          display: grid; grid-template-columns: 160px 1fr 1fr 1fr; gap: 0.5rem; align-items: center;
          padding: 0.5rem; background: var(--color-gray-50, #fafafa); border-radius: 6px;
          font-size: 0.8rem;
        }
        .variant-label { font-weight: 500; }
        .variant-row label { display: flex; flex-direction: column; gap: 2px; font-size: 0.7rem; color: var(--color-gray-500, #555); }
        .variant-row input {
          padding: 4px 8px; border: 1px solid var(--color-gray-200, #eee);
          border-radius: 4px; font-size: 0.8rem;
        }
        .matrix-help { color: var(--color-gray-500, #555); font-size: 0.75rem; margin: 0; }
      `}</style>
    </div>
  )
}
