import React, { useCallback, useEffect, useState } from 'react'
import { api, bootstrapAuth } from '../../lib/api.js'

/**
 * Pantalla de IVA (sólo SUPER_ADMIN): tasa vigente, última revisión de la fuente
 * oficial y, si la fuente indica otra tasa, banner para aplicarla.
 */
export default function TaxSettings() {
  const [state, setState] = useState('loading') // loading | denied | ready
  const [setting, setSetting] = useState(null)
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'error', text }

  const load = useCallback(async () => {
    const s = await api.admin.tax()
    setSetting(s)
    setRate(String(s.rate))
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const user = await bootstrapAuth()
      if (!mounted) return
      if (!user || user.role !== 'SUPER_ADMIN') { setState('denied'); return }
      try { await load(); if (mounted) setState('ready') }
      catch (err) { if (mounted) { setMsg({ type: 'error', text: err.message }); setState('ready') } }
    })()
    return () => { mounted = false }
  }, [load])

  const run = async (fn, okText) => {
    setBusy(true); setMsg(null)
    try {
      const r = await fn()
      await load()
      setMsg({ type: 'ok', text: okText(r) })
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'No se pudo completar la acción' })
    } finally { setBusy(false) }
  }

  const save = () => {
    const next = Number(rate)
    if (!Number.isFinite(next) || next < 0 || next > 30) { setMsg({ type: 'error', text: 'La tasa debe estar entre 0 y 30' }); return }
    if (!confirm(`¿Cambiar el IVA a ${next} %?\n\nSe recalcularán los precios de todos los productos con IVA general. Los pedidos ya hechos no cambian.`)) return
    run(() => api.admin.setTaxRate(next), (r) => r.changed ? `IVA actualizado a ${r.rate} %: ${r.productsUpdated} producto(s) recalculados` : 'La tasa ya era esa; no hubo cambios')
  }

  const apply = () => {
    if (!confirm(`¿Aplicar ${setting.pendingRate} %?\n\nConfírmalo antes con tu contador. Se recalcularán los precios de los productos con IVA general.`)) return
    run(() => api.admin.applyPendingTax(), (r) => `IVA actualizado a ${r.rate} %: ${r.productsUpdated} producto(s) recalculados`)
  }

  const checkNow = () =>
    run(() => api.admin.checkTax(), (r) => ({
      unchanged: 'La fuente oficial coincide con tu tasa',
      pending: `La fuente oficial indica ${r.detected} %`,
      error: 'No se pudo leer la fuente oficial (revisa los logs)',
      skipped: 'Revisada hace poco',
    }[r.status] || 'Revisión terminada'))

  if (state === 'loading') return <div className="container" style={{ padding: '6rem 0' }}>Cargando…</div>
  if (state === 'denied') {
    return <div className="container" style={{ padding: '6rem 0' }}><p>Solo el super administrador puede gestionar el IVA.</p></div>
  }

  return (
    <div className="container" style={{ padding: 'calc(60px + 2rem) 16px 4rem', maxWidth: 640 }}>
      <style>{`
        .tax-row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
        .tax-row input { max-width: 100%; }
      `}</style>
      <a href="/admin">← Panel</a>
      <h1>IVA</h1>
      <p>El precio que escribes al crear un producto es <strong>sin IVA</strong>; la tienda suma esta tasa y muestra el precio final.</p>

      {setting?.pendingRate != null && (
        <div role="alert" style={{ background: '#fef3c7', padding: '1rem', borderRadius: 6, margin: '1rem 0' }}>
          La fuente oficial indica {setting.pendingRate} %, tu tienda usa {setting.rate} %. No se ha cambiado ningún precio.
          <div style={{ marginTop: '.5rem' }}>
            <button className="btn btn-primary" onClick={apply} disabled={busy}>Aplicar {setting.pendingRate} %</button>
          </div>
        </div>
      )}

      <label style={{ display: 'block', margin: '1.5rem 0 .25rem' }}>Tasa vigente (%)</label>
      <div className="tax-row">
        <input type="number" min="0" max="30" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} disabled={busy} />
        <button className="btn btn-primary" onClick={save} disabled={busy}>Guardar tasa</button>
      </div>

      <p style={{ marginTop: '1.5rem', fontSize: '.875rem' }}>
        Última revisión de la fuente oficial: {setting?.lastCheckAt ? new Date(setting.lastCheckAt).toLocaleString('es-CO') : 'nunca'}
        {setting?.lastCheckRate != null && ` (indicó ${setting.lastCheckRate} %)`}
        {' '}<button className="btn" onClick={checkNow} disabled={busy}>Revisar ahora</button>
      </p>

      {msg && <p role="status" aria-live="polite" style={{ color: msg.type === 'error' ? '#991b1b' : '#166534' }}>{msg.text}</p>}
    </div>
  )
}
