/**
 * Thread-local sentinel store for metamorphic leakage tests.
 * When active, historical queries read from the in-memory store instead of SQLite.
 */
import type { SentinelValidatedStore } from './sentinelValidatedStore';

let activeStore: SentinelValidatedStore | null = null;

export function getActiveSentinelStore(): SentinelValidatedStore | null {
  return activeStore;
}

export function runWithSentinelStore<T>(store: SentinelValidatedStore | null, fn: () => T): T {
  const previous = activeStore;
  activeStore = store;
  try {
    return fn();
  } finally {
    activeStore = previous;
  }
}
