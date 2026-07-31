// CRM-ROADMAP Phase 4, Feature 1 — Field Sales / Distributor CRM.
//
// A small, purpose-built offline write-queue for field-visit check-in/check-out submissions
// only — deliberately not a generic "offline framework." This app's service worker
// (public/sw.js) explicitly does not queue writes; this is the first place web-frontend gains
// any real offline-write capability, scoped narrowly to the one feature that actually needs it.
//
// Conflict/idempotency handling is NOT reinvented here: every queued action carries a
// `clientOperationId` (see FieldVisitService.logVisit on the backend), so a queued action
// replayed after reconnect is safe to retry even if it partially succeeded before the network
// dropped — the backend's existing OFFLINE-02/05-style unique-constraint mechanism absorbs the
// duplicate.

const DB_NAME = 'erp-field-visit-queue';
const STORE_NAME = 'pending-actions';
const DB_VERSION = 1;

export interface QueuedVisitAction {
  id: string;
  url: string;
  method: 'POST' | 'PUT';
  body: Record<string, unknown>;
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueVisitAction(
  action: Omit<QueuedVisitAction, 'id' | 'queuedAt'>
): Promise<void> {
  const db = await openDb();
  const full: QueuedVisitAction = { ...action, id: crypto.randomUUID(), queuedAt: Date.now() };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(full);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listQueuedVisitActions(): Promise<QueuedVisitAction[]> {
  const db = await openDb();
  const result = await new Promise<QueuedVisitAction[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueuedVisitAction[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result.sort((a, b) => a.queuedAt - b.queuedAt);
}

async function removeQueuedVisitAction(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// The bearer token is fetched fresh at send time (never captured into the queued record) —
// a queued action can sit for hours before a flush, long after the token captured at queue
// time would have expired.
function authHeaders(getAccessToken: () => string | null): Record<string, string> {
  const token = getAccessToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Attempts a field-visit submission immediately. On a genuine network failure (offline, DNS
 * failure — a `TypeError` from `fetch` itself, never an HTTP error response), queues it instead
 * of surfacing an error to the rep. Returns `{ queued: true }` so the caller can show "saved,
 * will sync" rather than a hard failure.
 */
export async function submitOrQueueVisitAction(
  action: Omit<QueuedVisitAction, 'id' | 'queuedAt'>,
  getAccessToken: () => string | null
): Promise<{ queued: false; response: Response } | { queued: true }> {
  try {
    const response = await fetch(action.url, {
      method: action.method,
      headers: authHeaders(getAccessToken),
      body: JSON.stringify(action.body),
    });
    return { queued: false, response };
  } catch {
    await enqueueVisitAction(action);
    return { queued: true };
  }
}

/** Replays every queued action in submission order, stopping at the first one that still fails
 *  (offline again, or a genuine server error) so later actions don't run out of order. */
export async function flushVisitQueue(
  getAccessToken: () => string | null
): Promise<{ flushed: number; remaining: number }> {
  const pending = await listQueuedVisitActions();
  let flushed = 0;
  for (const action of pending) {
    try {
      const response = await fetch(action.url, {
        method: action.method,
        headers: authHeaders(getAccessToken),
        body: JSON.stringify(action.body),
      });
      if (!response.ok && response.status >= 500) break;
      await removeQueuedVisitAction(action.id);
      flushed++;
    } catch {
      break;
    }
  }
  const remaining = (await listQueuedVisitActions()).length;
  return { flushed, remaining };
}
