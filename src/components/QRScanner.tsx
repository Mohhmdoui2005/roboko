'use client'

import { useEffect, useRef, useCallback } from 'react'

interface QRScannerProps {
  onScan: (raw: string) => void
  onClose: () => void
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const scannerRef = useRef<any>(null)
  const containerId = 'html5qr-code-region'
  const cooldownRef = useRef(false)

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

  useEffect(() => {
    let mounted = true

    const startScanner = async () => {
      const { Html5Qrcode } = await import('html5-qrcode')
      if (!mounted) return

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
      } catch (err: any) {
        console.error('[QRScanner] Failed to start:', err?.message || err)
      }
    }

    startScanner()

    const handleVisibilityChange = () => {
      if (document.hidden) stopScanner()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopScanner()
    }
  }, [onScan, stopScanner])

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
              Scan Robot QR Code
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
              Point camera at a <code style={{ fontFamily: 'var(--font-mono)' }}>ROBOT_TEST</code> payload
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

        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', padding: '0.625rem 1rem' }}>
          640×480 · 15 fps · rear-facing
        </p>
      </div>
    </div>
  )
}
