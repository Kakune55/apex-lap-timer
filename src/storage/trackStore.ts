import { Track } from "../types";

const LEGACY_TRACKS_KEY = "apex_tracks";
const DB_NAME = "apex_lap_timer";
const DB_VERSION = 2;
const TRACKS_STORE = "tracks";
const LAPS_STORE = "laps";

type StoredLap = {
  id: string;
  trackId: string;
  lap: NonNullable<Track["laps"]>[number];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
    if (!db.objectStoreNames.contains(TRACKS_STORE)) {
      db.createObjectStore(TRACKS_STORE, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(LAPS_STORE)) {
      const lapsStore = db.createObjectStore(LAPS_STORE, { keyPath: "id" });
      lapsStore.createIndex("trackId", "trackId");
    }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readLegacyTracks(): Track[] {
  const saved = localStorage.getItem(LEGACY_TRACKS_KEY);
  if (!saved) {
    return [];
  }

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadStoredTracks(): Promise<Track[]> {
  if (typeof indexedDB === "undefined") {
    return readLegacyTracks();
  }

  const db = await openDb();
  const { tracks, laps } = await new Promise<{ tracks: Track[]; laps: StoredLap[] }>((resolve, reject) => {
    const transaction = db.transaction([TRACKS_STORE, LAPS_STORE], "readonly");
    const tracksRequest = transaction.objectStore(TRACKS_STORE).getAll();
    const lapsRequest = transaction.objectStore(LAPS_STORE).getAll();

    let storedTracks: Track[] | null = null;
    let storedLaps: StoredLap[] | null = null;
    const maybeResolve = () => {
      if (storedTracks && storedLaps) {
        resolve({ tracks: storedTracks, laps: storedLaps });
      }
    };

    tracksRequest.onsuccess = () => {
      storedTracks = tracksRequest.result as Track[];
      maybeResolve();
    };
    tracksRequest.onerror = () => reject(tracksRequest.error);
    lapsRequest.onsuccess = () => {
      storedLaps = lapsRequest.result as StoredLap[];
      maybeResolve();
    };
    lapsRequest.onerror = () => reject(lapsRequest.error);
  });

  if (tracks.length > 0) {
    const lapsByTrack = new Map<string, StoredLap[]>();
    for (const lap of laps) {
      const existing = lapsByTrack.get(lap.trackId) ?? [];
      existing.push(lap);
      lapsByTrack.set(lap.trackId, existing);
    }

    return tracks
      .map((track) => {
        const trackLaps = lapsByTrack.get(track.id)?.map((entry) => entry.lap) ?? track.laps;
        return trackLaps && trackLaps.length > 0
          ? {
              ...track,
              laps: trackLaps,
              history: trackLaps.map((lap) => lap.time),
            }
          : track;
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  const legacyTracks = readLegacyTracks();
  if (legacyTracks.length > 0) {
    await saveStoredTracks(legacyTracks);
  }
  return legacyTracks;
}

export async function saveStoredTracks(tracks: Track[]): Promise<void> {
  if (typeof indexedDB === "undefined") {
    localStorage.setItem(LEGACY_TRACKS_KEY, JSON.stringify(tracks));
    return;
  }

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([TRACKS_STORE, LAPS_STORE], "readwrite");
    const tracksStore = transaction.objectStore(TRACKS_STORE);
    const lapsStore = transaction.objectStore(LAPS_STORE);
    tracksStore.clear();
    lapsStore.clear();

    for (const track of tracks) {
      const { laps, history, ...baseTrack } = track;
      tracksStore.put(baseTrack);

      for (const lap of laps ?? []) {
        lapsStore.put({
          id: `${track.id}:${lap.id}`,
          trackId: track.id,
          lap,
        } satisfies StoredLap);
      }
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  localStorage.removeItem(LEGACY_TRACKS_KEY);
}
