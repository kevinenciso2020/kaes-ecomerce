import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api.js'
import ImageUploader from './ImageUploader.jsx'
import VariantEditor, { buildCombos, variantKey } from './VariantEditor.jsx'
import ColorSwatch from './ColorSwatch.jsx'
import { finalPrice, formatCOP, MAX_BASE_PRICE, MSG_PRECIO_MAX } from '../../lib/tax.js'

/**
 * Crear / editar un producto.
 *
 * Props:
 *  - product?: producto completo (GET /admin/products/:id) → modo edición
 *  - categories, colors, sizes: catálogos
 *  - onClose(), onSaved(product)
 *  - onCatalogChange(): recargar categorías/colores tras crear uno nuevo
 */
const SCALE_LABELS = {
  LETTER: 'Letras (camisetas, buzos)',
  NUMERIC: 'Numéricas (pantalones, jeans)',
  SHOE: 'Calzado',
}

const initialCells = (product) => {
  const cells = {}
  for (const v of product?.variants || []) {
    cells[variantKey(v.size, v.color)] = {
      stock: v.stock ?? 0,
      sku: v.sku || '',
      basePrice: v.basePrice != null ? Number(v.basePrice) : '',
    }
  }
  return cells
}

export default function ProductFormModal({ product, categories, colors, sizes, onClose, onSaved, onCatalogChange }) {
  const isEdit = Boolean(product)
  const hasVariants = (product?.variants || []).length > 0

  const [name, setName] = useState(product?.name || '')
  const [description, setDescription] = useState(product?.description || '')
  const [price, setPrice] = useState(product?.basePrice != null ? String(Math.round(Number(product.basePrice) * 100) / 100) : '')
  // Tasa propia del producto existente (null si no es numérica → se trata como "sin taxRate")
  const ownRate = product && product.taxRate != null && Number.isFinite(Number(product.taxRate)) ? Number(product.taxRate) : null
  const [exempt, setExempt] = useState(ownRate === 0)
  const [generalRate, setGeneralRate] = useState(null)
  const [rateFailed, setRateFailed] = useState(false)
  useEffect(() => {
    let alive = true
    Promise.resolve()
      .then(() => api.admin.tax())
      .then((t) => {
        if (!alive) return
        if (Number.isFinite(Number(t?.rate))) setGeneralRate(Number(t.rate))
        else setRateFailed(true)
      })
      .catch(() => { if (alive) setRateFailed(true) })
    return () => { alive = false }
  }, [])
  // Tasa de la vista previa: exento → 0; existente con tasa propia distinta de 0 → la suya;
  // en cualquier otro caso (nuevo, o existente que se quita de exento) → la vigente (null mientras no cargue)
  const rate = exempt ? 0 : (isEdit && ownRate != null && ownRate !== 0 ? ownRate : generalRate)
  const [categoryId, setCategoryId] = useState(product?.categoryId || product?.category?.id || '')
  const [isActive, setIsActive] = useState(product?.isActive ?? true)
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false)
  const [lowStockThreshold, setLowStockThreshold] = useState(product?.lowStockThreshold ?? 5)

  const [mode, setMode] = useState(hasVariants ? 'variants' : 'simple')
  const [stock, setStock] = useState(product?.stock ?? 0)

  const [selectedColors, setSelectedColors] = useState(
    () => new Set((product?.variants || []).map((v) => v.color).filter(Boolean)),
  )
  const [selectedSizes, setSelectedSizes] = useState(() => {
    const fromVariants = new Set((product?.variants || []).map((v) => v.size).filter(Boolean))
    const ids = sizes.filter((s) => fromVariants.has(s.value)).map((s) => s.id)
    for (const as of product?.availableSizes || []) ids.push(as.sizeId)
    return new Set(ids)
  })
  const [cells, setCells] = useState(() => initialCells(product))
  const [imagesPayload, setImagesPayload] = useState({ files: [], urls: [] })

  const [newCategory, setNewCategory] = useState(null)   // null | string
  const [newColor, setNewColor] = useState(null)         // null | { name, hex }
  const [colorFilter, setColorFilter] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  // Cerrar con Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // Colores del producto que ya no están en el catálogo (p. ej. renombrados)
  const colorObjects = useMemo(() => {
    const known = colors.filter((c) => selectedColors.has(c.name))
    const unknown = [...selectedColors].filter((n) => !colors.some((c) => c.name === n))
      .map((n) => ({ name: n, hex: product?.variants?.find((v) => v.color === n)?.colorHex || '#cccccc' }))
    return [...known, ...unknown]
  }, [colors, selectedColors, product])

  const sizeObjects = useMemo(() => sizes.filter((s) => selectedSizes.has(s.id)), [sizes, selectedSizes])

  const sizesByScale = useMemo(() => sizes.reduce((acc, s) => {
    (acc[s.scale] ||= []).push(s)
    return acc
  }, {}), [sizes])

  const visibleColors = colors.filter((c) => c.name.toLowerCase().includes(colorFilter.trim().toLowerCase()))

  const toggleColor = (name) => {
    const next = new Set(selectedColors)
    next.has(name) ? next.delete(name) : next.add(name)
    setSelectedColors(next)
  }
  const toggleSize = (id) => {
    const next = new Set(selectedSizes)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelectedSizes(next)
  }

  const createCategory = async () => {
    const value = (newCategory || '').trim()
    if (value.length < 2) return setError('El nombre de la categoría debe tener al menos 2 letras')
    try {
      const cat = await api.admin.createCategory({ name: value })
      await onCatalogChange?.()
      setCategoryId(cat.id)
      setNewCategory(null)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  const createColor = async () => {
    if (!newColor?.name?.trim()) return setError('Escribe el nombre del color')
    try {
      const color = await api.admin.createColor({ name: newColor.name.trim(), hex: newColor.hex })
      await onCatalogChange?.()
      setSelectedColors((prev) => new Set([...prev, color.name]))
      setNewColor(null)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  const buildVariants = () =>
    buildCombos(colorObjects, sizeObjects).map((c) => {
      const cell = cells[variantKey(c.size, c.color)] || {}
      return {
        size: c.size,
        color: c.color,
        colorHex: c.colorHex,
        stock: Number.parseInt(cell.stock, 10) || 0,
        sku: cell.sku?.trim() || null,
        basePrice: cell.basePrice !== '' && cell.basePrice != null ? Number(cell.basePrice) : null,
      }
    })

  const validate = () => {
    const errs = {}
    if (name.trim().length < 2) errs.name = 'Mínimo 2 caracteres'
    const p = Number(price)
    if (!price || Number.isNaN(p) || p <= 0) errs.price = 'Escribe un precio mayor que 0'
    else if (p > MAX_BASE_PRICE) errs.price = MSG_PRECIO_MAX
    if (!categoryId) errs.category = 'Elige una categoría'
    if (mode === 'variants' && selectedColors.size === 0 && selectedSizes.size === 0) {
      errs.variants = 'Elige al menos un color o una talla (o cambia a producto simple)'
    }
    const skus = mode === 'variants' ? buildVariants().map((v) => v.sku).filter(Boolean) : []
    if (new Set(skus).size !== skus.length) errs.variants = 'Hay SKUs repetidos'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!validate()) {
      setError('Revisa los campos marcados')
      return
    }
    // taxRate solo se envía cuando cambia el estado de exento; si no, el backend conserva/usa la vigente
    const wasExempt = isEdit && ownRate === 0
    let sendRate = null
    if (exempt && !wasExempt) sendRate = '0'
    else if (!exempt && wasExempt) {
      if (generalRate == null) {
        setError('No se pudo leer la tasa de IVA vigente; recarga la página para quitar la exención.')
        return
      }
      sendRate = String(generalRate)
    }
    setBusy(true)
    try {
      const variants = mode === 'variants' ? buildVariants() : []
      const form = new FormData()
      form.append('name', name.trim())
      form.append('description', description.trim())
      form.append('basePrice', String(Math.round(Number(price) * 100) / 100))
      if (sendRate != null) form.append('taxRate', sendRate)
      form.append('categoryId', categoryId)
      form.append('isActive', String(isActive))
      form.append('isFeatured', String(isFeatured))
      form.append('lowStockThreshold', String(Number.parseInt(lowStockThreshold, 10) || 0))
      form.append('stock', String(mode === 'simple' ? Number.parseInt(stock, 10) || 0 : 0))
      form.append('variants', JSON.stringify(variants))
      form.append('sizeIds', JSON.stringify(mode === 'variants' ? [...selectedSizes] : []))
      if (imagesPayload.urls.length) form.append('imageUrls', JSON.stringify(imagesPayload.urls))
      for (const f of imagesPayload.files) form.append('images', f, f.name)

      const saved = isEdit
        ? await api.admin.updateProduct(product.id, form)
        : await api.admin.createProduct(form)
      onSaved?.(saved)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el producto')
    } finally {
      setBusy(false)
    }
  }

  const totalVariantStock = mode === 'variants' ? buildVariants().reduce((s, v) => s + v.stock, 0) : null

  return (
    <div className="pf-backdrop" role="dialog" aria-modal="true" aria-labelledby="pf-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.() }}>
      <form className="pf-modal" onSubmit={submit} noValidate>
        <header className="pf-header">
          <h2 id="pf-title">{isEdit ? `Editar: ${product.name}` : 'Nuevo producto'}</h2>
          <button type="button" className="pf-close" onClick={onClose} disabled={busy} aria-label="Cerrar">×</button>
        </header>

        <div className="pf-body">
          {error && <div className="pf-error" role="alert">{error}</div>}

          {/* ── Información básica ─────────────────────────── */}
          <section className="pf-section">
            <h3>Información básica</h3>
            <label className={`pf-field ${fieldErrors.name ? 'invalid' : ''}`}>
              <span>Nombre *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Ej. Camiseta oversize algodón" autoFocus />
              {fieldErrors.name && <em>{fieldErrors.name}</em>}
            </label>
            <label className="pf-field">
              <span>Descripción</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={5000}
                placeholder="Material, horma, cuidados, medidas…" />
            </label>
            <div className="pf-row">
              <div className="pf-field">
                <label className={`pf-field ${fieldErrors.price ? 'invalid' : ''}`}>
                  <span>Precio sin IVA (COP) *</span>
                  <input type="number" inputMode="decimal" min="1" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="50000" />
                </label>
                {Number(price) > 0 && (rate == null ? (
                  <small>Calculando IVA…</small>
                ) : (() => {
                  const base = Math.round(Number(price) * 100) / 100
                  return (
                    <small>
                      IVA ({rate} %): {formatCOP(finalPrice(base, rate) - base)} · <strong>Precio final: {formatCOP(finalPrice(base, rate))}</strong>
                    </small>
                  )
                })())}
                {rateFailed && !isEdit && !exempt && (
                  <small>No se pudo leer la tasa de IVA; se usará la vigente al guardar.</small>
                )}
                <div className="pf-check">
                  <input id="pf-exempt" type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
                  <label htmlFor="pf-exempt">Producto exento de IVA</label>
                </div>
                {fieldErrors.price && <em>{fieldErrors.price}</em>}
              </div>
              <label className={`pf-field ${fieldErrors.category ? 'invalid' : ''}`}>
                <span>Categoría *</span>
                {newCategory === null ? (
                  <div className="pf-inline">
                    <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                      <option value="">Seleccionar…</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button type="button" className="pf-link" onClick={() => setNewCategory('')}>+ Nueva</button>
                  </div>
                ) : (
                  <div className="pf-inline">
                    <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Nombre de la categoría" maxLength={60}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createCategory() } }} />
                    <button type="button" className="pf-small" onClick={createCategory}>Crear</button>
                    <button type="button" className="pf-link" onClick={() => setNewCategory(null)}>Cancelar</button>
                  </div>
                )}
                {fieldErrors.category && <em>{fieldErrors.category}</em>}
              </label>
            </div>
            <div className="pf-checks">
              <label><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Visible en la tienda</label>
              <label><input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} /> Destacado en el inicio</label>
            </div>
          </section>

          {/* ── Imágenes ──────────────────────────────────── */}
          <section className="pf-section">
            <h3>Fotos</h3>
            <ImageUploader
              productId={isEdit ? product.id : undefined}
              images={product?.images}
              onChange={setImagesPayload}
            />
          </section>

          {/* ── Inventario ────────────────────────────────── */}
          <section className="pf-section">
            <h3>Inventario</h3>
            <div className="pf-mode" role="radiogroup" aria-label="Tipo de inventario">
              <label className={mode === 'simple' ? 'on' : ''}>
                <input type="radio" name="mode" checked={mode === 'simple'} onChange={() => setMode('simple')} />
                <strong>Producto simple</strong>
                <small>Sin tallas ni colores (ej. accesorio de talla única)</small>
              </label>
              <label className={mode === 'variants' ? 'on' : ''}>
                <input type="radio" name="mode" checked={mode === 'variants'} onChange={() => setMode('variants')} />
                <strong>Con tallas y/o colores</strong>
                <small>Stock independiente por cada combinación</small>
              </label>
            </div>

            {mode === 'simple' ? (
              <div className="pf-row">
                <label className="pf-field">
                  <span>Stock disponible</span>
                  <input type="number" inputMode="numeric" min="0" value={stock} onChange={(e) => setStock(e.target.value)} />
                </label>
                <label className="pf-field">
                  <span>Alerta de stock bajo</span>
                  <input type="number" inputMode="numeric" min="0" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} />
                </label>
              </div>
            ) : (
              <>
                <div className="pf-subsection">
                  <div className="pf-subhead">
                    <span>Colores <small>({selectedColors.size} elegidos)</small></span>
                    <input className="pf-filter" placeholder="Buscar color…" value={colorFilter} onChange={(e) => setColorFilter(e.target.value)} />
                  </div>
                  <div className="pf-colors">
                    {visibleColors.map((c) => (
                      <button type="button" key={c.id} className={`pf-color ${selectedColors.has(c.name) ? 'on' : ''}`}
                        onClick={() => toggleColor(c.name)} aria-pressed={selectedColors.has(c.name)}>
                        <ColorSwatch hex={c.hex} name={c.name} size={14} />
                      </button>
                    ))}
                    {newColor === null ? (
                      <button type="button" className="pf-color add" onClick={() => setNewColor({ name: '', hex: '#888888' })}>+ Color personalizado</button>
                    ) : (
                      <span className="pf-newcolor">
                        <input type="color" value={newColor.hex} onChange={(e) => setNewColor({ ...newColor, hex: e.target.value.toUpperCase() })} aria-label="Tono" />
                        <input value={newColor.name} onChange={(e) => setNewColor({ ...newColor, name: e.target.value })} placeholder="Nombre (ej. Terracota)" maxLength={40}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createColor() } }} />
                        <button type="button" className="pf-small" onClick={createColor}>Crear</button>
                        <button type="button" className="pf-link" onClick={() => setNewColor(null)}>Cancelar</button>
                      </span>
                    )}
                  </div>
                </div>

                <div className="pf-subsection">
                  <div className="pf-subhead"><span>Tallas <small>({selectedSizes.size} elegidas)</small></span></div>
                  {Object.entries(sizesByScale).map(([scale, list]) => (
                    <div key={scale} className="pf-scale">
                      <span className="pf-scale-label">{SCALE_LABELS[scale] || scale}</span>
                      <div className="pf-sizes">
                        {list.map((s) => (
                          <button type="button" key={s.id} className={`pf-size ${selectedSizes.has(s.id) ? 'on' : ''}`}
                            onClick={() => toggleSize(s.id)} aria-pressed={selectedSizes.has(s.id)}>{s.value}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {fieldErrors.variants && <p className="pf-inline-error">{fieldErrors.variants}</p>}
                <VariantEditor colors={colorObjects} sizes={sizeObjects} cells={cells} onChange={setCells} />
                <label className="pf-field pf-narrow">
                  <span>Alerta de stock bajo (por variante)</span>
                  <input type="number" inputMode="numeric" min="0" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} />
                </label>
              </>
            )}
          </section>
        </div>

        <footer className="pf-footer">
          {mode === 'variants' && <span className="pf-summary">{totalVariantStock} unidades en total</span>}
          <button type="button" className="pf-btn secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="pf-btn primary" disabled={busy}>
            {busy ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </footer>
      </form>

      <style>{`
        .pf-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 1000; display: flex; align-items: flex-start; justify-content: center; padding: 1.5rem 0.75rem; overflow-y: auto; }
        .pf-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 860px; display: flex; flex-direction: column; max-height: calc(100dvh - 3rem); }
        .pf-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid #eee; }
        .pf-header h2 { font-size: 1.1rem; margin: 0; }
        .pf-close { background: none; border: none; font-size: 1.6rem; cursor: pointer; line-height: 1; }
        .pf-body { padding: 1.25rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1.25rem; }
        .pf-footer { display: flex; gap: 0.6rem; justify-content: flex-end; align-items: center; padding: 0.85rem 1.25rem; border-top: 1px solid #eee; background: #fafafa; border-radius: 0 0 14px 14px; }
        .pf-summary { margin-right: auto; font-size: 0.8rem; color: #555; }
        .pf-section { display: flex; flex-direction: column; gap: 0.75rem; padding-bottom: 1.25rem; border-bottom: 1px solid #f1f1f1; }
        .pf-section:last-child { border-bottom: none; }
        .pf-section h3 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: .08em; color: #888; margin: 0; }
        .pf-field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; flex: 1; min-width: 0; }
        .pf-field > span { font-weight: 500; }
        .pf-field input, .pf-field textarea, .pf-field select { padding: 0.55rem 0.7rem; border: 1px solid #ddd; border-radius: 7px; font: inherit; font-size: 0.9rem; min-width: 0; }
        .pf-check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; }
        .pf-check input { padding: 0; }
        .pf-field small { color: #888; font-size: 0.72rem; }
        .pf-field em { color: #b91c1c; font-size: 0.75rem; font-style: normal; }
        .pf-field.invalid input, .pf-field.invalid select { border-color: #ef4444; }
        .pf-narrow { max-width: 260px; }
        .pf-row { display: flex; gap: 0.75rem; flex-wrap: wrap; }
        .pf-row > * { flex: 1 1 220px; }
        .pf-inline { display: flex; gap: 0.4rem; align-items: center; }
        .pf-inline select, .pf-inline input { flex: 1; min-width: 0; }
        .pf-link { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 0.8rem; white-space: nowrap; padding: 0.25rem; }
        .pf-small { padding: 0.45rem 0.7rem; border: 1px solid #111; background: #111; color: #fff; border-radius: 6px; cursor: pointer; font-size: 0.78rem; }
        .pf-checks { display: flex; gap: 1.25rem; flex-wrap: wrap; font-size: 0.85rem; }
        .pf-checks label { display: flex; align-items: center; gap: 0.4rem; cursor: pointer; }
        .pf-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
        .pf-mode label { border: 1.5px solid #e5e5e5; border-radius: 10px; padding: 0.7rem; display: flex; flex-direction: column; gap: 0.15rem; cursor: pointer; font-size: 0.85rem; }
        .pf-mode label.on { border-color: #111; background: #fafafa; }
        .pf-mode input { position: absolute; opacity: 0; pointer-events: none; }
        .pf-mode small { color: #777; font-size: 0.74rem; }
        .pf-subsection { display: flex; flex-direction: column; gap: 0.45rem; }
        .pf-subhead { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; font-size: 0.85rem; font-weight: 500; }
        .pf-subhead small { color: #888; font-weight: 400; }
        .pf-filter { padding: 0.35rem 0.55rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.8rem; width: 160px; }
        .pf-colors { display: flex; flex-wrap: wrap; gap: 0.35rem; max-height: 180px; overflow-y: auto; padding: 2px; }
        .pf-color { border: 1.5px solid #e5e5e5; background: #fff; border-radius: 999px; padding: 0.3rem 0.65rem; cursor: pointer; font-size: 0.78rem; }
        .pf-color.on { border-color: #111; background: #111; color: #fff; }
        .pf-color.add { border-style: dashed; color: #555; }
        .pf-newcolor { display: inline-flex; gap: 0.35rem; align-items: center; flex-wrap: wrap; }
        .pf-newcolor input[type=color] { width: 36px; height: 32px; padding: 0; border: 1px solid #ddd; border-radius: 6px; }
        .pf-newcolor input:not([type=color]) { padding: 0.4rem 0.55rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.8rem; width: 170px; }
        .pf-scale { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
        .pf-scale-label { font-size: 0.75rem; color: #666; min-width: 190px; }
        .pf-sizes { display: flex; gap: 0.3rem; flex-wrap: wrap; }
        .pf-size { min-width: 42px; padding: 0.35rem 0.6rem; border: 1.5px solid #e5e5e5; background: #fff; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
        .pf-size.on { background: #111; color: #fff; border-color: #111; }
        .pf-error { background: #fee2e2; color: #991b1b; padding: 0.7rem 0.9rem; border-radius: 8px; font-size: 0.85rem; }
        .pf-inline-error { color: #b91c1c; font-size: 0.8rem; margin: 0; }
        .pf-btn { padding: 0.6rem 1.1rem; border-radius: 8px; font-size: 0.875rem; cursor: pointer; border: 1px solid transparent; }
        .pf-btn.primary { background: #111; color: #fff; }
        .pf-btn.secondary { background: #fff; border-color: #ddd; }
        .pf-btn:disabled { opacity: .55; cursor: not-allowed; }
        @media (max-width: 600px) {
          .pf-mode { grid-template-columns: 1fr; }
          .pf-backdrop { padding: 0; }
          .pf-modal { border-radius: 0; max-height: 100dvh; min-height: 100dvh; }
          .pf-footer { border-radius: 0; }
          .pf-scale-label { min-width: 0; width: 100%; }
        }
      `}</style>
    </div>
  )
}
