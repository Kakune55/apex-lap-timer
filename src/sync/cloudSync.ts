import { Track } from "../types";

const TRACKS_KEY = "apex_tracks";
const OUTBOX_KEY = "apex_sync_outbox";
const DEVICE_ID_KEY = "apex_device_id";
const LAST_SYNC_KEY = "apex_last_sync_at";
const AUTH_TOKEN_KEY = "apex_auth_token";

export type SyncState = "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncAt: number | null;
  error: string | null;
}

export type SyncConflictChoice = "local" | "remote" | "skip";

export type SyncConflict = {
  trackId: string;
  localTrack: Track | null;
  remoteTrack: Track | null;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  remoteDeleted: boolean;
};

type OutboxItem = {
  opId: string;
  trackId: string;
  type: "upsert" | "delete";
  updatedAt: number;
  track?: Track;
  attempts: number;
  nextAttemptAt: number;
};

type RemoteTrackRecord = {
  id: string;
  updatedAt: number;
  deleted: boolean;
  hash?: string | null;
  track: Track | null;
};

function now() {
  return Date.now();
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTrack(track: Track): Track {
  return {
    ...track,
    updatedAt: track.updatedAt ?? now(),
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableJson(value: unknown): string {
  if (typeof value === "undefined") {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => key !== "updatedAt" && typeof record[key] !== "undefined")
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

async function hashTrack(track: Track | null): Promise<string | null> {
  if (!track) {
    return null;
  }

  const bytes = new TextEncoder().encode(stableJson(track));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getOutbox(): OutboxItem[] {
  return readJson<OutboxItem[]>(OUTBOX_KEY, []);
}

function setOutbox(items: OutboxItem[]) {
  writeJson(OUTBOX_KEY, items);
}

function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }
  const id = generateId();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

function getLastSyncAt(): number {
  return Number(localStorage.getItem(LAST_SYNC_KEY) || 0);
}

function setLastSyncAt(ts: number) {
  localStorage.setItem(LAST_SYNC_KEY, String(ts));
}

export function setAuthToken(token: string) {
  if (!token) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function getAuthToken(): string | null {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token && token.trim() ? token : null;
}

async function mergeTracks(
  localTracks: Track[],
  remoteTracks: RemoteTrackRecord[],
  onConflict?: (conflict: SyncConflict) => Promise<SyncConflictChoice>,
): Promise<{ tracks: Track[]; localWins: Track[] }> {
  const map = new Map<string, Track>();
  const localWins: Track[] = [];

  for (const localTrack of localTracks) {
    const normalized = normalizeTrack(localTrack);
    map.set(normalized.id, normalized);
  }

  for (const row of remoteTracks) {
    const local = map.get(row.id);
    const localUpdatedAt = local?.updatedAt ?? 0;

    if (row.deleted) {
      if (local && onConflict) {
        const choice = await onConflict({
          trackId: row.id,
          localTrack: local,
          remoteTrack: null,
          localUpdatedAt,
          remoteUpdatedAt: row.updatedAt,
          remoteDeleted: true,
        });

        if (choice === "local") {
          localWins.push(local);
          continue;
        }

        if (choice === "skip") {
          continue;
        }
      }

      map.delete(row.id);
      continue;
    }

    if (row.track) {
      const remote = normalizeTrack(row.track);
      const localHash = await hashTrack(local ?? null);
      const remoteHash = row.hash ?? await hashTrack(remote);

      if (local && localHash && remoteHash && localHash !== remoteHash && onConflict) {
        const choice = await onConflict({
          trackId: row.id,
          localTrack: local,
          remoteTrack: remote,
          localUpdatedAt,
          remoteUpdatedAt: row.updatedAt,
          remoteDeleted: false,
        });

        if (choice === "local") {
          localWins.push(local);
          continue;
        }

        if (choice === "skip") {
          continue;
        }
      }

      map.set(row.id, remote);
    }
  }

  return {
    tracks: Array.from(map.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    localWins,
  };
}

function retryDelay(attempts: number) {
  return Math.min(60000, 1000 * 2 ** Math.max(0, attempts));
}

const STALE_PULL_MS = 120000;

export function createCloudSync(options: {
  getTracks: () => Track[];
  setTracks: (tracks: Track[]) => void;
  setStatus: (status: SyncStatus) => void;
  onConflict?: (conflict: SyncConflict) => Promise<SyncConflictChoice>;
}) {
  let timer: number | null = null;
  let syncing = false;

  const canBackgroundSync = () =>
    navigator.onLine &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible";

  const scheduleNextSync = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    if (!canBackgroundSync()) {
      return;
    }

    const nowTs = now();
    const outbox = getOutbox();
    const nextRetryAt = outbox.reduce<number | null>((next, item) => {
      if (item.nextAttemptAt <= nowTs) {
        return nowTs;
      }

      if (next === null || item.nextAttemptAt < next) {
        return item.nextAttemptAt;
      }

      return next;
    }, null);

    const nextStalePullAt = getLastSyncAt() + STALE_PULL_MS;
    let nextAt = nextRetryAt;

    if (!nextAt || nextStalePullAt < nextAt) {
      nextAt = nextStalePullAt;
    }

    const delay = Math.max(1000, (nextAt ?? nowTs + STALE_PULL_MS) - nowTs);
    timer = window.setTimeout(() => {
      void syncNow();
    }, delay);
  };

  const emitStatus = (partial: Partial<SyncStatus>) => {
    const currentPending = getOutbox().length;
    const status: SyncStatus = {
      state: partial.state ?? "idle",
      pending: partial.pending ?? currentPending,
      lastSyncAt: partial.lastSyncAt ?? (getLastSyncAt() || null),
      error: partial.error ?? null,
    };
    options.setStatus(status);
  };

  const queueUpsert = (track: Track) => {
    const normalized = normalizeTrack(track);
    const outbox = getOutbox().filter((item) => item.trackId !== normalized.id);
    outbox.push({
      opId: generateId(),
      trackId: normalized.id,
      type: "upsert",
      updatedAt: normalized.updatedAt ?? now(),
      track: normalized,
      attempts: 0,
      nextAttemptAt: 0,
    });
    setOutbox(outbox);
    emitStatus({ state: navigator.onLine ? "idle" : "offline" });
    void syncNow();
  };

  const queueLocalWins = (tracks: Track[]) => {
    if (tracks.length === 0) {
      return;
    }

    const replaceIds = new Set(tracks.map((track) => track.id));
    const outbox = getOutbox().filter((item) => !replaceIds.has(item.trackId));

    for (const track of tracks) {
      const normalized = normalizeTrack(track);
      outbox.push({
        opId: generateId(),
        trackId: normalized.id,
        type: "upsert",
        updatedAt: normalized.updatedAt ?? now(),
        track: normalized,
        attempts: 0,
        nextAttemptAt: 0,
      });
    }

    setOutbox(outbox);
  };

  const queueDelete = (trackId: string, updatedAt = now()) => {
    const outbox = getOutbox().filter((item) => item.trackId !== trackId);
    outbox.push({
      opId: generateId(),
      trackId,
      type: "delete",
      updatedAt,
      attempts: 0,
      nextAttemptAt: 0,
    });
    setOutbox(outbox);
    emitStatus({ state: navigator.onLine ? "idle" : "offline" });
    void syncNow();
  };

  const syncNow = async () => {
    if (syncing) {
      return;
    }

    if (!navigator.onLine) {
      emitStatus({ state: "offline" });
      scheduleNextSync();
      return;
    }

    syncing = true;
    emitStatus({ state: "syncing", error: null });

    try {
      const authToken = getAuthToken();
      if (!authToken) {
        emitStatus({ state: "error", error: "not authenticated" });
        return;
      }

      const syncStartedAt = now();
      const before = getOutbox();
      const due = before.filter((item) => item.nextAttemptAt <= now());

      if (due.length > 0) {
        const response = await fetch("/api/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            deviceId: getDeviceId(),
            operations: due.map((item) => ({
              opId: item.opId,
              trackId: item.trackId,
              type: item.type,
              updatedAt: item.updatedAt,
              track: item.track,
            })),
          }),
        });

        if (!response.ok) {
          throw new Error(`sync push failed: ${response.status}`);
        }

        const payload = (await response.json()) as { ackOperationIds?: string[] };
        const ackSet = new Set(payload.ackOperationIds ?? []);
        setOutbox(before.filter((item) => !ackSet.has(item.opId)));
      }

      const lastSyncAt = getLastSyncAt();
      const shouldPull = due.length > 0 || syncStartedAt - lastSyncAt >= STALE_PULL_MS;

      if (shouldPull) {
        const pullResponse = await fetch("/api/tracks", {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        if (!pullResponse.ok) {
          throw new Error(`sync pull failed: ${pullResponse.status}`);
        }

        const pullPayload = (await pullResponse.json()) as {
          tracks?: RemoteTrackRecord[];
          serverTime?: number;
        };

        const merged = await mergeTracks(options.getTracks(), pullPayload.tracks ?? [], options.onConflict);
        queueLocalWins(merged.localWins);
        options.setTracks(merged.tracks);
        localStorage.setItem(TRACKS_KEY, JSON.stringify(merged.tracks));

        const syncedAt = pullPayload.serverTime ?? now();
        setLastSyncAt(syncedAt);
        emitStatus({ state: "idle", lastSyncAt: syncedAt });
      } else {
        emitStatus({ state: "idle", lastSyncAt: lastSyncAt || null });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync failed";
      const outbox = getOutbox();
      const dueSet = new Set(outbox.filter((item) => item.nextAttemptAt <= now()).map((item) => item.opId));
      const updated = outbox.map((item) => {
        if (!dueSet.has(item.opId)) {
          return item;
        }
        const attempts = item.attempts + 1;
        return {
          ...item,
          attempts,
          nextAttemptAt: now() + retryDelay(attempts),
        };
      });
      setOutbox(updated);
      emitStatus({ state: "error", error: message });
    } finally {
      syncing = false;
      scheduleNextSync();
    }
  };

  const handleOnline = () => {
    void syncNow();
  };

  const handleFocus = () => {
    void syncNow();
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      void syncNow();
    } else {
      scheduleNextSync();
    }
  };

  const start = () => {
    emitStatus({ state: navigator.onLine ? "idle" : "offline" });
    void syncNow();
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("visibilitychange", handleVisibility);
    scheduleNextSync();
  };

  const stop = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("visibilitychange", handleVisibility);
  };

  return {
    start,
    stop,
    syncNow,
    queueUpsert,
    queueDelete,
  };
}


