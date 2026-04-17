import { Lap, Track, TrackPoint } from '../types';

const SHARE_CODE_PREFIX = 'APEXTRACK1';
const GZIP_PREFIX = `${SHARE_CODE_PREFIX}G:`;
const RAW_PREFIX = `${SHARE_CODE_PREFIX}:`;

type SharedTrackPayload = {
    version: 1;
    exportedAt: number;
    includeRecords: boolean;
    track: Track;
};

export type ParsedSharedTrack = {
    includeRecords: boolean;
    exportedAt: number;
    track: Track;
};

function cloneTrack(track: Track): Track {
    return JSON.parse(JSON.stringify(track)) as Track;
}

function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function bytesToBase64Url(bytes: Uint8Array) {
    let binary = '';
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(input: string) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

async function maybeCompress(bytes: Uint8Array) {
    if (typeof CompressionStream === 'undefined') {
        return null;
    }

    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());

    if (compressed.byteLength >= bytes.byteLength) {
        return null;
    }

    return compressed;
}

async function maybeDecompress(bytes: Uint8Array) {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('decompression_unsupported');
    }

    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isTrackPoint(value: unknown): value is TrackPoint {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const point = value as Partial<TrackPoint>;
    return (
        isFiniteNumber(point.lat) &&
        isFiniteNumber(point.lon) &&
        isFiniteNumber(point.timeOffset) &&
        isFiniteNumber(point.distance)
    );
}

function isLap(value: unknown): value is Lap {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const lap = value as Partial<Lap>;
    return (
        typeof lap.id === 'string' &&
        isFiniteNumber(lap.time) &&
        Array.isArray(lap.points) &&
        lap.points.every(isTrackPoint) &&
        isFiniteNumber(lap.date)
    );
}

function isValidTrack(value: unknown): value is Track {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const track = value as Partial<Track>;
    const hasGate = (gate: unknown) => {
        if (!gate || typeof gate !== 'object') {
            return false;
        }

        const candidate = gate as Partial<Track['startGate']>;
        return (
            isFiniteNumber(candidate.lat) &&
            isFiniteNumber(candidate.lon) &&
            isFiniteNumber(candidate.heading) &&
            isFiniteNumber(candidate.width)
        );
    };

    return (
        typeof track.id === 'string' &&
        typeof track.name === 'string' &&
        (track.type === 'circuit' || track.type === 'sprint') &&
        hasGate(track.startGate) &&
        hasGate(track.finishGate) &&
        Array.isArray(track.points) &&
        track.points.every(isTrackPoint) &&
        isFiniteNumber(track.totalDistance) &&
        isFiniteNumber(track.bestTime) &&
        (!track.sectors || (Array.isArray(track.sectors) && track.sectors.every(hasGate))) &&
        (!track.history || (Array.isArray(track.history) && track.history.every(isFiniteNumber))) &&
        (!track.laps || (Array.isArray(track.laps) && track.laps.every(isLap)))
    );
}

function normalizeImportedTrack(track: Track): Track {
    const cloned = cloneTrack(track);
    const normalizedLaps = cloned.laps?.map((lap) => ({
        ...lap,
        id: generateId(),
    }));

    return {
        ...cloned,
        id: generateId(),
        updatedAt: Date.now(),
        history: normalizedLaps ? normalizedLaps.map((lap) => lap.time) : cloned.history,
        laps: normalizedLaps,
    };
}

function toSharedTrack(track: Track, includeRecords: boolean): Track {
    const cloned = cloneTrack(track);
    if (includeRecords) {
        return cloned;
    }

    delete cloned.history;
    delete cloned.laps;
    return cloned;
}

function extractShareCode(input: string) {
    const trimmed = input.trim();
    const match = trimmed.match(/APEXTRACK1G?:[A-Za-z0-9\-_]+/);
    if (match) {
        return match[0];
    }
    return trimmed;
}

export async function createTrackShareCode(track: Track, includeRecords: boolean) {
    const payload: SharedTrackPayload = {
        version: 1,
        exportedAt: Date.now(),
        includeRecords,
        track: toSharedTrack(track, includeRecords),
    };

    const rawBytes = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await maybeCompress(rawBytes);

    if (compressed) {
        return `${GZIP_PREFIX}${bytesToBase64Url(compressed)}`;
    }

    return `${RAW_PREFIX}${bytesToBase64Url(rawBytes)}`;
}

export async function parseTrackShareInput(input: string): Promise<ParsedSharedTrack> {
    const code = extractShareCode(input);
    const isGzip = code.startsWith(GZIP_PREFIX);
    const isRaw = code.startsWith(RAW_PREFIX);

    if (!isGzip && !isRaw) {
        throw new Error('invalid_share_code');
    }

    const encoded = code.slice(isGzip ? GZIP_PREFIX.length : RAW_PREFIX.length);
    const bytes = base64UrlToBytes(encoded);
    const decodedBytes = isGzip ? await maybeDecompress(bytes) : bytes;
    const payload = JSON.parse(new TextDecoder().decode(decodedBytes)) as Partial<SharedTrackPayload>;

    if (payload.version !== 1 || !isValidTrack(payload.track)) {
        throw new Error('invalid_share_payload');
    }

    return {
        includeRecords: Boolean(payload.includeRecords),
        exportedAt: isFiniteNumber(payload.exportedAt) ? payload.exportedAt : Date.now(),
        track: normalizeImportedTrack(payload.track),
    };
}
