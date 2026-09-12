'use client'

// Pending-mutations indicator + manual Retry.
// Visible whenever anything is queued — this is the iOS fallback
// (no Background Sync there) and the safety net everywhere else.

import { useCallback, useEffect } from 'react'
import { useSyncEngine } from '@/lib/useQueuedRpc'
import { hasBackgroundSync, isOnline } from '@/lib/queuedRpc'
import type { QueuedMutation } from '@/lib/mutationQueue'

export default function SyncBadge({ onDead }: { onDead?: (item: QueuedMutation) => void }) {
  const { pending, syncing, refreshCount, retryNow } = useSyncEngine(onDead)

  const handleMessage = useCallback((e: MessageEvent) => {
    if ((e.data as { type?: string })?.type === 'REPLAY_MUTATIONS') retryNow()
  }, [retryNow])

  useEffect(() => {
    refreshCount()
    // Auto-sync: on reconnect, on mount (if online), on SW sync message
    const onOnline = () => retryNow()
    window.addEventListener('online', onOnline)
    retryNow()
    let swListener = false
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage)
      swListener = true
    }
    return () => {
      window.removeEventListener('online', onOnline)
      if (swListener) navigator.serviceWorker.removeEventListener('message', handleMessage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (pending === 0) return null

  return (
    <div className="flex items-center gap-2 p-2 px-3"
      style={{
        borderRadius: 8,
        border: '1px solid var(--color-warning)',
        background: 'color-mix(in srgb, var(--color-warning) 8%, var(--color-surface))',
      }} role="status">
      <span className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--color-warning)', fontWeight: 600 }}>
        QUEUED · {pending} mutation{pending === 1 ? '' : 's'}
        {!hasBackgroundSync() && !isOnline() ? ' · offline' : ''}
      </span>
      <button className="btn btn-primary" style={{ minHeight: 48, padding: '0 0.9rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
        onClick={() => retryNow()} disabled={syncing || !isOnline()}>
        {syncing ? 'Syncing…' : 'Retry now'}
      </button>
      {!hasBackgroundSync() && (
        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
          auto-sync unavailable — use Retry
        </span>
      )}
    </div>
  )
}
