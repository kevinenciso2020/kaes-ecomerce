import React, { useState, useEffect, useCallback, useRef } from 'react'
import { isAdminRole } from '../../lib/roles.js'
import { api, bootstrapAuth } from '../../lib/api.js'
import ProductFormModal from './ProductFormModal.jsx'
import CatalogManager from './CatalogManager.jsx'

/**
 * Panel de productos: listado con filtros, crear/editar, archivar, reactivar,
 * eliminar definitivamente, y pestañas para administrar colores y categorías.
 */
const EMPTY_FILTERS = { search: '', category: '', status: 'true', lowStock: '' }

export default function ProductList() {
  const [tab, setTab] = useState('products')
  const [products, setProducts] = useState([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState([])
  const [colors, setColors] = useState([])
  const [sizes, setSizes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [editing, setEditing] = useState(null) // null | 'new' | product
  const [toasts, setToasts] = useState([])
  const [rowBusy, setRowBusy] = useState(null)
  const firstLoad = useRef(true)

  const notify = useCallback(({ type, message }) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, type, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500)
  }, [])

  const loadCatalog = useCallback(async () => {
    const [cats, cols, siz] = await Promise.all([api.admin.categories(), api.admin.colors(), api.admin.sizes()])
    setCategories(cats || [])
    setColors(cols || [])
    setSizes(siz || [])
  }, [])

  const loadProducts = useCallback(async (targetPage = page) => {
    setError(null)
    try {
      const params = { page: targetPage, limit: 20 }
      if (filters.search.trim()) params.search = filters.search.trim()
      if (filters.category) params.category = filters.category
      if (filters.status) params.isActive = filters.status
      if (filters.lowStock) params.lowStock = filters.lowStock
      const result = await api.admin.products(params)
      setProducts(result.products || [])
      setTotal(result.total || 0)
      setPage(result.page || 1)
      setTotalPages(Math.max(1, result.totalPages || 1))
    } catch (err) {
      setError(err.message || 'Error al cargar productos')
    }
  }, [page, filters])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const user = await bootstrapAuth()
      if (!mounted) return
      if (!user || !isAdminRole(user.role)) {
        setAccessDenied(true)
        setLoading(false)
        return
      }
      try {
        await loadCatalog()
        await loadProducts(1)
      } catch (err) {
        setError(err.message)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recargar al cambiar filtros (con debounce para la búsqueda)
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return }
    const t = setTimeout(() => loadProducts(1), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const openEdit = async (product) => {
    setRowBusy(product.id)
    try {
      setEditing(await api.admin.productDetail(product.id))
    } catch (err) {
      notify({ type: 'error', message: err.message })
    } finally {
      setRowBusy(null)
    }
  }

  const archive = async (product) => {
    if (!confirm(`¿Archivar "${product.name}"?\n\nDeja de verse en la tienda, pero conserva fotos, historial y ventas. Puedes reactivarlo cuando quieras.`)) return
    setRowBusy(product.id)
    try {
      await api.admin.deleteProduct(product.id)
      notify({ type: 'success', message: 'Producto archivado' })
      await loadProducts()
    } catch (err) {
      notify({ type: 'error', message: err.message })
    } finally {
      setRowBusy(null)
    }
  }

  const restore = async (product) => {
    setRowBusy(product.id)
    try {
      await api.admin.restoreProduct(product.id)
      notify({ type: 'success', message: 'Producto reactivado: ya se ve en la tienda' })
      await loadProducts()
    } catch (err) {
      notify({ type: 'error', message: err.message })
    } finally {
      setRowBusy(null)
    }
  }

  const toggleFeatured = async (product) => {
    setRowBusy(product.id)
    try {
      const fd = new FormData()
      fd.append('isFeatured', String(!product.isFeatured))
      await api.admin.updateProduct(product.id, fd)
      notify({ type: 'success', message: product.isFeatured ? 'Quitado de destacados' : 'Producto destacado en el inicio' })
      await loadProducts()
    } catch (err) {
      notify({ type: 'error', message: err.message })
    } finally {
      setRowBusy(null)
    }
  }

  const destroy = async (product) => {
    const typed = prompt(`Eliminar DEFINITIVAMENTE "${product.name}" y sus fotos.\nSolo es posible si nunca se ha vendido.\n\nEscribe ELIMINAR para confirmar:`)
    if (typed !== 'ELIMINAR') return
    setRowBusy(product.id)
    try {
      await api.admin.deleteProduct(product.id, { hard: true })
      notify({ type: 'success', message: 'Producto eliminado definitivamente' })
      await loadProducts()
    } catch (err) {
      notify({ type: 'error', message: err.message })
    } finally {
      setRowBusy(null)
    }
  }

  const onSaved = async () => {
    notify({ type: 'success', message: editing === 'new' ? 'Producto creado' : 'Producto actualizado' })
    setEditing(null)
    await loadProducts()
  }

  if (accessDenied) {
    return (
      <div className="pl-denied">
        <p>No tienes permisos para ver esta página</p>
        <a href="/auth/login?redirect=/admin/productos" className="pl-btn primary">Iniciar sesión</a>
      </div>
    )
  }

  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')

  return (
    <div className="pl container">
      <header className="pl-head">
        <div>
          <a href="/admin" className="pl-back">← Panel</a>
          <h1>Productos</h1>
          <p className="pl-sub">{total} producto(s) con los filtros actuales</p>
        </div>
        {tab === 'products' && (
          <button className="pl-btn primary" onClick={() => setEditing('new')} disabled={loading}>+ Nuevo producto</button>
        )}
      </header>

      <nav className="pl-tabs" role="tablist">
        {[['products', 'Productos'], ['colors', `Colores (${colors.length})`], ['categories', `Categorías (${categories.length})`]].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      {error && <div className="pl-error" role="alert">{error}</div>}

      {tab === 'colors' && <CatalogManager kind="colors" items={colors} onChanged={loadCatalog} notify={notify} />}
      {tab === 'categories' && <CatalogManager kind="categories" items={categories} onChanged={loadCatalog} notify={notify} />}

      {tab === 'products' && (
        <>
          <div className="pl-filters">
            <input type="search" placeholder="Buscar por nombre o descripción…" value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
            <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
              <option value="">Todas las categorías</option>
              {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="true">Activos</option>
              <option value="false">Archivados</option>
              <option value="">Todos</option>
            </select>
            <select value={filters.lowStock} onChange={(e) => setFilters((f) => ({ ...f, lowStock: e.target.value }))}>
              <option value="">Todo el stock</option>
              <option value="true">Stock bajo</option>
            </select>
            {JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) && (
              <button className="pl-btn ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Limpiar</button>
            )}
          </div>

          <div className="pl-table-wrap">
            <table className="pl-table">
              <thead>
                <tr>
                  <th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="pl-empty">Cargando…</td></tr>
                ) : products.length === 0 ? (
                  <tr><td colSpan={6} className="pl-empty">
                    No hay productos con estos filtros.{' '}
                    <button className="pl-link" onClick={() => setEditing('new')}>Crear el primero</button>
                  </td></tr>
                ) : products.map((p) => {
                  const img = p.images?.[0]?.url || '/placeholder.svg'
                  const stock = p.totalStock ?? p.stock ?? 0
                  const busy = rowBusy === p.id
                  return (
                    <tr key={p.id} className={p.isActive ? '' : 'archived'}>
                      <td data-label="Producto">
                        <div className="pl-product">
                          <img src={img} alt="" loading="lazy" />
                          <div>
                            <button className="pl-name" onClick={() => openEdit(p)}>{p.name}</button>
                            <div className="pl-meta">
                              {p.isFeatured && <span className="tag gold">★ Destacado</span>}
                              {p._count?.variants > 0 && <span className="tag">{p._count.variants} variantes</span>}
                              {p._count?.images === 0 && <span className="tag warn">Sin fotos</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Categoría">{p.category?.name || '—'}</td>
                      <td data-label="Precio">{money(p.price)}</td>
                      <td data-label="Stock" className={stock === 0 ? 'out' : p.lowStockCount > 0 ? 'low' : ''}>
                        {stock === 0 ? 'Agotado' : stock}
                        {stock > 0 && p.lowStockCount > 0 && <small> · bajo</small>}
                      </td>
                      <td data-label="Estado">
                        <span className={`status ${p.isActive ? 'on' : 'off'}`}>{p.isActive ? 'Activo' : 'Archivado'}</span>
                      </td>
                      <td className="pl-actions">
                        <button className="pl-btn ghost" onClick={() => openEdit(p)} disabled={busy}>Editar</button>
                        {p.isActive && (
                          <button className="pl-btn ghost" onClick={() => toggleFeatured(p)} disabled={busy}>
                            {p.isFeatured ? 'Quitar destacado' : '★ Destacar'}
                          </button>
                        )}
                        {p.isActive ? (
                          <button className="pl-btn ghost" onClick={() => archive(p)} disabled={busy}>Archivar</button>
                        ) : (
                          <>
                            <button className="pl-btn ghost" onClick={() => restore(p)} disabled={busy}>Reactivar</button>
                            <button className="pl-btn ghost danger" onClick={() => destroy(p)} disabled={busy}>Eliminar</button>
                          </>
                        )}
                        {p.isActive && (
                          <a className="pl-btn ghost" href={`/productos/${p.slug}`} target="_blank" rel="noopener">Ver</a>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pl-pages">
              <button className="pl-btn ghost" disabled={page <= 1} onClick={() => loadProducts(page - 1)}>← Anterior</button>
              <span>Página {page} de {totalPages}</span>
              <button className="pl-btn ghost" disabled={page >= totalPages} onClick={() => loadProducts(page + 1)}>Siguiente →</button>
            </div>
          )}
        </>
      )}

      {editing && (
        <ProductFormModal
          product={editing === 'new' ? null : editing}
          categories={categories}
          colors={colors}
          sizes={sizes}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onCatalogChange={loadCatalog}
        />
      )}

      <div className="pl-toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`pl-toast ${t.type}`}>{t.message}</div>)}
      </div>

      <style>{`
        .pl { padding-top: calc(var(--header-height, 60px) + 1.5rem); padding-bottom: 4rem; }
        .pl-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
        .pl-head h1 { font-family: var(--font-serif); font-size: 1.9rem; margin: 0.2rem 0 0; }
        .pl-back { font-size: 0.8rem; color: #777; }
        .pl-sub { color: #888; font-size: 0.85rem; margin: 0.2rem 0 0; }
        .pl-tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid #eee; margin-bottom: 1rem; overflow-x: auto; }
        .pl-tabs button { background: none; border: none; border-bottom: 2px solid transparent; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.875rem; color: #666; white-space: nowrap; }
        .pl-tabs button.on { color: #111; border-bottom-color: #111; font-weight: 600; }
        .pl-filters { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
        .pl-filters input { flex: 1 1 220px; }
        .pl-filters input, .pl-filters select { padding: 0.55rem 0.7rem; border: 1px solid #ddd; border-radius: 7px; font-size: 0.85rem; background: #fff; }
        .pl-table-wrap { background: #fff; border: 1px solid #eee; border-radius: 10px; overflow-x: auto; }
        .pl-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
        .pl-table th { text-align: left; padding: 0.75rem; background: #fafafa; color: #777; font-size: 0.7rem; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
        .pl-table td { padding: 0.7rem 0.75rem; border-top: 1px solid #f3f3f3; vertical-align: middle; }
        .pl-table tr.archived { background: #fcfcfc; color: #888; }
        .pl-table tr.archived img { opacity: .5; }
        .pl-product { display: flex; gap: 0.7rem; align-items: center; }
        .pl-product img { width: 46px; height: 58px; object-fit: cover; border-radius: 6px; background: #f3f3f3; flex-shrink: 0; }
        .pl-name { background: none; border: none; padding: 0; font: inherit; font-weight: 600; cursor: pointer; text-align: left; color: inherit; }
        .pl-name:hover { text-decoration: underline; }
        .pl-meta { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.2rem; }
        .tag { font-size: 0.62rem; background: #f3f4f6; color: #555; padding: 1px 6px; border-radius: 999px; }
        .tag.gold { background: #fef3c7; color: #92400e; }
        .tag.warn { background: #fee2e2; color: #991b1b; }
        td.low { color: #b45309; font-weight: 600; }
        td.out { color: #b91c1c; font-weight: 600; }
        .status { font-size: 0.72rem; padding: 0.2rem 0.6rem; border-radius: 999px; }
        .status.on { background: #dcfce7; color: #166534; }
        .status.off { background: #f3f4f6; color: #6b7280; }
        .pl-actions { white-space: nowrap; text-align: right; }
        .pl-actions .pl-btn { padding: 0.35rem 0.6rem; font-size: 0.75rem; margin-left: 0.25rem; }
        .pl-btn { display: inline-block; padding: 0.55rem 1rem; border-radius: 8px; font-size: 0.85rem; cursor: pointer; border: 1px solid transparent; text-decoration: none; }
        .pl-btn.primary { background: #111; color: #fff; }
        .pl-btn.ghost { background: #fff; border-color: #ddd; color: #111; }
        .pl-btn.danger { color: #b91c1c; }
        .pl-btn:disabled { opacity: .5; cursor: not-allowed; }
        .pl-link { background: none; border: none; color: #2563eb; cursor: pointer; font: inherit; }
        .pl-empty { text-align: center; padding: 2.5rem 1rem !important; color: #888; }
        .pl-pages { display: flex; justify-content: center; align-items: center; gap: 1rem; margin-top: 1rem; font-size: 0.85rem; color: #666; }
        .pl-error { background: #fee2e2; color: #991b1b; padding: 0.7rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem; }
        .pl-denied { min-height: 60vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; color: #888; }
        .pl-toasts { position: fixed; right: 1rem; bottom: 1rem; display: flex; flex-direction: column; gap: 0.5rem; z-index: 1100; max-width: calc(100vw - 2rem); }
        .pl-toast { padding: 0.75rem 1rem; border-radius: 8px; color: #fff; font-size: 0.85rem; box-shadow: 0 6px 20px rgba(0,0,0,.15); background: #111; }
        .pl-toast.success { background: #166534; }
        .pl-toast.error { background: #b91c1c; }
        @media (max-width: 720px) {
          .pl-table thead { display: none; }
          .pl-table, .pl-table tbody, .pl-table tr, .pl-table td { display: block; width: 100%; }
          .pl-table tr { border-top: 1px solid #eee; padding: 0.6rem 0; }
          .pl-table td { border: none; padding: 0.25rem 0.75rem; }
          .pl-table td[data-label]:not([data-label="Producto"])::before { content: attr(data-label) ": "; color: #999; font-size: 0.75rem; }
          .pl-actions { text-align: left; }
          .pl-actions .pl-btn { margin: 0.25rem 0.25rem 0 0; }
        }
      `}</style>
    </div>
  )
}
