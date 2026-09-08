import React, { useState, useEffect, useCallback } from 'react'
import { api, bootstrapAuth } from '../../lib/api.js'
import { escapeHtml } from '../../lib/sanitize.js'
import ProductFormModal from './ProductFormModal.jsx'

export default function ProductList({ showToast }) {
  const [products, setProducts]     = useState([])
  const [categories, setCategories] = useState([])
  const [colors, setColors]         = useState([])
  const [sizes, setSizes]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [page, setPage]             = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [filters, setFilters]       = useState({ search: '', category: '', status: '', lowStock: '' })
  const [editingProduct, setEditingProduct] = useState(null)
  const [showForm, setShowForm]     = useState(false)

  const loadProducts = useCallback(async (params = {}) => {
    try {
      const q = new URLSearchParams({ page: params.page || page, limit: 20, ...filters, ...params })
      q.delete('search'); if (filters.search) q.set('search', filters.search)
      // Limpiar filtros vacíos para no mandar ''
      for (const [k, v] of [...q.entries()]) if (!v) q.delete(k)
      const result = await api.admin.products(Object.fromEntries(q))
      setProducts(result.products || [])
      setPage(result.page || 1)
      setTotalPages(result.totalPages || 1)
    } catch (err) {
      setError(err.message || 'Error al cargar productos')
    }
  }, [page, filters])

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
        const [cats, cols, siz] = await Promise.all([
          api.categories.list(),
          api.admin.colors(),
          api.admin.sizes(),
        ])
        if (!mounted) return
        setCategories(cats || [])
        setColors(cols || [])
        setSizes(siz || [])
        await loadProducts()
      } catch (err) {
        setError(err.message)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refetch cuando cambian los filtros (con debounce)
  useEffect(() => {
    const t = setTimeout(() => loadProducts({ page: 1 }), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const handleDelete = async (product) => {
    if (!confirm(`¿Eliminar "${product.name}"? Esta acción no se puede deshacer.`)) return
    try {
      await api.admin.deleteProduct(product.id)
      showToast?.({ type: 'success', message: 'Producto eliminado' })
      await loadProducts()
    } catch (err) {
      showToast?.({ type: 'error', message: err.message })
    }
  }

  const handleEdit = async (product) => {
    try {
      const full = await api.admin.productDetail(product.id)
      setEditingProduct(full)
      setShowForm(true)
    } catch (err) {
      showToast?.({ type: 'error', message: err.message })
    }
  }

  const handleCreate = () => {
    setEditingProduct(null)
    setShowForm(true)
  }

  const handleSaved = async (saved) => {
    showToast?.({ type: 'success', message: editingProduct ? 'Producto actualizado' : 'Producto creado' })
    setShowForm(false)
    setEditingProduct(null)
    await loadProducts()
  }

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
        <div className="header-top">
          <div>
            <h1 className="admin-title">Productos</h1>
            <p className="admin-sub">Gestiona el catálogo · {products.length} en esta página</p>
          </div>
          <button className="btn btn-primary" onClick={handleCreate}>+ Nuevo producto</button>
        </div>
        <div className="filters">
          <input
            type="search"
            className="search-input"
            placeholder="Buscar productos…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
          <select
            className="filter-select"
            value={filters.category}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </select>
          <select
            className="filter-select"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">Todos los estados</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
          <select
            className="filter-select"
            value={filters.lowStock}
            onChange={(e) => setFilters((f) => ({ ...f, lowStock: e.target.value }))}
          >
            <option value="">Todo el stock</option>
            <option value="true">Stock bajo</option>
          </select>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="products-table-wrap">
        <table className="products-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Stock</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="loading">Cargando…</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={6} className="empty">No hay productos con esos filtros</td></tr>
            ) : products.map((p) => {
              const img = p.images && p.images[0] ? p.images[0].url : '/placeholder.svg'
              const low = p.lowStockCount > 0
              return (
                <tr key={p.id}>
                  <td>
                    <div className="product-cell">
                      <img src={img} alt="" className="product-thumb" loading="lazy" />
                      <div>
                        <div className="product-name">{escapeHtml(p.name)}</div>
                        {p.isFeatured && <span className="badge-featured">★ Destacado</span>}
                      </div>
                    </div>
                  </td>
                  <td>{p.category?.name ? escapeHtml(p.category.name) : '—'}</td>
                  <td>${Number(p.price).toLocaleString('es-CO')}</td>
                  <td className={low ? 'stock-low' : ''}>
                    {p.totalStock ?? p.stock ?? 0}
                    {low && <small className="stock-warn"> · {p.lowStockCount} var. bajas</small>}
                  </td>
                  <td>
                    <span className={`status-badge ${p.isActive ? 'active' : 'inactive'}`}>
                      {p.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button className="btn-icon" title="Editar" onClick={() => handleEdit(p)}>✏️</button>
                      <button className="btn-icon" title="Eliminar" onClick={() => handleDelete(p)}>🗑️</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="page-btn"
            disabled={page <= 1}
            onClick={() => loadProducts({ page: page - 1 })}
          >← Anterior</button>
          <span className="page-info">Página {page} de {totalPages}</span>
          <button
            className="page-btn"
            disabled={page >= totalPages}
            onClick={() => loadProducts({ page: page + 1 })}
          >Siguiente →</button>
        </div>
      )}

      {showForm && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          colors={colors}
          sizes={sizes}
          onClose={() => { setShowForm(false); setEditingProduct(null) }}
          onSaved={handleSaved}
        />
      )}

      <style>{`
        .admin-page { padding-top: calc(60px + 2rem); padding-bottom: 4rem; }
        .admin-header { margin-bottom: 2rem; }
        .header-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; gap: 1rem; flex-wrap: wrap; }
        .admin-title { font-family: var(--font-serif); font-size: 2rem; font-weight: 600; color: var(--color-black); margin: 0; }
        .admin-sub { font-size: 0.875rem; color: var(--color-gray-400); margin-top: 0.25rem; }
        .filters { display: flex; gap: 0.75rem; flex-wrap: wrap; }
        .search-input { flex: 1; min-width: 220px; padding: 0.5rem 0.75rem; border: 1px solid var(--color-gray-200); border-radius: 6px; font-size: 0.875rem; }
        .filter-select { padding: 0.5rem 0.75rem; border: 1px solid var(--color-gray-200); border-radius: 6px; font-size: 0.875rem; min-width: 160px; }
        .products-table-wrap { background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 8px; overflow-x: auto; }
        .products-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
        .products-table th { text-align: left; padding: 0.875rem; background: var(--color-gray-50); font-weight: 600; color: var(--color-gray-500); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .products-table td { padding: 0.875rem; border-top: 1px solid var(--color-gray-100); vertical-align: middle; }
        .product-cell { display: flex; align-items: center; gap: 0.75rem; }
        .product-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; background: var(--color-gray-100); flex-shrink: 0; }
        .product-name { font-weight: 500; }
        .badge-featured { display: inline-block; margin-top: 2px; font-size: 0.65rem; color: #92400e; background: #fef3c7; padding: 1px 6px; border-radius: 999px; }
        .status-badge { display: inline-block; padding: 0.25rem 0.625rem; border-radius: 999px; font-size: 0.75rem; font-weight: 500; }
        .status-badge.active { background: #dcfce7; color: #166534; }
        .status-badge.inactive { background: #fee2e2; color: #991b1b; }
        .action-buttons { display: flex; gap: 0.5rem; }
        .btn-icon { background: none; border: none; cursor: pointer; padding: 0.25rem; font-size: 1rem; }
        .btn-icon:hover { transform: scale(1.1); }
        .stock-low { color: #92400e; font-weight: 500; }
        .stock-warn { color: #92400e; font-size: 0.7rem; }
        .loading, .error, .empty { text-align: center; padding: 2rem; color: var(--color-gray-400); }
        .pagination { display: flex; justify-content: center; align-items: center; gap: 1rem; margin-top: 1.5rem; }
        .page-btn { padding: 0.5rem 1rem; background: var(--color-white); border: 1px solid var(--color-gray-200); border-radius: 6px; cursor: pointer; font-size: 0.875rem; }
        .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .page-info { font-size: 0.875rem; color: var(--color-gray-500); }
        .no-access { min-height: 60vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; color: var(--color-gray-400); }
        .error-banner { background: #fee2e2; color: #991b1b; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; }
        .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: flex-start; justify-content: center; z-index: 1000; padding: 2rem 1rem; overflow-y: auto; }
        .modal-content { background: var(--color-white); border-radius: 12px; width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; }
        .modal-content.large { max-width: 800px; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--color-gray-200); }
        .modal-header h2 { font-size: 1.15rem; font-weight: 600; margin: 0; }
        .modal-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; line-height: 1; padding: 4px 8px; }
        .product-form { padding: 1.5rem; }
        .form-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
        .btn { padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; cursor: pointer; border: 1px solid transparent; }
        .btn-primary { background: var(--color-black, #000); color: var(--color-white, #fff); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-secondary { background: var(--color-white, #fff); color: var(--color-black, #000); border-color: var(--color-gray-200, #eee); }
      `}</style>
    </div>
  )
}
