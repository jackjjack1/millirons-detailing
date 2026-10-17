import { useEffect, useRef, useState } from 'react'
import { cameraFallbackCopy, extractVin, selectVinScanner } from './vin.js'

export { extractVin }

function canCamera() {
  return typeof navigator !== 'undefined' && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function'
}
function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || matchMedia('(pointer:coarse)').matches
}
async function supportedFormats() {
  try {
    if (typeof BarcodeDetector === 'undefined' || typeof BarcodeDetector.getSupportedFormats !== 'function') return []
    return await BarcodeDetector.getSupportedFormats()
  } catch {
    return []
  }
}
function cameraBlocked(error) {
  const name = error?.name || ''
  return name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'NotFoundError' || name === 'NotReadableError' || name === 'SecurityError' || name === 'OverconstrainedError' || name === 'AbortError'
}

async function startBarcodeDetector(video, {onVin, onStatus}) {
  const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}}})
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  const detector = new BarcodeDetector({formats: ['code_39', 'data_matrix']})
  let timer = 0
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const codes = await detector.detect(video)
      for (const code of codes || []) {
        const text = code?.rawValue || ''
        const vin = extractVin(text)
        if (vin) { onVin(vin); return }
        if (text) onStatus(`Read "${text}" — not a valid VIN. Keep scanning, or type it.`)
      }
    } catch { /* the next frame may decode */ }
    if (!stopped) timer = setTimeout(tick, 150)
  }
  timer = setTimeout(tick, 200)
  return () => {
    stopped = true
    clearTimeout(timer)
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }
}

async function startZxing(video, {onVin, onStatus}) {
  const {BrowserMultiFormatReader} = await import('@zxing/browser')
  const {DecodeHintType, BarcodeFormat} = await import('@zxing/library')
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39, BarcodeFormat.DATA_MATRIX])
  hints.set(DecodeHintType.TRY_HARDER, true)
  const reader = new BrowserMultiFormatReader(hints, {delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 500})
  let stopped = false
  let controls = null
  controls = await reader.decodeFromConstraints(
    {video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}}},
    video,
    (result) => {
      if (stopped || !result) return
      const text = result.getText()
      const vin = extractVin(text)
      if (vin) { stopped = true; controls?.stop(); onVin(vin) }
      else onStatus(`Read "${text}" — not a valid VIN. Keep scanning, or type it.`)
    },
  )
  return () => { stopped = true; controls?.stop() }
}

export default function VinScanner({onVin, onFallback}) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const videoRef = useRef(null)
  const fileRef = useRef(null)
  const onVinRef = useRef(onVin)
  const onFallbackRef = useRef(onFallback)
  onVinRef.current = onVin
  onFallbackRef.current = onFallback
  const cam = canCamera()
  const mobile = isMobile()

  useEffect(() => {
    if (!open) return
    let stopped = false
    let stop = () => {}
    const found = vin => {
      if (stopped) return
      stopped = true
      stop()
      onVinRef.current?.(vin)
      setOpen(false)
      setMsg('')
    }
    ;(async () => {
      try {
        setMsg('Point the camera at the Code 39 or Data Matrix VIN barcode on the door jamb or windshield.')
        const formats = await supportedFormats()
        if (stopped) return
        const engine = selectVinScanner(formats)
        const hooks = {onVin: found, onStatus: text => { if (!stopped) setMsg(text) }}
        try {
          stop = engine === 'barcode-detector'
            ? await startBarcodeDetector(videoRef.current, hooks)
            : await startZxing(videoRef.current, hooks)
        } catch (error) {
          if (engine === 'barcode-detector' && !cameraBlocked(error) && !stopped) stop = await startZxing(videoRef.current, hooks)
          else throw error
        }
        if (stopped) stop()
      } catch (error) {
        if (stopped) return
        stop()
        setOpen(false)
        setMsg(cameraFallbackCopy(error))
        onFallbackRef.current?.()
      }
    })()
    return () => { stopped = true; stop() }
  }, [open])

  const upload = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setMsg('Reading photo…')
    try {
      const formats = await supportedFormats()
      let text = ''
      if (selectVinScanner(formats) === 'barcode-detector') {
        const bitmap = await createImageBitmap(file)
        try {
          const codes = await new BarcodeDetector({formats: ['code_39', 'data_matrix']}).detect(bitmap)
          text = (codes || []).map(code => code.rawValue || '').join(' ')
        } finally { bitmap.close?.() }
      }
      if (!extractVin(text)) {
        const {BrowserMultiFormatReader} = await import('@zxing/browser')
        const {DecodeHintType, BarcodeFormat} = await import('@zxing/library')
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39, BarcodeFormat.DATA_MATRIX])
        hints.set(DecodeHintType.TRY_HARDER, true)
        const url = URL.createObjectURL(file)
        try { text = (await new BrowserMultiFormatReader(hints).decodeFromImageUrl(url)).getText() }
        finally { URL.revokeObjectURL(url) }
      }
      const vin = extractVin(text)
      if (vin) { onVinRef.current?.(vin); setMsg('') }
      else setMsg('No VIN barcode in that photo. Type the VIN instead.')
    } catch {
      setMsg('No VIN barcode in that photo. Type the VIN instead.')
    }
  }

  const close = () => { setOpen(false); onFallbackRef.current?.() }

  return <div className="vinscan">
    <div className="vinbtns">
      {cam && <button type="button" className="pill sm" onClick={() => { setMsg(''); setOpen(true) }}>Scan VIN</button>}
      <button type="button" className="link" onClick={() => fileRef.current?.click()}>{mobile ? 'Use a photo' : 'Upload VIN photo'}</button>
      <input ref={fileRef} type="file" accept="image/*" capture={mobile ? 'environment' : undefined} hidden onChange={upload}/>
    </div>
    {!cam && <small className="muted">No camera is available on this page. Type the VIN below.</small>}
    {msg && !open && <small className="muted block">{msg}</small>}
    {open && <div className="scanmodal" role="dialog" aria-modal="true" aria-label="Scan VIN">
      <div className="scanbox">
        <video ref={videoRef} playsInline muted autoPlay aria-label="VIN barcode camera"/>
        <div className="reticle"/>
        <p>{msg}</p>
        <button type="button" className="pill sm light" onClick={close}>Cancel — type it instead</button>
      </div>
    </div>}
  </div>
}
