import { Track } from "../types";

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
  // Kept only for migration from older outbox entries; new entries store ids only.
  track?: Track;
  attempts: number;
  nextAttemptAt: number;
};

type RemoteTrackManifestRecord = {
  id: string;
  updatedAt: number;
  deleted: boolean;
  hash?: string | null;
};

type RemoteTrackRecord = RemoteTrackManifestRecord & {
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
  remoteManifest: RemoteTrackManifestRecord[],
  fetchRemoteTracks: (trackIds: string[]) => Promise<Map<string, RemoteTrackRecord>>,
  onConflict?: (conflict: SyncConflict) => Promise<SyncConflictChoice>,
): Promise<{ tracks: Track[]; localWins: Track[] }> {
  const map = new Map<string, Track>();
  const localWins: Track[] = [];
  const remoteIds = new Set(remoteManifest.map((row) => row.id));
  const neededRemoteIds: string[] = [];

  for (const localTrack of localTracks) {
    const normalized = normalizeTrack(localTrack);
    map.set(normalized.id, normalized);
  }

  for (const localTrack of map.values()) {
    if (!remoteIds.has(localTrack.id)) {
      const localWinner = {
        ...localTrack,
        updatedAt: now(),
      };
      localWins.push(localWinner);
      map.set(localTrack.id, localWinner);
    }
  }

  for (const row of remoteManifest) {
    const local = map.get(row.id);
    if (row.deleted) {
      continue;
    }

    if (!local) {
      neededRemoteIds.push(row.id);
      continue;
    }

    const localHash = await hashTrack(local);
    if (!localHash || !row.hash || localHash !== row.hash) {
      neededRemoteIds.push(row.id);
    }
  }

  const remoteDetails = await fetchRemoteTracks(Array.from(new Set(neededRemoteIds)));

  for (const row of remoteManifest) {
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
          const localWinner = {
            ...local,
            updatedAt: now(),
          };
          localWins.push(localWinner);
          map.set(row.id, localWinner);
          continue;
        }

        if (choice === "skip") {
          continue;
        }
      }

      map.delete(row.id);
      continue;
    }

    if (!local) {
      const remoteRow = remoteDetails.get(row.id);
      if (remoteRow?.track) {
        map.set(row.id, normalizeTrack(remoteRow.track));
      }
      continue;
    }

    const localHash = await hashTrack(local);
    const remoteHash = row.hash;

    if (localHash && remoteHash && localHash === remoteHash) {
      continue;
    }

    const remoteRow = remoteDetails.get(row.id);
    if (!remoteRow?.track) {
      continue;
    }

    const remote = normalizeTrack(remoteRow.track);
    if (onConflict) {
      const choice = await onConflict({
        trackId: row.id,
        localTrack: local,
        remoteTrack: remote,
        localUpdatedAt,
        remoteUpdatedAt: row.updatedAt,
        remoteDeleted: false,
      });

      if (choice === "local") {
        const localWinner = {
          ...local,
          updatedAt: now(),
        };
        localWins.push(localWinner);
        map.set(row.id, localWinner);
        continue;
      }

      if (choice === "skip") {
        continue;
      }
    }

    map.set(row.id, remote);
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

  const forceUploadLocal = async () => {
    if (!navigator.onLine) {
      emitStatus({ state: "offline" });
      return;
    }

    const authToken = getAuthToken();
    if (!authToken) {
      emitStatus({ state: "error", error: "not authenticated" });
      return;
    }

    const localTracks = options.getTracks().map((track) => ({
      ...track,
      updatedAt: now(),
    }));
    const localIds = new Set(localTracks.map((track) => track.id));

    const manifestResponse = await fetch("/api/tracks/manifest", {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    if (!manifestResponse.ok) {
      throw new Error(`sync manifest failed: ${manifestResponse.status}`);
    }
    const manifestPayload = (await manifestResponse.json()) as { tracks?: RemoteTrackManifestRecord[] };
    const deleteOps = (manifestPayload.tracks ?? [])
      .filter((row) => !row.deleted && !localIds.has(row.id))
      .map((row): OutboxItem => ({
        opId: generateId(),
        trackId: row.id,
        type: "delete",
        updatedAt: now(),
        attempts: 0,
        nextAttemptAt: 0,
      }));

    queueLocalWins(localTracks);
    if (deleteOps.length > 0) {
      setOutbox([...getOutbox(), ...deleteOps]);
    }
    emitStatus({ state: navigator.onLine ? "idle" : "offline" });
    await syncNow();
  };

  const forceDownloadCloud = async () => {
    if (syncing) {
      return;
    }

    if (!navigator.onLine) {
      emitStatus({ state: "offline" });
      return;
    }

    const authToken = getAuthToken();
    if (!authToken) {
      emitStatus({ state: "error", error: "not authenticated" });
      return;
    }

    syncing = true;
    emitStatus({ state: "syncing", error: null });

    try {
      const response = await fetch("/api/tracks", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`sync force pull failed: ${response.status}`);
      }

      const payload = (await response.json()) as {
        tracks?: RemoteTrackRecord[];
        serverTime?: number;
      };
      const cloudTracks = (payload.tracks ?? [])
        .filter((row) => !row.deleted && row.track)
        .map((row) => normalizeTrack(row.track as Track))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

      setOutbox([]);
      options.setTracks(cloudTracks);
      const syncedAt = payload.serverTime ?? now();
      setLastSyncAt(syncedAt);
      emitStatus({ state: "idle", pending: 0, lastSyncAt: syncedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync force pull failed";
      emitStatus({ state: "error", error: message });
    } finally {
      syncing = false;
      scheduleNextSync();
    }
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

      const before = getOutbox();
      const due = before.filter((item) => item.nextAttemptAt <= now());

      if (due.length > 0) {
        const localTracksById = new Map(options.getTracks().map((track) => [track.id, normalizeTrack(track)]));
        const locallyResolvedOperationIds = new Set<string>();
        const operations = due.flatMap((item) => {
          if (item.type === "delete") {
            return [{
              opId: item.opId,
              trackId: item.trackId,
              type: item.type,
              updatedAt: item.updatedAt,
            }];
          }

          const track = localTracksById.get(item.trackId) ?? item.track;
          if (!track) {
            locallyResolvedOperationIds.add(item.opId);
            return [];
          }

          const normalized = normalizeTrack(track);
          return [{
            opId: item.opId,
            trackId: item.trackId,
            type: item.type,
            updatedAt: Math.max(item.updatedAt, normalized.updatedAt ?? 0),
            track: normalized,
          }];
        });

        const response = await fetch("/api/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            deviceId: getDeviceId(),
            operations,
          }),
        });

        if (!response.ok) {
          throw new Error(`sync push failed: ${response.status}`);
        }

        const payload = (await response.json()) as { ackOperationIds?: string[] };
        const ackSet = new Set(payload.ackOperationIds ?? []);
        for (const opId of locallyResolvedOperationIds) {
          ackSet.add(opId);
        }
        setOutbox(before.filter((item) => !ackSet.has(item.opId)));
      }

      {
        const pullResponse = await fetch("/api/tracks/manifest", {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        if (!pullResponse.ok) {
          throw new Error(`sync pull failed: ${pullResponse.status}`);
        }

        const pullPayload = (await pullResponse.json()) as {
          tracks?: RemoteTrackManifestRecord[];
          serverTime?: number;
        };

        const fetchRemoteTracks = async (trackIds: string[]): Promise<Map<string, RemoteTrackRecord>> => {
          if (trackIds.length === 0) {
            return new Map();
          }

          const detailResponse = await fetch("/api/tracks/batch", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({ ids: trackIds }),
          });

          if (!detailResponse.ok) {
            throw new Error(`sync detail failed: ${detailResponse.status}`);
          }

          const detailPayload = (await detailResponse.json()) as { tracks?: RemoteTrackRecord[] };
          return new Map((detailPayload.tracks ?? []).map((track) => [track.id, track]));
        };

        const merged = await mergeTracks(
          options.getTracks(),
          pullPayload.tracks ?? [],
          fetchRemoteTracks,
          options.onConflict,
        );
        queueLocalWins(merged.localWins);
        options.setTracks(merged.tracks);

        const syncedAt = pullPayload.serverTime ?? now();
        setLastSyncAt(syncedAt);
        emitStatus({ state: "idle", lastSyncAt: syncedAt });
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
    forceUploadLocal,
    forceDownloadCloud,
  };
}


