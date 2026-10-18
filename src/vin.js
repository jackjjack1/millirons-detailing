// VIN format and check digit (ISO 3779). Shared by the application form and the server.
// I, O, and Q are never used, so a VIN cannot be confused with 1 or 0.

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
const VALUES = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
}
const VIN_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/
export const CHECK_DIGIT_WARN = 'Check digit does not match. You can still save this VIN.'

export function normalizeVin(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40)
}

export function expectedCheckDigit(vin) {
  const v = normalizeVin(vin)
  if (!VIN_CHARS.test(v)) return ''
  let sum = 0
  for (let i = 0; i < 17; i++) sum += VALUES[v[i]] * WEIGHTS[i]
  const mod = sum % 11
  return mod === 10 ? 'X' : String(mod)
}

// Pull a VIN out of a barcode payload. A leading I is a common scanner prefix, not part of the VIN.
export function extractVin(text) {
  const compact = normalizeVin(text)
  const exact = []
  if (VIN_CHARS.test(compact)) exact.push(compact)
  if (compact.startsWith('I') && VIN_CHARS.test(compact.slice(1))) exact.push(compact.slice(1))
  if (exact.length) return exact.find(v => v[8] === expectedCheckDigit(v)) || exact[0]
  const found = []
  const sources = compact.startsWith('I') ? [compact, compact.slice(1)] : [compact]
  for (const source of sources) {
    for (let i = 0; i + 17 <= source.length; i++) {
      const slice = source.slice(i, i + 17)
      if (VIN_CHARS.test(slice)) found.push(slice)
    }
  }
  return found.find(v => v[8] === expectedCheckDigit(v)) || found[0] || ''
}

// What the text field stores: a scanned VIN when one is present, otherwise the typed characters.
export function fieldVin(raw) {
  const compact = normalizeVin(raw)
  if (compact.length === 17) return compact
  if (compact.length > 17) {
    const found = extractVin(compact)
    if (found) return found
  }
  return compact.slice(0, 17)
}

export function assessVin(raw) {
  const vin = normalizeVin(raw)
  if (!vin) return {vin: '', ok: true, formatError: '', checkWarn: ''}
  if (vin.length !== 17) return {vin, ok: false, formatError: 'VIN must be 17 characters.', checkWarn: ''}
  if (!VIN_CHARS.test(vin)) return {vin, ok: false, formatError: 'VIN uses letters and numbers only, with no I, O, or Q.', checkWarn: ''}
  const checkWarn = vin[8] === expectedCheckDigit(vin) ? '' : CHECK_DIGIT_WARN
  return {vin, ok: true, formatError: '', checkWarn}
}

export function prefersBarcodeDetector(formats) {
  const names = new Set((Array.isArray(formats) ? formats : []).map(f => String(f).toLowerCase().replace(/[\s-]/g, '_')))
  return names.has('code_39') && names.has('data_matrix')
}

export function selectVinScanner(formats) {
  return prefersBarcodeDetector(formats) ? 'barcode-detector' : 'zxing'
}

export function cameraFallbackCopy(error) {
  const name = error?.name || ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Camera access was denied. Type the VIN instead.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found. Type the VIN instead.'
  return 'Camera unavailable. Type the VIN instead.'
}

// The first attempt prefers the rear camera and still succeeds when the device
// only has one camera. Later attempts run only after a constraint failure.
// Permission denial stops the list so a second prompt is not opened.
export const VIN_CAMERA_ATTEMPTS = [
  {video: {facingMode: {ideal: 'environment'}}, audio: false},
  {video: {facingMode: 'environment'}, audio: false},
  {video: true, audio: false},
]
const CAMERA_DENIED = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])
export const VIN_PHOTO_ACCEPT = 'image/*'
export const VIN_PHOTO_CAPTURE = 'environment'

export async function openEnvironmentCamera(getUserMedia) {
  if (typeof getUserMedia !== 'function') {
    const error = new Error('Camera unavailable.')
    error.name = 'NotFoundError'
    throw error
  }
  let last = null
  for (const constraints of VIN_CAMERA_ATTEMPTS) {
    try {
      return await getUserMedia(constraints)
    } catch (error) {
      last = error
      if (CAMERA_DENIED.has(error?.name)) throw error
    }
  }
  if (last) throw last
  const error = new Error('No camera was found.')
  error.name = 'NotFoundError'
  throw error
}

// iOS Safari will not play a camera preview without these flags, and it drops
// the user gesture if they are set after an awaited permission prompt.
export function primeVinVideo(video) {
  if (!video) return
  video.muted = true
  video.defaultMuted = true
  video.playsInline = true
  video.setAttribute('playsinline', 'true')
  video.setAttribute('webkit-playsinline', 'true')
  video.setAttribute('muted', 'true')
  video.setAttribute('autoplay', 'true')
}

export async function decodeVinImage(file, {detect, decodeUrl, createUrl, revokeUrl} = {}) {
  if (!file) throw new Error('Choose a photo of the VIN barcode.')
  const type = String(file.type || '')
  if (type && !type.startsWith('image/')) throw new Error('That file is not an image. Choose a photo of the VIN barcode.')
  let text = ''
  if (typeof detect === 'function' && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      try {
        const codes = await detect(bitmap)
        text = (codes || []).map(code => code?.rawValue || '').join(' ')
      } finally {
        bitmap.close?.()
      }
    } catch {
      if (typeof decodeUrl !== 'function') throw new Error('Could not read that photo. Try another image, or type the VIN.')
    }
  }
  if (!extractVin(text)) {
    if (typeof decodeUrl !== 'function') throw new Error('Could not read that photo. Try another image, or type the VIN.')
    const makeUrl = createUrl || (blob => URL.createObjectURL(blob))
    const dropUrl = revokeUrl || (url => URL.revokeObjectURL(url))
    const url = makeUrl(file)
    try {
      text = await decodeUrl(url)
    } catch {
      throw new Error('No VIN barcode in that photo. Type the VIN instead.')
    } finally {
      dropUrl(url)
    }
  }
  const vin = extractVin(String(text || ''))
  if (!vin) throw new Error('No VIN barcode in that photo. Type the VIN instead.')
  return vin
}

function titleCase(value) {
  return String(value || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

export function applyVinPrefill(van, decoded = {}) {
  const next = {...van}
  for (const key of ['year', 'make', 'model']) {
    if (!String(next[key] ?? '').trim() && String(decoded[key] ?? '').trim()) next[key] = String(decoded[key]).trim()
  }
  return next
}

export async function lookupVin(vin, fetchImpl = globalThis.fetch) {
  const assessed = assessVin(vin)
  if (!assessed.ok || !assessed.vin) throw new Error(assessed.formatError || 'Enter a VIN first.')
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(assessed.vin)}?format=json`
  const res = await fetchImpl(url)
  if (!res?.ok) throw new Error('Could not look up that VIN.')
  const data = await res.json()
  const row = data?.Results?.[0] || {}
  return {
    year: String(row.ModelYear || '').trim(),
    make: titleCase(String(row.Make || '').trim()),
    model: titleCase(String(row.Model || '').trim()),
  }
}
