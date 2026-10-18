import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanVan } from '../functions/_lib/auth.js'
import {
  CHECK_DIGIT_WARN,
  VIN_CAMERA_ATTEMPTS,
  VIN_PHOTO_ACCEPT,
  VIN_PHOTO_CAPTURE,
  applyVinPrefill,
  assessVin,
  cameraFallbackCopy,
  decodeVinImage,
  expectedCheckDigit,
  extractVin,
  fieldVin,
  lookupVin,
  openEnvironmentCamera,
  primeVinVideo,
  selectVinScanner,
} from '../src/vin.js'
import {readFileSync} from 'node:fs'

const HONDA = '1HGCM82633A004352'

test('a known VIN passes the 17-character check and the check digit', () => {
  const assessed = assessVin('1hg cm82633a004352')
  assert.equal(assessed.vin, HONDA)
  assert.equal(assessed.ok, true)
  assert.equal(assessed.formatError, '')
  assert.equal(assessed.checkWarn, '')
  assert.equal(expectedCheckDigit(HONDA), '3')
  assert.equal(assessVin('').ok, true)
  assert.equal(assessVin('   ').vin, '')
})

test('VIN format requires 17 letters or numbers and rejects I, O, and Q', () => {
  assert.equal(assessVin('1HGCM82633A00435').ok, false)
  assert.match(assessVin('1HGCM82633A00435').formatError, /17/)
  assert.match(assessVin('1HGCM82633A004352EXTRA').formatError, /17/)
  for (const bad of ['1HGCM82633A00435I', '1HGCM82633A00435O', '1HGCM82633A00435Q']) {
    const assessed = assessVin(bad)
    assert.equal(assessed.ok, false)
    assert.match(assessed.formatError, /I, O, or Q/)
    assert.equal(assessed.checkWarn, '')
  }
  assert.equal(fieldVin('vin: 1HGCM82633A004352'), HONDA)
  assert.equal(fieldVin('1HGCM8263'), '1HGCM8263')
  assert.equal(fieldVin('1HGCMO2633A004352'), '1HGCMO2633A004352')
})

test('a check-digit mismatch warns and still counts as saveable', () => {
  const mismatch = `${HONDA.slice(0, 8)}4${HONDA.slice(9)}`
  const assessed = assessVin(mismatch)
  assert.equal(assessed.ok, true)
  assert.equal(assessed.formatError, '')
  assert.equal(assessed.checkWarn, CHECK_DIGIT_WARN)
  assert.notEqual(expectedCheckDigit(mismatch), '4')
})

test('check digit is X when the weighted remainder is 10', () => {
  const chars = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ'
  let found = ''
  for (const a of chars) {
    for (const b of chars) {
      const trial = `1${a}GCM8263${b}A004352`
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(trial)) continue
      if (expectedCheckDigit(trial) === 'X') {
        found = `${trial.slice(0, 8)}X${trial.slice(9)}`
        break
      }
    }
    if (found) break
  }
  assert.ok(found, 'expected a VIN whose check digit is X')
  assert.equal(assessVin(found).ok, true)
  assert.equal(assessVin(found).checkWarn, '')
  assert.equal(expectedCheckDigit(found), 'X')
})

test('barcode text yields the VIN and ignores a leading I prefix', () => {
  assert.equal(extractVin('*1HGCM82633A004352*'), HONDA)
  assert.equal(extractVin('I1HGCM82633A004352'), HONDA)
  assert.equal(extractVin('not a barcode'), '')
  const mismatch = `${HONDA.slice(0, 8)}4${HONDA.slice(9)}`
  assert.equal(extractVin(`*${mismatch}*`), mismatch)
})

test('BarcodeDetector is used only when Code 39 and Data Matrix are both supported', () => {
  assert.equal(selectVinScanner(['code_39', 'data_matrix']), 'barcode-detector')
  assert.equal(selectVinScanner(['code-39', 'DATA MATRIX']), 'barcode-detector')
  assert.equal(selectVinScanner(['code_39', 'qr_code']), 'zxing')
  assert.equal(selectVinScanner(['data_matrix']), 'zxing')
  assert.equal(selectVinScanner([]), 'zxing')
  assert.equal(selectVinScanner(null), 'zxing')
})

test('the rear camera is requested inside the tap, then a looser camera is used', async () => {
  const calls = []
  const stream = {id: 'rear'}
  const first = await openEnvironmentCamera(async constraints => {
    calls.push(constraints)
    return stream
  })
  assert.equal(first, stream)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], VIN_CAMERA_ATTEMPTS[0])
  assert.deepEqual(calls[0].video.facingMode, {ideal: 'environment'})

  const fallen = []
  const anyCamera = {id: 'any'}
  const second = await openEnvironmentCamera(async constraints => {
    fallen.push(constraints)
    if (constraints.video?.facingMode) {
      const error = new Error('overconstrained')
      error.name = 'OverconstrainedError'
      throw error
    }
    return anyCamera
  })
  assert.equal(second, anyCamera)
  assert.equal(fallen.length, 3)
  assert.equal(fallen[1].video.facingMode, 'environment')
  assert.deepEqual(fallen[2], {video: true, audio: false})

  const denied = []
  await assert.rejects(() => openEnvironmentCamera(async constraints => {
    denied.push(constraints)
    const error = new Error('denied')
    error.name = 'NotAllowedError'
    throw error
  }), error => error.name === 'NotAllowedError')
  assert.equal(denied.length, 1)
  await assert.rejects(() => openEnvironmentCamera(undefined), error => error.name === 'NotFoundError')
})

test('a photo of a VIN barcode decodes, and a bad file says why', async () => {
  const honda = '1HGCM82633A004352'
  const urls = []
  const originalBitmap = globalThis.createImageBitmap
  globalThis.createImageBitmap = async () => ({close() {}})
  try {
  const fromDetector = await decodeVinImage({type: 'image/jpeg', name: 'vin.jpg'}, {
    detect: async () => [{rawValue: `*${honda}*`}],
    decodeUrl: async () => { throw new Error('should not run') },
    createUrl: () => { throw new Error('should not run') },
  })
  assert.equal(fromDetector, honda)
  const fromZxing = await decodeVinImage({type: 'image/jpeg'}, {
    detect: async () => [],
    decodeUrl: async url => { urls.push(url); return honda },
    createUrl: () => 'blob:vin',
    revokeUrl: () => {},
  })
  assert.equal(fromZxing, honda)
  assert.deepEqual(urls, ['blob:vin'])
  await assert.rejects(() => decodeVinImage({type: 'application/pdf'}, {}), /not an image/)
  await assert.rejects(() => decodeVinImage(null, {}), /Choose a photo/)
  await assert.rejects(() => decodeVinImage({type: 'image/png'}, {
    detect: async () => [],
    decodeUrl: async () => { throw new Error('not found') },
    createUrl: () => 'blob:x',
    revokeUrl: () => {},
  }), /No VIN barcode/)
  } finally {
    globalThis.createImageBitmap = originalBitmap
  }
  assert.equal(VIN_PHOTO_ACCEPT, 'image/*')
  assert.equal(VIN_PHOTO_CAPTURE, 'environment')
  const video = {setAttribute() {}, muted: false, playsInline: false}
  primeVinVideo(video)
  assert.equal(video.muted, true)
  assert.equal(video.playsInline, true)
})

test('the scanner asks for the camera on the tap and the photo input is not display none', () => {
  const scanner = readFileSync(new URL('../src/VinScanner.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(scanner, /openEnvironmentCamera\(getUserMedia\)/)
  assert.match(scanner, /primeVinVideo/)
  assert.match(scanner, /playsInline/)
  assert.match(scanner, /decodeFromStream/)
  assert.doesNotMatch(scanner, /decodeFromConstraints/)
  assert.match(scanner, /accept=\{VIN_PHOTO_ACCEPT\}/)
  assert.match(scanner, /capture=\{VIN_PHOTO_CAPTURE\}/)
  assert.doesNotMatch(scanner, /type="file"[^>]*hidden/)
  assert.match(scanner, /data-testid="vin-scan-error"/)
  assert.match(css, /\.vinscan\{[^}]*margin:0/)
  assert.doesNotMatch(css, /\.vinscan\{margin:-/)
  assert.match(css, /\.vin-help\{[^}]*margin:0 0 16px/)
  assert.match(css, /\.vin-photo input\{[^}]*opacity:0/)
})

test('camera denial and a missing camera tell the applicant to type the VIN', () => {
  assert.match(cameraFallbackCopy({name: 'NotAllowedError'}), /denied/)
  assert.match(cameraFallbackCopy({name: 'PermissionDeniedError'}), /denied/)
  assert.match(cameraFallbackCopy({name: 'NotFoundError'}), /No camera/)
  assert.match(cameraFallbackCopy({name: 'NotReadableError'}), /Type the VIN/)
})

test('NHTSA decode fills only empty year, make, and model', async () => {
  const calls = []
  const decoded = await lookupVin('1hgcm82633a004352', async url => {
    calls.push(url)
    return {ok: true, async json() { return {Results: [{ModelYear: '2003', Make: 'HONDA', Model: 'ACCORD'}]} }}
  })
  assert.deepEqual(decoded, {year: '2003', make: 'Honda', model: 'Accord'})
  assert.equal(calls[0], `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${HONDA}?format=json`)
  const filled = applyVinPrefill({year: '', make: 'Ford', model: '  ', vin: HONDA, plate: 'GA1'}, decoded)
  assert.equal(filled.year, '2003')
  assert.equal(filled.make, 'Ford')
  assert.equal(filled.model, 'Accord')
  assert.equal(filled.plate, 'GA1')
  await assert.rejects(() => lookupVin('SHORT', async () => { throw new Error('should not fetch') }), /17/)
})

test('the server stores a VIN and uses the same format and check-digit rules', () => {
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const saved = cleanVan({
    year: '2003', make: 'Honda', model: 'Accord', plate: 'ga1', vin: '1hg cm82633a004352',
    photos: [{name: 'van.png', type: 'image/png', data: tiny}], docs: [], checklist: ['Hose reel(s)'],
  })
  assert.equal(saved.vin, HONDA)
  assert.equal(saved.photos.length, 1)
  assert.equal(cleanVan({year: '2021', make: 'Ford', model: 'Transit', plate: 'GA1'}).vin, '')
  assert.equal(cleanVan(undefined), undefined)

  const mismatch = `${HONDA.slice(0, 8)}4${HONDA.slice(9)}`
  assert.equal(cleanVan({vin: mismatch, year: '2003', make: 'Honda', model: 'Accord', plate: 'GA1'}).vin, mismatch)

  for (const vin of ['1HGCM8263', '1HGCM82633A00435I', '1HGCM82633A00435O', '1HGCM82633A00435Q']) {
    assert.throws(() => cleanVan({vin, year: '2003', make: 'Honda', model: 'Accord', plate: 'GA1'}), error => {
      assert.equal(error.status, 400)
      assert.equal(error.message, assessVin(vin).formatError)
      return true
    })
  }
})
