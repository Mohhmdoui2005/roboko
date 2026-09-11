// Offline mutation queue (IndexedDB via idb).
// Each item carries request_id + endpoint + payload + timestamp, so replays
// after reconnect are idempotent server-side (no duplicates, Part 2 rule).

import { openDB, type IDBPDatabase } from 'idb'

export interface QueuedMutation {
  request_id: string
  endpoint: string
  payload: Record<string, unknown>
  timestamp: number
  attempts: number
  lastError: string | null
  status: 'pending' | 'failed'
}

const DB_NAME = 'tournament-mutations'
const STORE = 'queue'
const MAX_ATTEMPTS = 5

let dbPromise: Promise<IDBPDatabase> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        const store = d.createObjectStore(STORE, { keyPath: 'request_id' })
        store.createIndex('by-timestamp', 'timestamp')
      },
    })
  }
  return dbPromise
}

export async function enqueueMutation(
  item: Pick<QueuedMutation, 'request_id' | 'endpoint' | 'payload'>
): Promise<void> {
  const d = await db()
  const existing = await d.get(STORE, item.request_id)
  if (existing) return // same request_id never queued twice
  await d.put(STORE, {
    ...item,
    timestamp: Date.now(),
    attempts: 0,
    lastError: null,
    status: 'pending',
  } as QueuedMutation)
}

export async function getPendingMutations(): Promise<QueuedMutation[]> {
  const d = await db()
  const all = await d.getAllFromIndex(STORE, 'by-timestamp')
  return (all as QueuedMutation[]).filter(m => m.status === 'pending')
}

export async function countPendingMutations(): Promise<number> {
  return (await getPendingMutations()).length
}

export async function removeMutation(request_id: string): Promise<void> {
  const d = await db()
  await d.delete(STORE, request_id)
}

export async function bumpMutation(request_id: string, lastError: string, dead: boolean): Promise<void> {
  const d = await db()
  const tx = d.transaction(STORE, 'readwrite')
  const current = (await tx.store.get(request_id)) as QueuedMutation | undefined
  if (!current) return
  current.attempts += 1
  current.lastError = lastError
  if (dead || current.attempts >= MAX_ATTEMPTS) current.status = 'failed'
  await tx.store.put(current)
  await tx.done
}

export type SendOutcome = 'sent' | 'retry' | 'dead'

/**
 * Replay pending mutations oldest-first.
 * sender() maps one item to sent | retry (keep queued) | dead (give up).
 * onDead fires per dead item so the UI can roll back its optimistic update.
 * Returns { sent, stillPending, dead }.
 */
export async function replayQueue(
  sender: (item: QueuedMutation) => Promise<SendOutcome>,
  onDead?: (item: QueuedMutation) => void
): Promise<{ sent: number; stillPending: number; dead: number }> {
  let sent = 0
  let dead = 0
  const pending = await getPendingMutations()
  for (const item of pending) {
    let outcome: SendOutcome
    try {
      outcome = await sender(item)
    } catch (e) {
      outcome = 'retry'
      await bumpMutation(item.request_id, e instanceof Error ? e.message : 'network error', false)
      continue
    }
    if (outcome === 'sent') {
      await removeMutation(item.request_id)
      sent++
    } else if (outcome === 'dead') {
      await bumpMutation(item.request_id, 'rejected by server', true)
      dead++
      onDead?.(item)
    } else {
      await bumpMutation(item.request_id, 'not reachable', false)
    }
  }
  const stillPending = await countPendingMutations()
  return { sent, stillPending, dead }
}
