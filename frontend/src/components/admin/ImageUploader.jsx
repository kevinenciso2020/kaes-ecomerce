import React, { useState } from 'react'
import { api } from '../../lib/api.js'

/**
 * Subida multi-imagen con preview. Soporta 2 modos:
 *  - "new": para crear productos — los archivos se acumulan y se suben al guardar el form.
 *  - "existing": para editar — combina archivos nuevos con las imágenes ya guardadas
 *     (el padre pasa la lista actual y este componente la muestra + permite borrar).
 *
 * Props:
 *  - mode: 'new' | 'existing'
 *  - productId?: requerido en mode='existing' para borrar imágenes via API.
 *  - images?: [{ id, url, publicId, isMain }] — existentes (solo mode='existing')
 *  - onChange?: ({ files: File[], removedIds: string[] }) => void
 *  - maxFiles?: número máximo de archivos nuevos (default 10)
 */
export default function ImageUploader({
  mode = 'new',
  productId,
  images = [],
  onChange,
  maxFiles = 10,
}) {
  const [files, setFiles]       = useState([])
  const [previews, setPreviews] = useState([])
  const [removedIds, setRemovedIds] = useState([])
  const [mainId, setMainId]     = useState(() => images.find((i) => i.isMain)?.id || null)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)

  const emit = (nextFiles, nextPreviews, nextRemoved, nextMain) => {
    onChange?.({ files: nextFiles, removedIds: nextRemoved, mainImageId: nextMain ?? mainId })
  }

  const handleFiles = (selected) => {
    setError(null)
    const arr = Array.from(selected)
    const total = files.length + images.filter((i) => !removedIds.includes(i.id)).length + arr.length
    if (total > maxFiles) {
      setError(`Máximo ${maxFiles} imágenes. Actualmente hay ${total - arr.length}, intentas agregar ${arr.length}.`)
      return
    }
    const valid = []
    const newPreviews = []
    for (const f of arr) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
        setError(`Tipo de archivo no permitido: ${f.name}. Solo JPG, PNG o WEBP.`)
        continue
      }
      if (f.size > 5 * 1024 * 1024) {
        setError(`El archivo ${f.name} excede 5 MB.`)
        continue
      }
      valid.push(f)
      newPreviews.push(URL.createObjectURL(f))
    }
    const nextFiles = [...files, ...valid]
    const nextPreviews = [...previews, ...newPreviews]
    setFiles(nextFiles)
    setPreviews(nextPreviews)
    emit(nextFiles, nextPreviews, removedIds, mainId)
  }

  const removeNewFile = (idx) => {
    const nextFiles = files.filter((_, i) => i !== idx)
    const nextPreviews = previews.filter((_, i) => i !== idx)
    URL.revokeObjectURL(previews[idx])
    setFiles(nextFiles)
    setPreviews(nextPreviews)
    emit(nextFiles, nextPreviews, removedIds, mainId)
  }

  const removeExisting = async (img) => {
    if (!productId) {
      // Modo "new" — no debería entrar acá
      return
    }
    if (!confirm(`¿Eliminar esta imagen? Esta acción no se puede deshacer.`)) return
    setBusy(true)
    setError(null)
    try {
      await api.admin.deleteProductImage(productId, img.id)
      const nextRemoved = [...removedIds, img.id]
      setRemovedIds(nextRemoved)
      // Si era la principal, promover la siguiente visualmente
      if (mainId === img.id) {
        const remaining = images.filter((i) => i.id !== img.id && !nextRemoved.includes(i.id))
        setMainId(remaining[0]?.id || null)
      }
      emit(files, previews, nextRemoved, mainId === img.id ? null : mainId)
    } catch (err) {
      setError(err.message || 'Error al eliminar la imagen')
    } finally {
      setBusy(false)
    }
  }

  const setMain = async (img) => {
    if (!productId) {
      setMainId(img.id)
      emit(files, previews, removedIds, img.id)
      return
    }
    setBusy(true)
    try {
      await api.admin.setMainImage(productId, img.id)
      setMainId(img.id)
    } catch (err) {
      setError(err.message || 'Error al marcar como principal')
    } finally {
      setBusy(false)
    }
  }

  const remaining = images.filter((i) => !removedIds.includes(i.id))

  return (
    <div className="image-uploader">
      <div className="image-grid">
        {remaining.map((img) => (
          <div key={img.id} className={`image-thumb ${mainId === img.id ? 'main' : ''}`}>
            <img src={img.url} alt="" />
            <div className="image-actions">
              <button
                type="button"
                className="img-btn"
                onClick={() => setMain(img)}
                disabled={busy || mainId === img.id}
                title={mainId === img.id ? 'Imagen principal' : 'Marcar como principal'}
              >
                {mainId === img.id ? '★' : '☆'}
              </button>
              <button
                type="button"
                className="img-btn danger"
                onClick={() => removeExisting(img)}
                disabled={busy}
                title="Eliminar"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        {previews.map((src, idx) => (
          <div key={`new-${idx}`} className="image-thumb new">
            <img src={src} alt="" />
            <span className="badge-new">nueva</span>
            <button
              type="button"
              className="img-btn danger"
              onClick={() => removeNewFile(idx)}
              title="Quitar"
            >
              ✕
            </button>
          </div>
        ))}
        {(remaining.length + previews.length) < maxFiles && (
          <label className="image-upload-trigger">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files)
                e.target.value = ''
              }}
              disabled={busy}
              hidden
            />
            <span>+</span>
            <small>Subir imagen</small>
          </label>
        )}
      </div>
      {error && <p className="img-error">{error}</p>}
      <small className="img-help">
        JPG, PNG o WEBP · máximo 5 MB por archivo · hasta {maxFiles} imágenes · click ☆ para marcar principal
      </small>

      <style>{`
        .image-uploader { display: flex; flex-direction: column; gap: 0.5rem; }
        .image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.5rem; }
        .image-thumb {
          position: relative; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden;
          border: 2px solid transparent; background: var(--color-gray-100);
        }
        .image-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .image-thumb.main { border-color: var(--color-black, #000); }
        .image-thumb.new { border-style: dashed; border-color: var(--color-gray-300, #ccc); }
        .image-thumb .badge-new {
          position: absolute; top: 4px; left: 4px; background: #dbeafe; color: #1e40af;
          font-size: 0.6rem; padding: 1px 5px; border-radius: 3px;
        }
        .image-actions {
          position: absolute; top: 4px; right: 4px; display: flex; gap: 2px;
          opacity: 0; transition: opacity 0.15s;
        }
        .image-thumb:hover .image-actions { opacity: 1; }
        .image-thumb.new .image-actions { opacity: 1; right: 4px; top: 4px; }
        .img-btn {
          background: rgba(255,255,255,0.95); border: none; cursor: pointer;
          width: 24px; height: 24px; border-radius: 4px; font-size: 0.85rem;
          display: flex; align-items: center; justify-content: center;
        }
        .img-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .img-btn.danger { color: #dc2626; }
        .image-upload-trigger {
          aspect-ratio: 1/1; border: 2px dashed var(--color-gray-300, #ccc);
          border-radius: 8px; display: flex; flex-direction: column; align-items: center;
          justify-content: center; cursor: pointer; color: var(--color-gray-500, #888);
          font-size: 1.5rem; transition: all 0.15s; gap: 0.25rem;
        }
        .image-upload-trigger:hover { border-color: var(--color-black, #000); color: var(--color-black, #000); }
        .image-upload-trigger small { font-size: 0.65rem; }
        .img-error { color: #991b1b; font-size: 0.8rem; margin: 0; }
        .img-help { color: var(--color-gray-400, #888); font-size: 0.7rem; }
      `}</style>
    </div>
  )
}
