import { TrackPoint } from '../types';

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
