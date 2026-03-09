import { Track } from "../types";

const TRACKS_KEY = "apex_tracks";
const OUTBOX_KEY = "apex_sync_outbox";
const DEVICE_ID_KEY = "apex_device_id";
const LAST_SYNC_KEY = "apex_last_sync_at";

export type SyncState = "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncAt: number | null;
  error: string | null;
}

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

function mergeTracks(localTracks: Track[], remoteTracks: RemoteTrackRecord[]): Track[] {
  const map = new Map<string, Track>();

  for (const localTrack of localTracks) {
    const normalized = normalizeTrack(localTrack);
    map.set(normalized.id, normalized);
  }

  for (const row of remoteTracks) {
    const local = map.get(row.id);
    const localUpdatedAt = local?.updatedAt ?? 0;

    if (row.updatedAt < localUpdatedAt) {
      continue;
    }

    if (row.deleted) {
      map.delete(row.id);
      continue;
    }

    if (row.track) {
      map.set(row.id, normalizeTrack(row.track));
    }
  }

  return Array.from(map.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function retryDelay(attempts: number) {
  return Math.min(60000, 1000 * 2 ** Math.max(0, attempts));
}

export function createCloudSync(options: {
  getTracks: () => Track[];
  setTracks: (tracks: Track[]) => void;
  setStatus: (status: SyncStatus) => void;
}) {
  let timer: number | null = null;
  let syncing = false;

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
      return;
    }

    syncing = true;
    emitStatus({ state: "syncing", error: null });

    try {
      const before = getOutbox();
      const due = before.filter((item) => item.nextAttemptAt <= now());

      if (due.length > 0) {
        const response = await fetch("/api/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
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

      const since = getLastSyncAt();
      const pullResponse = await fetch(`/api/tracks?since=${since}`);
      if (!pullResponse.ok) {
        throw new Error(`sync pull failed: ${pullResponse.status}`);
      }

      const pullPayload = (await pullResponse.json()) as {
        tracks?: RemoteTrackRecord[];
        serverTime?: number;
      };

      const merged = mergeTracks(options.getTracks(), pullPayload.tracks ?? []);
      options.setTracks(merged);
      localStorage.setItem(TRACKS_KEY, JSON.stringify(merged));

      const syncedAt = pullPayload.serverTime ?? now();
      setLastSyncAt(syncedAt);
      emitStatus({ state: "idle", lastSyncAt: syncedAt });
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
    }
  };

  const handleOnline = () => {
    void syncNow();
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      void syncNow();
    }
  };

  const start = () => {
    emitStatus({ state: navigator.onLine ? "idle" : "offline" });
    void syncNow();
    timer = window.setInterval(() => {
      void syncNow();
    }, 15000);
    window.addEventListener("online", handleOnline);
    window.addEventListener("visibilitychange", handleVisibility);
  };

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    window.removeEventListener("online", handleOnline);
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
