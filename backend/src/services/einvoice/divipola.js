// Códigos DANE (DIVIPOLA) de departamentos y municipios, tal como los exige la
// DIAN en las direcciones de la factura (tablas 13.4.2 y 13.4.3 del Anexo 1.9).
import { readFileSync } from 'node:fs'

const data = JSON.parse(readFileSync(new URL('../../data/divipola.json', import.meta.url), 'utf8'))

export const normalizeName = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// Nombres usados en el selector del checkout que difieren del nombre oficial DIAN.
const DEPARTMENT_ALIASES = {
  'bogota dc': 'bogota',
  'bogota d c': 'bogota',
  'archipielago de san andres providencia y santa catalina': 'san andres y providencia',
  'san andres': 'san andres y providencia',
}

const MUNICIPALITY_ALIASES = {
  'miriti-parana': 'miriti – parana',
  'carolina del principe': 'carolina',
  'el penol': 'penol',
  'el retiro': 'retiro',
  'san pablo': 'san pablo sur',
  'santa rosa': 'santa rosa de lima',
  'guican': 'guican de la sierra',
  'paez': 'paez - belalcazar',
  'patia': 'patia – el bordo',
  'piendamo': 'piendamo – tunia',
  'purace': 'purace - coconuco',
  'alto baudo': 'alto baudo (pie de pato)',
  'atrato': 'atrato (yuto)',
  'bahia solano': 'bahia solano (mutis)',
  'bajo baudo': 'bajo baudo (pizarro)',
  'bojaya': 'bojaya (bella vista)',
  'medio atrato': 'medio atrato (bete)',
  'medio san juan': 'medio san juan (andagoya)',
  'rio iro': 'rio iro (santa rita)',
  'rio quito': 'rio quito (paimado)',
  'union panamericana': 'union panamericana (las animas)',
  'purisima': 'purisima de la concepcion',
  'san juan de rio seco': 'san juan de rioseco',
  'ubate': 'villa de san diego de ubate',
  'barranco minas': 'barrancominas',
  'morichal': 'morichal nuevo',
  'la argentina': 'la argentina (la plata vieja)',
  'san jose de isnos': 'isnos',
  'chivolo': 'chibolo',
  'fuente de oro': 'fuentedeoro',
  'la uribe': 'uribe',
  'san martin': 'san martin de los llanos',
  'alban': 'alban (san jose)',
  'colon': 'colon (genova)',
  'los andes': 'los andes (sotomayor)',
  'magui': 'magui (payan)',
  'mallama': 'mallama (piedrancha)',
  'roberto payan': 'roberto payan (san jose)',
  'cacota': 'cacota de velasco',
  'silos': 'santo domingo de silos',
  'since': 'san luis de since',
  'armero': 'armero (guayabal)',
  'mariquita': 'san sebastian de mariquita',
  'buga': 'guadalajara de buga',
  'calima': 'calima (darien)',
  'seville': 'sevilla',
  'papunaua': 'papunahua',
}

const departmentByName = new Map()
for (const [code, name] of Object.entries(data.departamentos)) {
  departmentByName.set(normalizeName(name), { code, name })
}

const municipalityByKey = new Map()
for (const [code, name] of data.municipios) {
  municipalityByKey.set(`${code.slice(0, 2)}|${normalizeName(name)}`, { code, name })
}

/**
 * Resuelve departamento + municipio (texto libre del checkout) a sus códigos
 * DANE y nombres oficiales. Devuelve null si no se puede resolver.
 */
export const resolveLocation = (departamento, municipio) => {
  let depKey = normalizeName(departamento)
  depKey = DEPARTMENT_ALIASES[depKey] ?? depKey
  const dep = departmentByName.get(depKey)
  if (!dep) return null

  let munKey = normalizeName(municipio)
  // Bogotá: el municipio suele venir igual al departamento.
  if (dep.code === '11') munKey = 'bogota dc'
  const mun =
    municipalityByKey.get(`${dep.code}|${munKey}`) ??
    municipalityByKey.get(`${dep.code}|${MUNICIPALITY_ALIASES[munKey] ?? ''}`)
  if (!mun) return null

  return {
    departmentCode: dep.code,
    departmentName: dep.name,
    cityCode: mun.code,
    // La DIAN valida contra el nombre oficial de la tabla (en mayúsculas).
    cityName: mun.name,
  }
}
