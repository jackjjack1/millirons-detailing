import { useEffect, useRef, useState } from 'react'
import {
  cameraFallbackCopy,
  decodeVinImage,
  extractVin,
  openEnvironmentCamera,
  primeVinVideo,
  selectVinScanner,
  VIN_PHOTO_ACCEPT,
  VIN_PHOTO_CAPTURE,
} from './vin.js'

export { extractVin }

function canCamera() {
  return typeof navigator !== 'undefined' && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function'
}
async function supportedFormats() {
  try {
    if (typeof BarcodeDetector === 'undefined' || typeof BarcodeDetector.getSupportedFormats !== 'function') return []
    return await BarcodeDetector.getSupportedFormats()
  } catch {
    return []
  }
}

async function startBarcodeDetector(video, stream, {onVin, onStatus}) {
  if (video.srcObject !== stream) video.srcObject = stream
  primeVinVideo(video)
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
  }
}

async function startZxing(video, stream, {onVin, onStatus}) {
  const {BrowserMultiFormatReader} = await import('@zxing/browser')
  const {DecodeHintType, BarcodeFormat} = await import('@zxing/library')
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39, BarcodeFormat.DATA_MATRIX])
  hints.set(DecodeHintType.TRY_HARDER, true)
  const reader = new BrowserMultiFormatReader(hints, {delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 500})
  let stopped = false
  let controls = null
  primeVinVideo(video)
  controls = await reader.decodeFromStream(stream, video, (result) => {
    if (stopped || !result) return
    const text = result.getText()
    const vin = extractVin(text)
    if (vin) { stopped = true; controls?.stop(); onVin(vin) }
    else onStatus(`Read "${text}" — not a valid VIN. Keep scanning, or type it.`)
  })
  return () => { stopped = true; controls?.stop() }
}

export default function VinScanner({onVin, onFallback}) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const onVinRef = useRef(onVin)
  const onFallbackRef = useRef(onFallback)
  onVinRef.current = onVin
  onFallbackRef.current = onFallback

  const stopStream = () => {
    const stream = streamRef.current
    streamRef.current = null
    if (stream) for (const track of stream.getTracks()) track.stop()
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const close = () => {
    stopStream()
    setOpen(false)
    onFallbackRef.current?.()
  }

  useEffect(() => {
    if (!open) return
    const stream = streamRef.current
    const video = videoRef.current
    if (!stream || !video) return
    let stopped = false
    let stop = () => {}
    const found = vin => {
      if (stopped) return
      stopped = true
      stop()
      stopStream()
      onVinRef.current?.(vin)
      setOpen(false)
      setMsg('')
      setErr('')
    }
    ;(async () => {
      const hooks = {onVin: found, onStatus: text => { if (!stopped) setMsg(text) }}
      try {
        const formats = await supportedFormats()
        if (stopped) return
        const engine = selectVinScanner(formats)
        try {
          stop = engine === 'barcode-detector'
            ? await startBarcodeDetector(video, stream, hooks)
            : await startZxing(video, stream, hooks)
        } catch (error) {
          if (engine === 'barcode-detector' && !stopped) stop = await startZxing(video, stream, hooks)
          else throw error
        }
        if (stopped) stop()
      } catch (error) {
        if (stopped) return
        stop()
        stopStream()
        setOpen(false)
        setErr(error?.message && !cameraFallbackCopy(error).startsWith('Camera unavailable') ? cameraFallbackCopy(error) : (cameraFallbackCopy(error) || 'The camera could not scan. Type the VIN instead.'))
        onFallbackRef.current?.()
      }
    })()
    return () => { stopped = true; stop() }
  }, [open])

  useEffect(() => () => stopStream(), [])

  const scan = () => {
    setErr('')
    setMsg('')
    primeVinVideo(videoRef.current)
    if (!canCamera()) {
      setErr('No camera is available on this page. Type the VIN, or use a photo.')
      return
    }
    // getUserMedia has to start inside this tap. iOS Safari drops the gesture
    // if anything is awaited before the call, and it has no BarcodeDetector.
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    openEnvironmentCamera(getUserMedia).then(stream => {
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        primeVinVideo(video)
        video.srcObject = stream
        const play = video.play()
        if (play?.catch) play.catch(() => {})
      }
      setMsg('Point the camera at the Code 39 or Data Matrix VIN barcode on the door jamb or windshield.')
      setOpen(true)
    }).catch(error => {
      stopStream()
      setOpen(false)
      setErr(cameraFallbackCopy(error))
    })
  }

  const upload = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      setErr('Choose a photo of the VIN barcode.')
      return
    }
    setErr('')
    setMsg('Reading photo…')
    try {
      const formats = await supportedFormats()
      const detector = selectVinScanner(formats) === 'barcode-detector' && typeof BarcodeDetector !== 'undefined'
        ? bitmap => new BarcodeDetector({formats: ['code_39', 'data_matrix']}).detect(bitmap)
        : null
      const vin = await decodeVinImage(file, {
        detect: detector,
        decodeUrl: async url => {
          const {BrowserMultiFormatReader} = await import('@zxing/browser')
          const {DecodeHintType, BarcodeFormat} = await import('@zxing/library')
          const hints = new Map()
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39, BarcodeFormat.DATA_MATRIX])
          hints.set(DecodeHintType.TRY_HARDER, true)
          return (await new BrowserMultiFormatReader(hints).decodeFromImageUrl(url)).getText()
        },
      })
      setMsg('')
      onVinRef.current?.(vin)
    } catch (error) {
      setMsg('')
      setErr(error?.message || 'No VIN barcode in that photo. Type the VIN instead.')
    }
  }

  return <div className="vinscan">
    <div className="vinbtns">
      <button type="button" className="pill sm" data-testid="scan-vin" onClick={scan}>Scan VIN</button>
      <label className="link vin-photo">
        Use a photo
        <input type="file" accept={VIN_PHOTO_ACCEPT} capture={VIN_PHOTO_CAPTURE} data-testid="vin-photo" onChange={upload}/>
      </label>
    </div>
    {err && <p className="err" data-testid="vin-scan-error">{err}</p>}
    {msg && !open && <small className="muted block">{msg}</small>}
    <div className={open ? 'scanmodal' : 'vin-video-off'} role={open ? 'dialog' : undefined} aria-modal={open ? 'true' : undefined} aria-label={open ? 'Scan VIN' : undefined}>
      <div className="scanbox">
        <video ref={videoRef} playsInline muted autoPlay aria-label="VIN barcode camera"/>
        {open && <>
          <div className="reticle"/>
          <p>{msg}</p>
          <button type="button" className="pill sm light" onClick={close}>Cancel — type it instead</button>
        </>}
      </div>
    </div>
  </div>
}
