import React, { useState } from 'react'
import ColorSwatch from './ColorSwatch.jsx'

/**
 * Editor de stock por variante.
 *
 * Soporta los tres casos:
 *  - colores × tallas  → matriz (filas = color, columnas = talla)
 *  - sólo colores      → una fila por color
 *  - sólo tallas       → una fila por talla
 *
 * Props:
 *  - colors: [{ name, hex }]      colores seleccionados
 *  - sizes:  [{ id, value }]      tallas seleccionadas (en orden)
 *  - cells:  { [key]: { stock, sku, basePrice } }   key = `${talla}::${color}`
 *  - onChange(nextCells)
 */
export const variantKey = (size, color) => `${size ?? ''}::${color ?? ''}`

export const buildCombos = (colors, sizes) => {
  if (colors.length && sizes.length) {
    return colors.flatMap((c) => sizes.map((s) => ({ size: s.value, color: c.name, colorHex: c.hex })))
  }
  if (colors.length) return colors.map((c) => ({ size: null, color: c.name, colorHex: c.hex }))
  if (sizes.length) return sizes.map((s) => ({ size: s.value, color: null, colorHex: null }))
  return []
}

export default function VariantEditor({ colors = [], sizes = [], cells = {}, onChange }) {
  const [bulkStock, setBulkStock] = useState('')

  const combos = buildCombos(colors, sizes)
  if (combos.length === 0) {
    return <p className="ve-empty">Selecciona al menos un color o una talla para cargar el stock.</p>
  }

  const get = (size, color) => cells[variantKey(size, color)] || { stock: 0, sku: '', basePrice: '' }

  const update = (size, color, field, raw) => {
    const key = variantKey(size, color)
    const current = get(size, color)
    let value = raw
    if (field === 'stock') {
      const n = Number.parseInt(raw, 10)
      value = Number.isNaN(n) || n < 0 ? 0 : Math.min(n, 99999)
    }
    onChange?.({ ...cells, [key]: { ...current, [field]: value } })
  }

  const applyBulk = () => {
    const n = Number.parseInt(bulkStock, 10)
    if (Number.isNaN(n) || n < 0) return
    const next = { ...cells }
    for (const c of combos) {
      const key = variantKey(c.size, c.color)
      next[key] = { ...(next[key] || { sku: '', basePrice: '' }), stock: n }
    }
    onChange?.(next)
  }

  const total = combos.reduce((sum, c) => sum + (Number(get(c.size, c.color).stock) || 0), 0)

  const stockInput = (size, color, label) => (
    <input
      type="number"
      min="0"
      inputMode="numeric"
      className="ve-stock"
      aria-label={label}
      value={get(size, color).stock}
      onChange={(e) => update(size, color, 'stock', e.target.value)}
      onFocus={(e) => e.target.select()}
    />
  )

  return (
    <div className="variant-editor">
      <div className="ve-toolbar">
        <label className="ve-bulk">
          <span>Mismo stock para todas</span>
          <input type="number" min="0" inputMode="numeric" value={bulkStock} onChange={(e) => setBulkStock(e.target.value)} placeholder="ej. 10" />
        </label>
        <button type="button" className="ve-btn" onClick={applyBulk}>Aplicar</button>
        <span className="ve-total">Total: <strong>{total}</strong> unidades · {combos.length} variantes</span>
      </div>

      <div className="ve-scroll">
        {colors.length > 0 && sizes.length > 0 ? (
          <table className="ve-table">
            <thead>
              <tr>
                <th className="ve-corner">Color \ Talla</th>
                {sizes.map((s) => <th key={s.id}>{s.value}</th>)}
              </tr>
            </thead>
            <tbody>
              {colors.map((c) => (
                <tr key={c.name}>
                  <th className="ve-rowhead"><ColorSwatch hex={c.hex} name={c.name} size={12} /></th>
                  {sizes.map((s) => (
                    <td key={s.id} className={Number(get(s.value, c.name).stock) > 0 ? 'has-stock' : ''}>
                      {stockInput(s.value, c.name, `Stock ${c.name} talla ${s.value}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="ve-table">
            <thead>
              <tr><th className="ve-corner">{colors.length ? 'Color' : 'Talla'}</th><th>Stock</th></tr>
            </thead>
            <tbody>
              {combos.map((c) => (
                <tr key={variantKey(c.size, c.color)}>
                  <th className="ve-rowhead">
                    {c.color ? <ColorSwatch hex={c.colorHex} name={c.color} size={12} /> : c.size}
                  </th>
                  <td className={Number(get(c.size, c.color).stock) > 0 ? 'has-stock' : ''}>
                    {stockInput(c.size, c.color, `Stock ${c.color || c.size}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <details className="ve-advanced">
        <summary>Opcional: SKU y precio distinto por variante</summary>
        <div className="ve-adv-list">
          {combos.map((c) => {
            const cell = get(c.size, c.color)
            const label = [c.color, c.size].filter(Boolean).join(' · ')
            return (
              <div key={variantKey(c.size, c.color)} className="ve-adv-row">
                <span className="ve-adv-label">{c.color ? <ColorSwatch hex={c.colorHex} name={label} size={10} /> : label}</span>
                <input type="text" placeholder="SKU" value={cell.sku || ''} maxLength={60} onChange={(e) => update(c.size, c.color, 'sku', e.target.value)} />
                <input type="number" min="0" step="100" placeholder="Precio sin IVA (vacío = el del producto)" value={cell.basePrice ?? ''} onChange={(e) => update(c.size, c.color, 'basePrice', e.target.value)} />
              </div>
            )
          })}
        </div>
      </details>

      <style>{`
        .variant-editor { display: flex; flex-direction: column; gap: 0.6rem; }
        .ve-empty { color: #888; font-size: 0.85rem; margin: 0; }
        .ve-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.5rem; }
        .ve-bulk { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.75rem; color: #555; }
        .ve-bulk input { width: 110px; padding: 0.4rem 0.5rem; border: 1px solid #ddd; border-radius: 6px; }
        .ve-btn { padding: 0.45rem 0.8rem; border: 1px solid #111; background: #111; color: #fff; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
        .ve-total { margin-left: auto; font-size: 0.8rem; color: #555; }
        .ve-scroll { overflow-x: auto; border: 1px solid #eee; border-radius: 8px; }
        .ve-table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
        .ve-table th, .ve-table td { padding: 0.35rem; border-bottom: 1px solid #f1f1f1; text-align: center; }
        .ve-corner { text-align: left !important; color: #888; font-weight: 500; white-space: nowrap; }
        .ve-rowhead { text-align: left !important; white-space: nowrap; font-weight: 500; }
        .ve-table td.has-stock { background: #f0fdf4; }
        .ve-stock { width: 64px; padding: 0.35rem; border: 1px solid #ddd; border-radius: 5px; text-align: center; font-size: 0.85rem; }
        .ve-advanced summary { cursor: pointer; font-size: 0.8rem; color: #555; }
        .ve-adv-list { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.5rem; }
        .ve-adv-row { display: grid; grid-template-columns: 1.2fr 1fr 1.3fr; gap: 0.4rem; align-items: center; }
        .ve-adv-row input { padding: 0.35rem 0.5rem; border: 1px solid #ddd; border-radius: 5px; font-size: 0.8rem; min-width: 0; }
        .ve-adv-label { font-size: 0.8rem; }
        @media (max-width: 600px) { .ve-adv-row { grid-template-columns: 1fr; } .ve-total { margin-left: 0; width: 100%; } }
      `}</style>
    </div>
  )
}
