import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanVan } from '../functions/_lib/auth.js'
import {
  CHECK_DIGIT_WARN,
  applyVinPrefill,
  assessVin,
  cameraFallbackCopy,
  expectedCheckDigit,
  extractVin,
  fieldVin,
  lookupVin,
  selectVinScanner,
} from '../src/vin.js'

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
