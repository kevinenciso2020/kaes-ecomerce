import { useEffect, useId, useMemo, useState } from 'react'
import colombiaData from '../data/colombia-departamentos-municipios.json'

export default function UbicacionSelect({
  id = 'ubicacion',
  defaultDepartamento = '',
  defaultMunicipio = '',
  required = false,
  className = '',
}) {
  const reactId = useId()
  const depId = `${id}-departamento-${reactId}`
  const munId = `${id}-municipio-${reactId}`

  const [departamento, setDepartamento] = useState(defaultDepartamento)
  const [municipio, setMunicipio] = useState(defaultMunicipio)

  const municipios = useMemo(() => {
    const entry = colombiaData.find((d) => d.departamento === departamento)
    return entry ? entry.municipios : []
  }, [departamento])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('ubicacion-change', {
        detail: { departamento, municipio },
      })
    )
  }, [departamento, municipio])

  return (
    <div className={`ubicacion-select ${className}`.trim()}>
      <div className="form-group">
        <label htmlFor={depId} className="form-label">
          Departamento
        </label>
        <select
          id={depId}
          className="form-input"
          value={departamento}
          required={required}
          onChange={(e) => {
            setDepartamento(e.target.value)
            setMunicipio('')
          }}
        >
          <option value="">Selecciona un departamento</option>
          {colombiaData.map((d) => (
            <option key={d.departamento} value={d.departamento}>
              {d.departamento}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor={munId} className="form-label">
          Municipio
        </label>
        <select
          id={munId}
          className="form-input"
          value={municipio}
          required={required}
          disabled={!departamento}
          onChange={(e) => setMunicipio(e.target.value)}
        >
          <option value="">
            {departamento ? 'Selecciona un municipio' : 'Selecciona primero un departamento'}
          </option>
          {municipios.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}