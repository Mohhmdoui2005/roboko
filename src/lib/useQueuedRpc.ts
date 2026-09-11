'use client'

// TanStack Query wrapper for idempotent queued mutations.
//
// Flow: mutate(args)
//   → request_id generated per attempt
//   → onMutate: optimistic UI applied immediately (rollback registered)
//   → online: RPC now · offline/net-fail: enqueued, optimistic success kept
//   → server/definitive error: TanStack onError → rollback runs
//   → replay-after-reconnect failure: registry rollback runs (SyncBadge)
//
// Either rollback path restores pre-mutation UI. No silent stuck states:
// SyncBadge always shows the pending count + manual Retry (iOS fallback).

import { useCallback, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import {
  callRpcQueued,
  registerRollback,
  unregisterRollback,
  replayPending,
  pendingCount,
  isOnline,
  type QueuedCallResult,
} from '@/lib/queuedRpc'
import type { QueuedMutation } from '@/lib/mutationQueue'

interface UseQueuedRpcOptions<TArgs, TResult> {
  endpoint: string
  onOptimistic?: (args: TArgs & { request_id: string }) => void
  onRollback?: (args: TArgs & { request_id: string }) => void
  onSettled?: (result: QueuedCallResult<TResult> | { error: Error }, args: TArgs & { request_id: string }) => void
}

export function useQueuedRpc<TArgs, TResult>(
  options: UseQueuedRpcOptions<TArgs, TResult>
) {
  const [queuedIds, setQueuedIds] = useState<string[]>([])

  type Full = TArgs & { request_id: string }
  const mutation = useMutation({
    mutationFn: async (args: TArgs) => {
      const supabase = createClient()
      return callRpcQueued<TResult>(
        supabase as unknown as Parameters<typeof callRpcQueued>[0],
        options.endpoint,
        args as Record<string, unknown> & { request_id?: string }
      )
    },
    onMutate: (args: TArgs) => {
      const full = args as Full
      if (!full.request_id) full.request_id = crypto.randomUUID()
      options.onOptimistic?.(full)
      registerRollback(full.request_id, () => options.onRollback?.(full))
    },
    onError: (error: Error, args: TArgs) => {
      const full = args as Full
      unregisterRollback(full.request_id)
      setQueuedIds(prev => prev.filter(id => id !== full.request_id))
      options.onRollback?.(full)
      options.onSettled?.({ error }, full)
    },
    onSuccess: (result, args: TArgs) => {
      const full = args as Full
      if (result.queued) {
        setQueuedIds(prev => (prev.includes(full.request_id) ? prev : [...prev, full.request_id]))
      } else {
        unregisterRollback(full.request_id)
        setQueuedIds(prev => prev.filter(id => id !== full.request_id))
      }
      options.onSettled?.(result, full)
    },
  })

  const markSynced = useCallback((request_id: string) => {
    unregisterRollback(request_id)
    setQueuedIds(prev => prev.filter(id => id !== request_id))
  }, [])

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    queuedIds,
    markSynced,
  }
}

/** Shared sync engine for SyncBadge: auto-replay + counts + manual retry. */
export function useSyncEngine(onDead?: (item: QueuedMutation) => void) {
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const refreshCount = useCallback(async () => {
    setPending(await pendingCount())
  }, [])

  const retryNow = useCallback(async (): Promise<void> => {
    if (!isOnline()) return
    setSyncing(true)
    try {
      const supabase = createClient()
      await replayPending(
        supabase as unknown as Parameters<typeof replayPending>[0],
        onDead
      )
    } finally {
      setPending(await pendingCount())
      setSyncing(false)
    }
  }, [onDead])

  return { pending, syncing, refreshCount, retryNow }
}
