import React, { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api.js'

/**
 * Gestión de imágenes de un producto:
 *  - Subir archivos (JPG/PNG/WEBP, máx 5 MB) → se suben a Cloudinary al guardar.
 *  - Pegar URLs https de imágenes (de cualquier sitio) → Cloudinary las descarga y
 *    aloja al guardar; las que ya son de res.cloudinary.com se guardan tal cual.
 *  - En edición: ver las imágenes actuales, marcar la principal (★) y eliminar.
 *
 * Props:
 *  - productId?: en edición (las acciones sobre imágenes existentes van al API)
 *  - images?: imágenes existentes [{ id, url, isMain }]
 *  - onChange({ files: File[], urls: string[] })
 *  - onImagesChanged?(): tras borrar/marcar principal en el servidor
 *  - maxImages (default 10)
 */
export const CLOUDINARY_URL_RE = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/.+/i
export const IMAGE_URL_RE = /^https:\/\/[^/\s]+\.[^/\s]+\/\S+$/i

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
// Constante estable: un `[]` por defecto en los props sería un array nuevo en
// cada render y dispararía el efecto de sincronización en bucle.
const NO_IMAGES = []
const MAX_BYTES = 5 * 1024 * 1024

export default function ImageUploader({ productId, images = NO_IMAGES, onChange, onImagesChanged, maxImages = 10 }) {
  const [existing, setExisting] = useState(images)
  const [files, setFiles] = useState([])       // [{ file, preview }]
  const [urls, setUrls] = useState([])         // [string]
  const [urlInput, setUrlInput] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => setExisting(images), [images])

  useEffect(() => {
    onChange?.({ files: files.map((f) => f.file), urls })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, urls])

  // Liberar las URLs de preview al desmontar
  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.preview)), []) // eslint-disable-line

  const total = existing.length + files.length + urls.length
  const remaining = Math.max(0, maxImages - total)

  const addFiles = (list) => {
    setError(null)
    const accepted = []
    for (const file of Array.from(list)) {
      if (!ACCEPTED.includes(file.type)) { setError(`"${file.name}": solo JPG, PNG o WEBP.`); continue }
      if (file.size > MAX_BYTES) { setError(`"${file.name}" pesa más de 5 MB.`); continue }
      if (accepted.length >= remaining) { setError(`Máximo ${maxImages} imágenes por producto.`); break }
      accepted.push({ file, preview: URL.createObjectURL(file) })
    }
    if (accepted.length) setFiles((prev) => [...prev, ...accepted])
  }

  const addUrls = () => {
    setError(null)
    const candidates = urlInput.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean)
    if (!candidates.length) return
    const invalid = candidates.filter((u) => !IMAGE_URL_RE.test(u))
    if (invalid.length) {
      setError(`URL no válida: ${invalid[0]}. Debe ser un enlace https directo a la imagen`)
      return
    }
    const fresh = candidates.filter((u) => !urls.includes(u) && !existing.some((img) => img.url === u))
    if (fresh.length > remaining) {
      setError(`Máximo ${maxImages} imágenes por producto.`)
      return
    }
    setUrls((prev) => [...prev, ...fresh])
    setUrlInput('')
  }

  const removeFile = (idx) => {
    URL.revokeObjectURL(files[idx].preview)
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  const removeExisting = async (img) => {
    if (!productId) return
    if (!confirm('¿Eliminar esta imagen del producto? Si está en tu Cloudinary también se borrará de allí.')) return
    setBusy(true); setError(null)
    try {
      await api.admin.deleteProductImage(productId, img.id)
      const next = existing.filter((i) => i.id !== img.id)
      if (img.isMain && next[0]) next[0] = { ...next[0], isMain: true }
      setExisting(next)
      onImagesChanged?.()
    } catch (err) {
      setError(err.message || 'No se pudo eliminar la imagen')
    } finally {
      setBusy(false)
    }
  }

  const makeMain = async (img) => {
    if (!productId || img.isMain) return
    setBusy(true); setError(null)
    try {
      await api.admin.setMainImage(productId, img.id)
      setExisting((prev) => prev.map((i) => ({ ...i, isMain: i.id === img.id })))
      onImagesChanged?.()
    } catch (err) {
      setError(err.message || 'No se pudo marcar como principal')
    } finally {
      setBusy(false)
    }
  }

  const willBeMain = existing.length === 0

  return (
    <div className="img-manager">
      <div className="img-grid">
        {existing.map((img) => (
          <figure key={img.id} className={`img-thumb ${img.isMain ? 'is-main' : ''}`}>
            <img src={img.url} alt="" loading="lazy" />
            {img.isMain && <span className="img-badge main">Principal</span>}
            <div className="img-actions">
              <button type="button" onClick={() => makeMain(img)} disabled={busy || img.isMain} title="Marcar como principal" aria-label="Marcar como principal">★</button>
              <button type="button" className="danger" onClick={() => removeExisting(img)} disabled={busy} title="Eliminar" aria-label="Eliminar imagen">✕</button>
            </div>
          </figure>
        ))}
        {files.map((f, idx) => (
          <figure key={f.preview} className="img-thumb pending">
            <img src={f.preview} alt="" />
            <span className="img-badge">{willBeMain && idx === 0 ? 'Principal · nueva' : 'Nueva'}</span>
            <div className="img-actions visible">
              <button type="button" className="danger" onClick={() => removeFile(idx)} aria-label="Quitar">✕</button>
            </div>
          </figure>
        ))}
        {urls.map((u, idx) => (
          <figure key={u} className="img-thumb pending">
            <img src={u} alt="" onError={(e) => { e.currentTarget.classList.add('broken') }} />
            <span className="img-badge url">{willBeMain && files.length === 0 && idx === 0 ? 'Principal · URL' : 'URL'}</span>
            <div className="img-actions visible">
              <button type="button" className="danger" onClick={() => setUrls((prev) => prev.filter((x) => x !== u))} aria-label="Quitar URL">✕</button>
            </div>
          </figure>
        ))}
        {remaining > 0 && (
          <button
            type="button"
            className={`img-drop ${dragOver ? 'over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
          >
            <span className="plus">+</span>
            <small>Subir fotos</small>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        multiple
        hidden
        onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
      />

      <div className="url-row">
        <input
          type="url"
          inputMode="url"
          placeholder="Pega una o varias URLs de imagen (https://…); Cloudinary las cargará"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrls() } }}
          disabled={remaining === 0}
        />
        <button type="button" onClick={addUrls} disabled={remaining === 0 || !urlInput.trim()}>Agregar URL</button>
      </div>

      {error && <p className="img-error" role="alert">{error}</p>}
      <small className="img-help">
        {total}/{maxImages} imágenes · JPG, PNG o WEBP de máx. 5 MB · las nuevas se guardan al presionar “Guardar”.
        {productId ? ' ★ marca la foto principal (la que se ve en el catálogo).' : ' La primera será la foto principal.'}
      </small>

      <style>{`
        .img-manager { display: flex; flex-direction: column; gap: 0.6rem; }
        .img-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 0.5rem; }
        .img-thumb { position: relative; margin: 0; aspect-ratio: 3/4; border-radius: 8px; overflow: hidden; background: #f3f3f3; border: 2px solid transparent; }
        .img-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .img-thumb img.broken { opacity: 0.2; }
        .img-thumb.is-main { border-color: #111; }
        .img-thumb.pending { border: 2px dashed #bbb; }
        .img-badge { position: absolute; left: 4px; bottom: 4px; font-size: 0.6rem; background: #dbeafe; color: #1e40af; padding: 1px 6px; border-radius: 4px; }
        .img-badge.main { background: #111; color: #fff; }
        .img-badge.url { background: #fef3c7; color: #92400e; }
        .img-actions { position: absolute; top: 4px; right: 4px; display: flex; gap: 3px; opacity: 0; transition: opacity .15s; }
        .img-thumb:hover .img-actions, .img-actions.visible, .img-thumb:focus-within .img-actions { opacity: 1; }
        @media (hover: none) { .img-actions { opacity: 1; } }
        .img-actions button { width: 26px; height: 26px; border: none; border-radius: 5px; background: rgba(255,255,255,.95); cursor: pointer; font-size: 0.85rem; }
        .img-actions button.danger { color: #dc2626; }
        .img-actions button:disabled { opacity: .5; cursor: not-allowed; }
        .img-drop { aspect-ratio: 3/4; border: 2px dashed #ccc; border-radius: 8px; background: #fff; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.2rem; color: #777; }
        .img-drop.over, .img-drop:hover { border-color: #111; color: #111; }
        .img-drop .plus { font-size: 1.6rem; line-height: 1; }
        .url-row { display: flex; gap: 0.4rem; }
        .url-row input { flex: 1; min-width: 0; padding: 0.5rem 0.65rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.8rem; }
        .url-row button { padding: 0.5rem 0.8rem; border: 1px solid #111; background: #fff; border-radius: 6px; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
        .url-row button:disabled { opacity: .5; cursor: not-allowed; }
        .img-error { color: #991b1b; font-size: 0.8rem; margin: 0; }
        .img-help { color: #888; font-size: 0.72rem; }
      `}</style>
    </div>
  )
}
