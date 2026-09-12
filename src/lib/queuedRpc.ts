'use client'

// Queued RPC wrapper + rollback registry + connectivity/sync triggers.
//
// Contract per mutation attempt:
//   1. caller ensures payload.request_id (UUID, generated per attempt)
//   2. online → try immediately; network failure → enqueue, optimistic success
//   3. offline → enqueue immediately, optimistic success
//   4. replay (oldest-first) reuses the SAME request_ids → server dedupes
//   5. definitively-dead items invoke their registered rollback (if any)

import {
  enqueueMutation,
  replayQueue,
  countPendingMutations,
  type QueuedMutation,
} from './mutationQueue'

export type QueuedCallResult<T> =
  | { queued: false; data: T }
  | { queued: true; request_id: string }

type RollbackFn = () => void
const rollbackRegistry = new Map<string, RollbackFn>()

export function registerRollback(request_id: string, fn: RollbackFn) {
  rollbackRegistry.set(request_id, fn)
}

export function unregisterRollback(request_id: string) {
  rollbackRegistry.delete(request_id)
}

function runRollback(request_id: string) {
  const fn = rollbackRegistry.get(request_id)
  rollbackRegistry.delete(request_id)
  try { fn?.() } catch { /* rollback must never throw */ }
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function isNetworkFailure(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /failed to fetch|networkerror|load failed|network request failed|timeout/i.test(msg)
}

interface RpcClient {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
}

/**
 * Map the queue's internal payload onto the wire.
 * IndexedDB/rollback track the bare `request_id`, but every Postgres RPC
 * names the arg `p_request_id` — sending bare `request_id` makes PostgREST
 * look for `fn(p_match_id, p_team_id, request_id)`, which does not exist
 * (PGRST202 "Could not find the function … in the schema cache").
 */
function toWirePayload(
  payload: Record<string, unknown>,
  request_id: string
): Record<string, unknown> {
  const { request_id: _dropped, ...rest } = payload
  void _dropped
  if (rest.p_request_id == null) rest.p_request_id = request_id
  return rest
}

/**
 * Map one queued item back onto the wire during replay.
 * 'sent' = effect achieved (incl. already_processed / duplicate / deduped).
 * 'dead' = server definitively rejected → roll back optimistic UI.
 */
async function sendItem(
  client: RpcClient,
  item: QueuedMutation
): Promise<'sent' | 'retry' | 'dead'> {
  try {
    const { data, error } = await client.rpc(item.endpoint, toWirePayload(item.payload as Record<string, unknown>, item.request_id))
    if (!error) {
      const status = (data as { status?: string } | null)?.status
      // already_processed / duplicate / deduped all mean "effect achieved"
      if (!status || ['success', 'already_processed', 'duplicate'].includes(status)) return 'sent'
      return 'dead'
    }
    return 'dead' // server reached, definitive rejection (validation, completed, …)
  } catch (e) {
    return isNetworkFailure(e) ? 'retry' : 'dead'
  }
}

export async function callRpcQueued<T>(
  client: RpcClient,
  endpoint: string,
  payload: Record<string, unknown> & { request_id?: string }
): Promise<QueuedCallResult<T>> {
  const request_id = payload.request_id ?? crypto.randomUUID()
  const full = { ...payload, request_id }

  if (!isOnline()) {
    await enqueueMutation({ request_id, endpoint, payload: full })
    ensureSyncRegistered()
    return { queued: true, request_id }
  }

  try {
    const { data, error } = await client.rpc(endpoint, toWirePayload(full, request_id))
    if (error) throw new Error(error.message, { cause: 'server' })
    return { queued: false, data: data as T }
  } catch (e) {
    if (e instanceof Error && e.cause === 'server') throw e
    if (!isNetworkFailure(e)) throw e
    // Ambiguous (request may have landed): enqueue with the SAME request_id —
    // server dedupes, so at-most-once effect is preserved.
    await enqueueMutation({ request_id, endpoint, payload: full })
    ensureSyncRegistered()
    return { queued: true, request_id }
  }
}

export interface ReplayReport {
  sent: number
  stillPending: number
  dead: number
}

/** Replay everything pending; dead items roll back + report for toasts. */
export async function replayPending(
  client: RpcClient,
  onDead?: (item: QueuedMutation) => void
): Promise<ReplayReport> {
  return replayQueue(
    item => sendItem(client, item),
    item => {
      runRollback(item.request_id)
      onDead?.(item)
    }
  )
}

export async function pendingCount(): Promise<number> {
  try {
    return await countPendingMutations()
  } catch {
    return 0 // IndexedDB unavailable (private mode) → act as if empty
  }
}

// ── Connectivity triggers ───────────────────────────────────────────────────
let syncRegistered = false

/** Best-effort Background Sync registration (absent on iOS Safari). */
export function ensureSyncRegistered() {
  if (syncRegistered || typeof navigator === 'undefined') return
  try {
    const container = (navigator as Navigator).serviceWorker as unknown as
      { ready: Promise<unknown> } | undefined
    container?.ready.then(async (reg) => {
      try {
        const r = reg as { sync?: { register: (t: string) => Promise<void> } }
        await r.sync?.register('replay-mutations')
        syncRegistered = true
      } catch { /* SyncManager unavailable — online listener + Retry cover it */ }
    }).catch(() => {})
  } catch { /* unsupported — online listener + Retry button cover it */ }
}

export function hasBackgroundSync(): boolean {
  return typeof window !== 'undefined' && 'SyncManager' in window
}
