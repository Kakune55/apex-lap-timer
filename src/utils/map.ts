import { TrackPoint } from '../types';

export type MapViewMode = 'dt-absolute' | 'dt-trend' | 'speed-heatmap';

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

    const speedScale = mode === 'speed-heatmap' ? buildSpeedColorScale(points, maxSpeed) : null;

    const segments: ColoredSegment[] = [];
    let currentSegment: ColoredSegment = {
        points: [[points[0].lat, points[0].lon]],
        color: getColorForPoint(points[0], points[0], mode, maxSpeed, speedScale)
    };

    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const color = getColorForPoint(curr, prev, mode, maxSpeed, speedScale);

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
    speedScale: SpeedColorScale | null
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
            if (curr.speed === undefined) return GRAY;

            const speed = curr.speed * 3.6; // Convert to km/h
            const scale = speedScale ?? { minKmh: 0, maxKmh: maxSpeed };
            const span = Math.max(1, scale.maxKmh - scale.minKmh);
            const ratio = clamp01((speed - scale.minKmh) / span);
            return turboGradient(ratio);

        default:
            return GRAY;
    }
}

function clamp01(value: number): number {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function buildSpeedColorScale(points: TrackPoint[], fallbackMaxKmh: number): SpeedColorScale {
    const speeds = points
        .map((point) => point.speed)
        .filter((speed): speed is number => speed !== undefined && Number.isFinite(speed) && speed >= 0)
        .map((speed) => speed * 3.6)
        .sort((a, b) => a - b);

    if (speeds.length < 3) {
        return { minKmh: 0, maxKmh: fallbackMaxKmh };
    }

    // Use robust percentiles for richer contrast and to avoid single-point outliers.
    const minKmh = percentile(speeds, 0.05);
    const maxKmh = Math.max(minKmh + 5, percentile(speeds, 0.95));
    return { minKmh, maxKmh };
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


