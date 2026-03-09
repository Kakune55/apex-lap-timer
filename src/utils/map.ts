import { TrackPoint } from '../types';

export type MapViewMode = 'dt-absolute' | 'dt-trend' | 'speed-heatmap';

export interface ColoredSegment {
    points: [number, number][];
    color: string;
}

export function getColoredSegments(
    points: TrackPoint[], 
    mode: MapViewMode,
    maxSpeed: number = 100
): ColoredSegment[] {
    if (points.length < 2) return [];

    const segments: ColoredSegment[] = [];
    let currentSegment: ColoredSegment = {
        points: [[points[0].lat, points[0].lon]],
        color: getColorForPoint(points[0], points[0], mode, maxSpeed)
    };

    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const color = getColorForPoint(curr, prev, mode, maxSpeed);

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
    maxSpeed: number
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
            // Fast = Green, Slow = Red
            if (curr.speed === undefined) return GRAY;
            // Simple linear interpolation between red and green
            // 0 km/h -> Red, maxSpeed -> Green
            const speed = curr.speed * 3.6; // Convert to km/h
            const ratio = Math.min(speed / maxSpeed, 1);
            // In Tailwind/CSS we can't easily interpolate variables, so we use fixed colors or a gradient
            // For simplicity, let's use a few steps or a hex interpolation
            return interpolateColor('#FF4444', '#00FF00', ratio);

        default:
            return GRAY;
    }
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


