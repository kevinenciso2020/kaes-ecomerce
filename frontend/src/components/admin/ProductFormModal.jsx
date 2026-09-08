import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api.js'
import ImageUploader  from './ImageUploader.jsx'
import VariantMatrix  from './VariantMatrix.jsx'
import ColorSwatch    from './ColorSwatch.jsx'

/**
 * Modal para crear/editar un producto.
 *
 * Props:
 *  - product?: si viene, es edición. Si no, es creación.
 *  - categories: [{ id, name, slug }]
 *  - colors: [{ id, name, hex }]
 *  - sizes: [{ id, value, scale }]
 *  - onClose: () => void
 *  - onSaved: (product) => void
 */
export default function ProductFormModal({
  product,
  categories,
  colors,
  sizes,
  onClose,
  onSaved,
}) {
  const isEdit = !!product
  const [name, setName]               = useState(product?.name || '')
  const [description, setDescription] = useState(product?.description || '')
  const [price, setPrice]             = useState(product?.price ?? '')
  const [stock, setStock]             = useState(product?.stock ?? 0)
  const [lowStockThreshold, setLowStockThreshold] = useState(product?.lowStockThreshold ?? 5)
  const [categorySlug, setCategorySlug] = useState(product?.category?.slug || '')
  const [isFeatured, setIsFeatured]   = useState(product?.isFeatured || false)
  const [isActive, setIsActive]       = useState(product?.isActive ?? true)

  const [availableSizeIds, setAvailableSizeIds] = useState(
    () => new Set((product?.availableSizes || []).map((as) => as.sizeId))
  )

  const [variants, setVariants] = useState({
    variants: (product?.variants || []).map((v) => ({
      size: v.size || null,
      color: v.color || null,
      colorHex: v.colorHex || null,
      stock: v.stock || 0,
      sku: v.sku || null,
      lowStockThreshold: v.lowStockThreshold ?? null,
      price: v.price !== null && v.price !== undefined ? Number(v.price) : null,
    })),
  })

  const [imagesPayload, setImagesPayload] = useState({ files: [], removedIds: [], mainImageId: null })

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Snapshot de las props que necesitamos si cambian mientras el modal está abierto
  useEffect(() => { /* trigger redraw on categories/colors/sizes load */ }, [categories, colors, sizes])

  const toggleSize = (sizeId) => {
    const next = new Set(availableSizeIds)
    if (next.has(sizeId)) next.delete(sizeId)
    else next.add(sizeId)
    setAvailableSizeIds(next)
  }

  // Agrupar sizes por scale para mostrar el selector
  const sizesByScale = sizes.reduce((acc, s) => {
    if (!acc[s.scale]) acc[s.scale] = []
    acc[s.scale].push(s)
    return acc
  }, {})

  // Colores que están siendo usados en variants (para filtrar la matriz)
  const usedColors = colors.filter((c) =>
    variants.variants.some((v) => v.color === c.name)
  )

  // Tallas disponibles (filtradas por la selección de availableSizeIds)
  const availableSizes = sizes.filter((s) => availableSizeIds.has(s.id))

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)

    try {
      // Filtrar variants: solo las que tienen size o color definido y stock > 0
      // (o SKU/price seteados para futuro — por simplicidad, dejamos stock > 0)
      const cleanVariants = variants.variants
        .filter((v) => (v.size || v.color) && v.stock >= 0)
        .map((v) => ({
          size: v.size || null,
          color: v.color || null,
          colorHex: v.colorHex || null,
          sku: v.sku || null,
          stock: parseInt(v.stock) || 0,
          lowStockThreshold: v.lowStockThreshold !== null ? parseInt(v.lowStockThreshold) : null,
          price: v.price !== null && v.price !== '' ? parseFloat(v.price) : null,
        }))

      const formData = new FormData()
      formData.append('name', name.trim())
      formData.append('description', description)
      formData.append('price', parseFloat(price).toString())
      formData.append('stock', String(parseInt(stock) || 0))
      formData.append('lowStockThreshold', String(parseInt(lowStockThreshold) || 5))
      formData.append('categorySlug', categorySlug)
      formData.append('isFeatured', isFeatured ? 'true' : 'false')
      formData.append('isActive',   isActive ? 'true' : 'false')
      formData.append('variants',   JSON.stringify(cleanVariants))
      formData.append('sizeIds',    JSON.stringify(Array.from(availableSizeIds)))
      for (const f of imagesPayload.files) {
        formData.append('images', f, f.name)
      }

      const saved = isEdit
        ? await api.admin.updateProduct(product.id, formData)
        : await api.admin.createProduct(formData)

      onSaved?.(saved)
    } catch (err) {
      setError(err.message || 'Error al guardar el producto')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="modal-content large">
        <div className="modal-header">
          <h2>{isEdit ? `Editar: ${product.name}` : 'Nuevo producto'}</h2>
          <button className="modal-close" onClick={onClose} type="button">×</button>
        </div>

        <form onSubmit={submit} className="product-form">
          {error && <div className="form-error">{error}</div>}

          <section className="form-section">
            <h3 className="section-label">Información básica</h3>
            <div className="form-group">
              <label>Nombre *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </div>

            <div className="form-group">
              <label>Descripción</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={5000}
              />
            </div>

            <div className="form-row three">
              <div className="form-group">
                <label>Precio (COP) *</label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="form-group">
                <label>Stock base</label>
                <input
                  type="number"
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  min="0"
                />
                <small>Stock general del producto (sin contar variantes).</small>
              </div>
              <div className="form-group">
                <label>Low stock (alerta)</label>
                <input
                  type="number"
                  value={lowStockThreshold}
                  onChange={(e) => setLowStockThreshold(e.target.value)}
                  min="0"
                />
                <small>Umbral por defecto para variantes.</small>
              </div>
            </div>

            <div className="form-group">
              <label>Categoría *</label>
              <select
                value={categorySlug}
                onChange={(e) => setCategorySlug(e.target.value)}
                required
              >
                <option value="">Seleccionar categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.slug}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="form-row checkboxes">
              <label className="checkbox-label">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span>Producto activo (visible en la tienda)</span>
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} />
                <span>Destacado</span>
              </label>
            </div>
          </section>

          <section className="form-section">
            <h3 className="section-label">Imágenes</h3>
            <ImageUploader
              mode={isEdit ? 'existing' : 'new'}
              productId={isEdit ? product.id : undefined}
              images={isEdit ? (product.images || []) : []}
              onChange={setImagesPayload}
            />
          </section>

          <section className="form-section">
            <h3 className="section-label">Tallas disponibles para este producto</h3>
            {Object.keys(sizesByScale).length === 0 ? (
              <p style={{ color: '#888', fontSize: '0.85rem' }}>Cargando tallas…</p>
            ) : (
              Object.entries(sizesByScale).map(([scale, list]) => (
                <div key={scale} className="size-scale-group">
                  <span className="scale-label">
                    {scale === 'LETTER' ? 'Letras (camisetas, blusas)' : scale === 'NUMERIC' ? 'Numéricas (pantalones, jeans)' : 'Zapatos'}
                  </span>
                  <div className="size-buttons">
                    {list.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`size-btn ${availableSizeIds.has(s.id) ? 'on' : ''}`}
                        onClick={() => toggleSize(s.id)}
                      >
                        {s.value}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="form-section">
            <h3 className="section-label">
              Variantes (matriz color × talla)
              <span className="section-hint">
                {usedColors.length > 0 && availableSizes.length > 0
                  ? `${usedColors.length} colores × ${availableSizes.length} tallas`
                  : 'Selecciona arriba al menos un color y una talla'}
              </span>
            </h3>
            <div className="variant-controls">
              <p className="muted">Colores incluidos:</p>
              <div className="active-colors">
                {usedColors.length === 0 ? (
                  <small style={{ color: '#888' }}>Ninguno. Usa los toggles de abajo para agregar.</small>
                ) : usedColors.map((c) => (
                  <label key={c.id} className="active-color-chip">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => {
                        // Quitar todas las variantes de este color
                        const next = variants.variants.filter((v) => v.color !== c.name)
                        setVariants({ variants: next })
                      }}
                    />
                    <ColorSwatch hex={c.hex} name={c.name} size={12} />
                  </label>
                ))}
              </div>
              <details className="color-picker">
                <summary>+ Agregar color</summary>
                <div className="color-picker-grid">
                  {colors.filter((c) => !usedColors.find((u) => u.id === c.id)).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="color-pick-btn"
                      onClick={() => {
                        // Agregar una variante "vacía" por cada talla disponible
                        const next = [...variants.variants]
                        for (const s of availableSizes) {
                          const key = `${s.value}::${c.name}`
                          if (!next.find((v) => `${v.size || ''}::${v.color || ''}` === key)) {
                            next.push({ size: s.value, color: c.name, colorHex: c.hex, stock: 0, sku: null, lowStockThreshold: null, price: null })
                          }
                        }
                        setVariants({ variants: next })
                      }}
                    >
                      <ColorSwatch hex={c.hex} name={c.name} size={12} />
                    </button>
                  ))}
                </div>
              </details>
            </div>

            <VariantMatrix
              colors={usedColors}
              sizes={availableSizes}
              value={variants}
              onChange={setVariants}
              defaultLowStockThreshold={parseInt(lowStockThreshold) || 5}
            />
          </section>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name || !price || !categorySlug}>
              {busy ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear producto')}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .modal-content.large { max-width: 800px; }
        .product-form { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; max-height: 80vh; overflow-y: auto; }
        .form-section { display: flex; flex-direction: column; gap: 0.75rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--color-gray-100, #f5f5f5); }
        .form-section:last-of-type { border-bottom: none; }
        .section-label {
          display: flex; align-items: baseline; gap: 0.75rem;
          font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.1em; color: var(--color-gray-400, #888); margin: 0;
        }
        .section-hint { font-size: 0.7rem; color: var(--color-gray-500, #555); font-weight: 400; text-transform: none; letter-spacing: 0; }
        .form-group { display: flex; flex-direction: column; gap: 0.35rem; }
        .form-group label { font-size: 0.85rem; font-weight: 500; }
        .form-group input, .form-group select, .form-group textarea {
          padding: 0.5rem 0.75rem; border: 1px solid var(--color-gray-200, #eee); border-radius: 6px;
          font-size: 0.875rem; font-family: inherit;
        }
        .form-group small { color: var(--color-gray-400, #888); font-size: 0.7rem; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        .form-row.three { grid-template-columns: 1fr 1fr 1fr; }
        .form-row.checkboxes { gap: 1.5rem; }
        .checkbox-label { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.85rem; }
        .form-error { background: #fee2e2; color: #991b1b; padding: 0.75rem 1rem; border-radius: 6px; font-size: 0.85rem; }
        .size-scale-group { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
        .scale-label { font-size: 0.75rem; color: var(--color-gray-500, #555); min-width: 220px; }
        .size-buttons { display: flex; gap: 0.35rem; flex-wrap: wrap; }
        .size-btn {
          padding: 0.35rem 0.75rem; border: 1px solid var(--color-gray-200, #eee);
          background: var(--color-white, #fff); border-radius: 6px;
          cursor: pointer; font-size: 0.8rem;
        }
        .size-btn.on { background: var(--color-black, #000); color: var(--color-white, #fff); border-color: var(--color-black, #000); }
        .variant-controls { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem; background: var(--color-gray-50, #fafafa); border-radius: 6px; }
        .muted { color: var(--color-gray-500, #555); font-size: 0.75rem; margin: 0; }
        .active-colors { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
        .active-color-chip { display: inline-flex; align-items: center; cursor: pointer; }
        .color-picker summary { cursor: pointer; font-size: 0.8rem; color: var(--color-gray-500, #555); }
        .color-picker-grid { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.5rem; }
        .color-pick-btn { background: none; border: 1px solid var(--color-gray-200, #eee); border-radius: 999px; padding: 4px 10px; cursor: pointer; font-size: 0.75rem; }
        .color-pick-btn:hover { border-color: var(--color-black, #000); }
      `}</style>
    </div>
  )
}
