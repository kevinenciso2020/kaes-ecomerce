import React, { useState } from 'react'
import { api } from '../../lib/api.js'
import ColorSwatch from './ColorSwatch.jsx'

/**
 * Gestión de colores y categorías.
 * Props: kind ('colors' | 'categories'), items, onChanged(), notify({type,message})
 */
export default function CatalogManager({ kind, items, onChanged, notify }) {
  const isColors = kind === 'colors'
  const [name, setName] = useState('')
  const [hex, setHex] = useState('#888888')
  const [description, setDescription] = useState('')
  const [editing, setEditing] = useState(null) // { id, name, hex, description }
  const [busy, setBusy] = useState(false)

  const run = async (fn, okMessage) => {
    setBusy(true)
    try {
      await fn()
      await onChanged?.()
      notify?.({ type: 'success', message: okMessage })
      return true
    } catch (err) {
      notify?.({ type: 'error', message: err.message })
      return false
    } finally {
      setBusy(false)
    }
  }

  const create = async (e) => {
    e.preventDefault()
    if (name.trim().length < 2) return notify?.({ type: 'error', message: 'El nombre debe tener al menos 2 letras' })
    const ok = await run(
      () => (isColors ? api.admin.createColor({ name: name.trim(), hex }) : api.admin.createCategory({ name: name.trim(), description })),
      isColors ? 'Color creado' : 'Categoría creada',
    )
    if (ok) { setName(''); setDescription('') }
  }

  const saveEdit = async () => {
    const ok = await run(
      () => (isColors
        ? api.admin.updateColor(editing.id, { name: editing.name, hex: editing.hex })
        : api.admin.updateCategory(editing.id, { name: editing.name, description: editing.description })),
      'Cambios guardados',
    )
    if (ok) setEditing(null)
  }

  const remove = async (item) => {
    if (!confirm(`¿Eliminar ${isColors ? 'el color' : 'la categoría'} "${item.name}"?`)) return
    await run(() => (isColors ? api.admin.deleteColor(item.id) : api.admin.deleteCategory(item.id)), 'Eliminado')
  }

  return (
    <div className="cm">
      <form className="cm-create" onSubmit={create}>
        {isColors && <input type="color" value={hex} onChange={(e) => setHex(e.target.value.toUpperCase())} aria-label="Tono del color" />}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isColors ? 'Nuevo color (ej. Terracota)' : 'Nueva categoría (ej. Buzos)'} maxLength={isColors ? 40 : 60} />
        {!isColors && <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción (opcional)" maxLength={300} />}
        <button type="submit" disabled={busy}>Agregar</button>
      </form>

      <p className="cm-hint">
        {isColors
          ? 'La paleta incluye los colores básicos. Un color usado por productos no se puede eliminar ni renombrar (sí cambiar su tono).'
          : 'Una categoría con productos no se puede eliminar: mueve primero sus productos.'}
      </p>

      <ul className="cm-list">
        {items.map((item) => (
          <li key={item.id}>
            {editing?.id === item.id ? (
              <div className="cm-edit">
                {isColors && <input type="color" value={editing.hex} onChange={(e) => setEditing({ ...editing, hex: e.target.value.toUpperCase() })} />}
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                {!isColors && <input value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Descripción" />}
                <button type="button" onClick={saveEdit} disabled={busy}>Guardar</button>
                <button type="button" className="ghost" onClick={() => setEditing(null)}>Cancelar</button>
              </div>
            ) : (
              <>
                <span className="cm-name">
                  {isColors ? <ColorSwatch hex={item.hex} name={item.name} size={16} /> : item.name}
                  {isColors && <code>{item.hex}</code>}
                  {!isColors && <small>{item._count?.products ?? 0} producto(s)</small>}
                </span>
                <span className="cm-actions">
                  <button type="button" className="ghost" onClick={() => setEditing({ ...item })}>Editar</button>
                  <button type="button" className="ghost danger" onClick={() => remove(item)} disabled={busy}>Eliminar</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      <style>{`
        .cm { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 1rem; }
        .cm-create, .cm-edit { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
        .cm-create input:not([type=color]), .cm-edit input:not([type=color]) { flex: 1 1 180px; padding: 0.5rem 0.65rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.85rem; }
        .cm input[type=color] { width: 40px; height: 36px; border: 1px solid #ddd; border-radius: 6px; padding: 0; }
        .cm button { padding: 0.5rem 0.85rem; border: 1px solid #111; background: #111; color: #fff; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
        .cm button.ghost { background: #fff; color: #111; border-color: #ddd; }
        .cm button.danger { color: #b91c1c; }
        .cm button:disabled { opacity: .5; }
        .cm-hint { font-size: 0.75rem; color: #888; margin: 0.6rem 0; }
        .cm-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.4rem; }
        .cm-list li { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; padding: 0.5rem 0.65rem; border: 1px solid #f0f0f0; border-radius: 8px; font-size: 0.85rem; }
        .cm-name { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
        .cm-name code, .cm-name small { color: #999; font-size: 0.7rem; }
        .cm-actions { display: flex; gap: 0.25rem; }
        .cm-actions button { padding: 0.3rem 0.55rem; font-size: 0.72rem; }
      `}</style>
    </div>
  )
}
