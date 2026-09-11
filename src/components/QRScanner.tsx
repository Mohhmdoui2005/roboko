'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

interface QRScannerProps {
  onScan: (raw: string) => void
  onClose: () => void
  title?: string
  subtitle?: React.ReactNode
  hint?: string
}

export default function QRScanner({
  onScan,
  onClose,
  title = 'Scan Robot QR Code',
  subtitle = <>Point camera at a <code style={{ fontFamily: 'var(--font-mono)' }}>ROBOT_TEST</code> payload</>,
  hint = '640×480 · 15 fps · rear-facing',
}: QRScannerProps) {
  const scannerRef = useRef<any>(null)
  const containerId = 'html5qr-code-region'
  const cooldownRef = useRef(false)
  // Permission lifecycle: the scanner only starts after the user grants
  // camera access. Over plain http://<lan-ip> Chrome blocks getUserMedia
  // entirely (insecure context), so that case gets its own message.
  const [status, setStatus] = useState<'requesting' | 'scanning' | 'denied' | 'no-camera' | 'insecure' | 'error'>('requesting')
  const [errorDetail, setErrorDetail] = useState<string>('')

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop()
        }
        await scannerRef.current.clear()
      } catch {
        // ignore errors on teardown
      }
      scannerRef.current = null
    }
  }, [])

  const requestPermissionAndStart = useCallback(async () => {
    setErrorDetail('')
    // 1. Secure-context check: camera API only exists on https:// or
    // localhost. Plain http://192.168.x.x has no mediaDevices at all.
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      (typeof window !== 'undefined' && window.isSecureContext === false)
    ) {
      setStatus('insecure')
      return
    }

    // 2. Explicit permission prompt. The stream is stopped immediately —
    // Html5Qrcode opens its own stream in scanner.start() below.
    setStatus('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      stream.getTracks().forEach((t) => t.stop())
    } catch (err: any) {
      const name = err?.name || ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('denied')
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setStatus('no-camera')
        setErrorDetail(err?.message || '')
      } else {
        setStatus('error')
        setErrorDetail(err?.message || String(err))
      }
      return
    }

    // 3. Permission granted — start the QR engine.
    const { Html5Qrcode } = await import('html5-qrcode')
    const scanner = new Html5Qrcode(containerId)
    scannerRef.current = scanner

    try {
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 15,                // ← hard requirement: 15 fps max
          qrbox: { width: 260, height: 260 },
          aspectRatio: 640 / 480,
        },
        (decodedText: string) => {
          if (cooldownRef.current) return
          cooldownRef.current = true
          onScan(decodedText)
          setTimeout(() => { cooldownRef.current = false }, 1000)
        },
        () => { /* suppress per-frame non-scan errors */ }
      )
      setStatus('scanning')
    } catch (err: any) {
      console.error('[QRScanner] Failed to start:', err?.message || err)
      const name = err?.name || ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('denied')
      } else {
        setStatus('error')
        setErrorDetail(err?.message || String(err))
      }
    }
  }, [onScan])

  useEffect(() => {
    let mounted = true
    if (mounted) requestPermissionAndStart()

    const handleVisibilityChange = () => {
      if (document.hidden) stopScanner()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopScanner()
    }
  }, [requestPermissionAndStart, stopScanner])

  return (
    // modal-backdrop from design system
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="QR code scanner"
    >
      <div className="modal-panel w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.2, margin: 0 }}>
              {title}
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
              {subtitle}
            </p>
          </div>
          <button
            onClick={async () => { await stopScanner(); onClose() }}
            className="btn"
            style={{ minHeight: 40, minWidth: 40, padding: '0 0.625rem', fontSize: '1rem', border: 'none' }}
            aria-label="Close scanner"
          >
            ✕
          </button>
        </div>

        {/* Camera viewport */}
        <div
          id={containerId}
          style={{ background: 'var(--color-bg)', minHeight: 300 }}
        />

        {/* Permission / error states (overlay below the viewport) */}
        {status === 'requesting' && (
          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-secondary)', padding: '1rem' }}>
            📷 Requesting camera access… please tap <strong>Allow</strong> in the browser prompt.
          </p>
        )}

        {status === 'denied' && (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 0.5rem' }}>
              🚫 Camera access was denied
            </p>
            <p style={{ margin: '0 0 0.75rem' }}>
              Tap the <strong>🔒 lock icon</strong> in the address bar → Permissions → Camera → <strong>Allow</strong>,
              then retry. (Chrome Android: ⋮ → Settings → Site settings → Camera.)
            </p>
            <button className="btn btn-primary" onClick={() => requestPermissionAndStart()}>
              📷 Enable camera &amp; retry
            </button>
          </div>
        )}

        {status === 'insecure' && (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 0.5rem' }}>
              🔒 Camera is blocked on plain http://
            </p>
            <p style={{ margin: '0 0 0.75rem' }}>
              Chrome only allows the camera on <strong>https://</strong> or localhost — never on
              http://192.168.x.x, so no permission prompt can appear. Quick fix for testing:
              open <code style={{ fontFamily: 'var(--font-mono)' }}>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> on
              the phone, add <code style={{ fontFamily: 'var(--font-mono)' }}>http://192.168.100.8:3000</code>,
              relaunch Chrome and retry.
            </p>
            <button className="btn btn-primary" onClick={() => requestPermissionAndStart()}>
              ↻ Retry camera
            </button>
          </div>
        )}

        {status === 'no-camera' && (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 0.5rem' }}>
              📵 No camera found on this device
            </p>
            {errorDetail && <p style={{ margin: 0 }}>{errorDetail}</p>}
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 0.5rem' }}>
              ⚠️ Could not start the camera
            </p>
            {errorDetail && <p style={{ margin: '0 0 0.75rem' }}>{errorDetail}</p>}
            <button className="btn btn-primary" onClick={() => requestPermissionAndStart()}>
              ↻ Retry camera
            </button>
          </div>
        )}

        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', padding: '0.625rem 1rem' }}>
          {hint}
        </p>
      </div>
    </div>
  )
}
