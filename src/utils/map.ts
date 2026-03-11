import { TrackPoint } from '../types';
import { getDistance } from './geo';

export type MapViewMode = 'dt-absolute' | 'dt-trend' | 'speed-heatmap';

export const MAP_VIEW_MODES: MapViewMode[] = ['dt-absolute', 'dt-trend', 'speed-heatmap'];

export function getNextMapViewMode(currentMode: MapViewMode): MapViewMode {
    const nextIndex = (MAP_VIEW_MODES.indexOf(currentMode) + 1) % MAP_VIEW_MODES.length;
    return MAP_VIEW_MODES[nextIndex];
}

export interface ColoredSegment {
    points: [number, number][];
    color: string;
}

interface SpeedColorScale {
    minKmh: number;
    maxKmh: number;
}

export function getColoredSegments(
    points: TrackPoint[], 
    mode: MapViewMode,
    maxSpeed: number = 100
): ColoredSegment[] {
    if (points.length < 2) return [];

    const speedSeries = mode === 'speed-heatmap' ? points.map((point, i) => getPointSpeedKmh(point, points[Math.max(0, i - 1)])) : null;
    const speedScale = mode === 'speed-heatmap' ? buildSpeedColorScale(speedSeries || [], maxSpeed) : null;

    const segments: ColoredSegment[] = [];
    let currentSegment: ColoredSegment = {
        points: [[points[0].lat, points[0].lon]],
        color: getColorForPoint(points[0], points[0], mode, maxSpeed, speedScale, speedSeries, 0)
    };

    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const color = getColorForPoint(curr, prev, mode, maxSpeed, speedScale, speedSeries, i);

        if (color === currentSegment.color) {
            currentSegment.points.push([curr.lat, curr.lon]);
        } else {
            // End current segment and start new one
            // We add the current point to the previous segment to ensure continuity
            currentSegment.points.push([curr.lat, curr.lon]);
            segments.push(currentSegment);
            currentSegment = {
                points: [[curr.lat, curr.lon]],
                color: color
            };
        }
    }
    segments.push(currentSegment);
    return segments;
}

function getColorForPoint(
    curr: TrackPoint, 
    prev: TrackPoint, 
    mode: MapViewMode,
    maxSpeed: number,
    speedScale: SpeedColorScale | null,
    speedSeries: Array<number | null> | null,
    pointIndex: number,
): string {
    const GREEN = 'var(--accent-green)';
    const RED = 'var(--accent-red)';
    const GRAY = 'rgba(255, 255, 255, 0.3)';

    switch (mode) {
        case 'dt-absolute':
            // Faster than reference (negative delta) is green; slower is red.
            if (curr.delta === undefined) return GRAY;
            return curr.delta < 0 ? GREEN : RED;

        case 'dt-trend':
            // Dt shrinking (improving) = Green, Dt growing (losing time) = Red
            if (curr.delta === undefined || prev.delta === undefined) return GRAY;
            // Improving means delta is decreasing (getting more negative or less positive)
            return curr.delta <= prev.delta ? GREEN : RED;

        case 'speed-heatmap':
            // Adaptive multi-stop gradient: slow -> fast
            const speed = getSegmentSpeedKmh(curr, prev, speedSeries, pointIndex);
            if (speed === null) return GRAY;
            const scale = speedScale ?? { minKmh: 0, maxKmh: maxSpeed };
            const span = Math.max(1, scale.maxKmh - scale.minKmh);
            const ratio = clamp01((speed - scale.minKmh) / span);
            return turboGradient(ratio);

        default:
            return GRAY;
    }
}

function getPointSpeedKmh(curr: TrackPoint, prev: TrackPoint): number | null {
    if (curr.speed !== undefined && Number.isFinite(curr.speed) && curr.speed >= 0) {
        return curr.speed * 3.6;
    }

    const dtMs = curr.timeOffset - prev.timeOffset;
    if (dtMs <= 0) {
        return null;
    }

    const distMeters = getDistance(prev.lat, prev.lon, curr.lat, curr.lon);
    if (!Number.isFinite(distMeters) || distMeters < 0) {
        return null;
    }

    // Fallback speed estimate from geometry when GPS speed is missing.
    const speedMs = distMeters / (dtMs / 1000);
    if (!Number.isFinite(speedMs) || speedMs < 0) {
        return null;
    }

    return speedMs * 3.6;
}

function clamp01(value: number): number {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function buildSpeedColorScale(speedSeries: Array<number | null>, fallbackMaxKmh: number): SpeedColorScale {
    const speeds = speedSeries
        .filter((speed): speed is number => speed !== null && Number.isFinite(speed) && speed >= 0)
        .sort((a, b) => a - b);

    if (speeds.length < 3) {
        return { minKmh: 0, maxKmh: fallbackMaxKmh };
    }

    // Use wider robust bounds plus headroom to avoid long "flat pure color" segments.
    const pLow = percentile(speeds, 0.02);
    const pHigh = percentile(speeds, 0.98);
    const range = Math.max(5, pHigh - pLow);
    const pad = range * 0.12;
    const minKmh = Math.max(0, pLow - pad);
    const maxKmh = Math.max(minKmh + 5, pHigh + pad);
    return { minKmh, maxKmh };
}

function getSegmentSpeedKmh(
    curr: TrackPoint,
    prev: TrackPoint,
    speedSeries: Array<number | null> | null,
    pointIndex: number,
): number | null {
    if (!speedSeries) {
        return getPointSpeedKmh(curr, prev);
    }

    const currSpeed = speedSeries[pointIndex] ?? getPointSpeedKmh(curr, prev);
    const prevSpeed = speedSeries[pointIndex - 1] ?? getPointSpeedKmh(prev, prev);
    if (currSpeed !== null && prevSpeed !== null) {
        return (currSpeed + prevSpeed) / 2;
    }
    return currSpeed ?? prevSpeed;
}

function percentile(sortedValues: number[], q: number): number {
    if (sortedValues.length === 0) {
        return 0;
    }

    const clampedQ = clamp01(q);
    const idx = (sortedValues.length - 1) * clampedQ;
    const lo = Math.floor(idx);
    const hi = Math.min(sortedValues.length - 1, Math.ceil(idx));
    if (lo === hi) {
        return sortedValues[lo];
    }

    const t = idx - lo;
    return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * t;
}

function turboGradient(t: number): string {
    const stops = [
        { t: 0.0, color: '#1d4ed8' },
        { t: 0.2, color: '#06b6d4' },
        { t: 0.4, color: '#10b981' },
        { t: 0.6, color: '#facc15' },
        { t: 0.8, color: '#f97316' },
        { t: 1.0, color: '#ef4444' },
    ];

    for (let i = 1; i < stops.length; i++) {
        const left = stops[i - 1];
        const right = stops[i];
        if (t <= right.t) {
            const localT = (t - left.t) / Math.max(1e-6, right.t - left.t);
            return interpolateColor(left.color, right.color, localT);
        }
    }

    return stops[stops.length - 1].color;
}

function interpolateColor(color1: string, color2: string, factor: number): string {
    const r1 = parseInt(color1.substring(1, 3), 16);
    const g1 = parseInt(color1.substring(3, 5), 16);
    const b1 = parseInt(color1.substring(5, 7), 16);

    const r2 = parseInt(color2.substring(1, 3), 16);
    const g2 = parseInt(color2.substring(3, 5), 16);
    const b2 = parseInt(color2.substring(5, 7), 16);

    const r = Math.round(r1 + factor * (r2 - r1));
    const g = Math.round(g1 + factor * (g2 - g1));
    const b = Math.round(b1 + factor * (b2 - b1));

    return `rgb(${r}, ${g}, ${b})`;
}


