import { Gate, TrackPoint } from '../types';

export const R = 6371000;

export function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

export function toLocal(lat: number, lon: number, centerLat: number, centerLon: number) {
    const x = (lon - centerLon) * (Math.PI / 180) * Math.cos(centerLat * Math.PI / 180) * R;
    const y = (lat - centerLat) * (Math.PI / 180) * R;
    return { x, y };
}

export function segmentsIntersect(p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}, p4: {x:number, y:number}) {
    const ccw = (A: any, B: any, C: any) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

export function getGateEndpoints(lat: number, lon: number, heading: number, width: number) {
    const gateHeading = heading + 90;
    const rad = gateHeading * Math.PI / 180;
    const dx = Math.sin(rad) * (width / 2);
    const dy = Math.cos(rad) * (width / 2);
    return [
        { x: dx, y: dy },
        { x: -dx, y: -dy }
    ];
}

export function checkGateCrossing(
    prevLat: number, prevLon: number,
    currLat: number, currLon: number,
    gate: {lat: number, lon: number, heading: number, width: number}
): boolean {
    const p1 = toLocal(prevLat, prevLon, gate.lat, gate.lon);
    const p2 = toLocal(currLat, currLon, gate.lat, gate.lon);
    const [g1, g2] = getGateEndpoints(gate.lat, gate.lon, gate.heading, gate.width);

    if (segmentsIntersect(p1, p2, g1, g2)) {
        const moveX = p2.x - p1.x;
        const moveY = p2.y - p1.y;
        const gateRad = gate.heading * Math.PI / 180;
        const dirX = Math.sin(gateRad);
        const dirY = Math.cos(gateRad);
        const dot = moveX * dirX + moveY * dirY;
        return dot > 0; // Must cross in the correct direction
    }
    return false;
}

export function estimateGateCrossingTime(
    prevLat: number,
    prevLon: number,
    prevTime: number,
    currLat: number,
    currLon: number,
    currTime: number,
    gate: Gate,
): number | null {
    const p1 = toLocal(prevLat, prevLon, gate.lat, gate.lon);
    const p2 = toLocal(currLat, currLon, gate.lat, gate.lon);
    const [g1, g2] = getGateEndpoints(gate.lat, gate.lon, gate.heading, gate.width);

    if (!segmentsIntersect(p1, p2, g1, g2)) {
        return null;
    }

    const moveX = p2.x - p1.x;
    const moveY = p2.y - p1.y;
    const gateRad = gate.heading * Math.PI / 180;
    const dirX = Math.sin(gateRad);
    const dirY = Math.cos(gateRad);
    const directionDot = moveX * dirX + moveY * dirY;

    // Crossing in reverse direction should not trigger lap timing.
    if (directionDot <= 0) {
        return null;
    }

    // Signed distance to gate line along gate normal (heading direction).
    const s1 = p1.x * dirX + p1.y * dirY;
    const s2 = p2.x * dirX + p2.y * dirY;
    const denom = s1 - s2;
    if (Math.abs(denom) < 1e-9) {
        return (prevTime + currTime) / 2;
    }

    const ratio = Math.max(0, Math.min(1, s1 / denom));
    return prevTime + ratio * (currTime - prevTime);
}

export function formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
}

export function formatDelta(ms: number): string {
    const sign = ms > 0 ? '+' : '-';
    const absMs = Math.abs(ms);
    const seconds = Math.floor(absMs / 1000);
    const milliseconds = Math.floor((absMs % 1000) / 10);
    return `${sign}${seconds}.${milliseconds.toString().padStart(2, '0')}`;
}

export function getExpectedTime(points: TrackPoint[], currentDistance: number): number {
    if (points.length === 0) return 0;
    if (currentDistance <= points[0].distance) return points[0].timeOffset;
    if (currentDistance >= points[points.length - 1].distance) return points[points.length - 1].timeOffset;

    for (let i = 0; i < points.length - 1; i++) {
        if (currentDistance >= points[i].distance && currentDistance <= points[i+1].distance) {
            const p1 = points[i];
            const p2 = points[i+1];
            if (p2.distance === p1.distance) return p1.timeOffset;
            const distRatio = (currentDistance - p1.distance) / (p2.distance - p1.distance);
            return p1.timeOffset + distRatio * (p2.timeOffset - p1.timeOffset);
        }
    }
    return 0;
}

export interface TrackProjectionOptions {
    minDistance?: number;
    maxDistance?: number;
    maxLateralError?: number;
    targetDistance?: number;
    continuityWeight?: number;
}

export interface TrackProjectionResult {
    distance: number;
    lateralError: number;
}

export function projectToTrackDistance(
    points: TrackPoint[],
    lat: number,
    lon: number,
    options: TrackProjectionOptions = {},
): TrackProjectionResult | null {
    if (points.length < 2) {
        return null;
    }

    const minDistance = options.minDistance ?? 0;
    const maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
    const maxLateralError = options.maxLateralError ?? Number.POSITIVE_INFINITY;
    const targetDistance = options.targetDistance;
    const continuityWeight = options.continuityWeight ?? 0;

    let best: TrackProjectionResult | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        if (p2.distance < minDistance || p1.distance > maxDistance) {
            continue;
        }

        const a = toLocal(p1.lat, p1.lon, lat, lon);
        const b = toLocal(p2.lat, p2.lon, lat, lon);

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) {
            continue;
        }

        let t = (-(a.x * dx + a.y * dy)) / lenSq;
        t = Math.max(0, Math.min(1, t));

        const closestX = a.x + t * dx;
        const closestY = a.y + t * dy;
        const lateralError = Math.hypot(closestX, closestY);
        if (lateralError > maxLateralError) {
            continue;
        }

        const segmentDistance = p1.distance + (p2.distance - p1.distance) * t;
        if (segmentDistance < minDistance || segmentDistance > maxDistance) {
            continue;
        }

        const continuityPenalty =
            targetDistance === undefined ? 0 : Math.abs(segmentDistance - targetDistance) * continuityWeight;
        const score = lateralError + continuityPenalty;

        if (score < bestScore) {
            bestScore = score;
            best = {
                distance: segmentDistance,
                lateralError,
            };
        }
    }

    return best;
}


