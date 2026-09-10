'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface CountdownProps {
  endsAt: string
  offsetMs: number
  onExpired?: () => void
}

function formatTime(totalSeconds: number): string {
  if (totalSeconds < 0) return '0:00'
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.6)
    osc.addEventListener('ended', () => ctx.close())
  } catch {
    // silent fallback
  }
}

export default function Countdown({ endsAt, offsetMs, onExpired }: CountdownProps) {
  const [remaining, setRemaining] = useState<number>(-1)
  const beepFiredRef = useRef(false)
  const expiredFiredRef = useRef(false)
  const onExpiredRef = useRef(onExpired)
  onExpiredRef.current = onExpired

  const computeRemaining = useCallback(() => {
    const nowCorrected = Date.now() - offsetMs
    const endsMs = new Date(endsAt).getTime()
    return Math.max(0, Math.round((endsMs - nowCorrected) / 1000))
  }, [endsAt, offsetMs])

  useEffect(() => {
    beepFiredRef.current = false
    expiredFiredRef.current = false
    setRemaining(computeRemaining())

    const id = setInterval(() => {
      const secs = computeRemaining()
      setRemaining(secs)

      if (secs <= 30 && secs > 0 && !beepFiredRef.current) {
        beepFiredRef.current = true
        playBeep()
      }
      if (secs === 0 && !expiredFiredRef.current) {
        expiredFiredRef.current = true
        onExpiredRef.current?.()
      }
    }, 250)

    return () => clearInterval(id)
  }, [endsAt, offsetMs, computeRemaining])

  if (remaining < 0) {
    return (
      <span
        className="font-mono font-semibold tabular-nums"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        --:--
      </span>
    )
  }

  const isUrgent = remaining <= 30
  return (
    <span
      className={`font-mono font-semibold tabular-nums${isUrgent ? ' countdown-urgent' : ''}`}
      style={isUrgent ? {} : { color: 'var(--color-text-primary)' }}
      aria-live="polite"
      aria-label={`${remaining} seconds remaining`}
    >
      {formatTime(remaining)}
    </span>
  )
}
