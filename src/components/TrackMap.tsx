import { useEffect, Fragment } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { TrackPoint, Track, Gate } from '../types';
import { getColoredSegments, MapViewMode } from '../utils/map';

// Fix for default marker icons in React Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const carIcon = new L.DivIcon({
    className: 'car-marker',
    html: `<div style="width: 16px; height: 16px; background: var(--accent-red); border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(255,51,51,0.8);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

function MapUpdater({ center, offsetY = 0 }: { center: [number, number], offsetY?: number }) {
    const map = useMap();
    useEffect(() => {
        if (offsetY === 0) {
            map.setView(center, map.getZoom(), { animate: true });
        } else {
            // Add offsetY to move the camera down, which moves the car UP on the screen
            const targetPoint = map.project(center, map.getZoom()).add([0, offsetY]);
            const targetLatLng = map.unproject(targetPoint, map.getZoom());
            map.setView(targetLatLng, map.getZoom(), { animate: true });
        }
    }, [center, map, offsetY]);
    return null;
}

interface Props {
    currentPos: { lat: number, lon: number } | null;
    recordedPoints?: TrackPoint[];
    referenceTrack?: Track | null;
    startGate?: Gate | null;
    offsetY?: number;
    mode?: MapViewMode;
}

export function TrackMap({ 
    currentPos, 
    recordedPoints = [], 
    referenceTrack = null, 
    startGate = null, 
    offsetY = 0,
    mode = 'dt-absolute'
}: Props) {
    const defaultCenter: [number, number] = [31.2304, 121.4737];
    const center: [number, number] = currentPos ? [currentPos.lat, currentPos.lon] : defaultCenter;

    const referencePositions: [number, number][] = referenceTrack ? referenceTrack.points.map(p => [p.lat, p.lon]) : [];

    // Group recorded points into segments by color based on mode
    const segments = getColoredSegments(recordedPoints, mode);

    const renderGate = (gate: Gate, color: string) => {
        const R = 6371000;
        // Convert heading to radians and calculate offsets
        // Heading is in degrees clockwise from North
        const rad = (gate.heading + 90) * Math.PI / 180;
        const dLat = (Math.cos(rad) * (gate.width / 2)) / R * (180 / Math.PI);
        const dLon = (Math.sin(rad) * (gate.width / 2)) / (R * Math.cos(gate.lat * Math.PI / 180)) * (180 / Math.PI);

        const p1: [number, number] = [gate.lat + dLat, gate.lon + dLon];
        const p2: [number, number] = [gate.lat - dLat, gate.lon - dLon];

        return <Polyline positions={[p1, p2]} color={color} weight={6} dashArray="10, 10" />;
    };

    return (
        <MapContainer center={center} zoom={18} style={{ height: '100%', width: '100%', zIndex: 10, background: '#f5f5f5' }} zoomControl={false} attributionControl={false}>
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
            {currentPos && <MapUpdater center={center} offsetY={offsetY} />}

            {/* Reference Track */}
            {referencePositions.length > 0 && (
                <Polyline positions={referencePositions} color="#000000" weight={10} opacity={0.3} />
            )}

            {/* Recorded Track */}
            {segments.map((segment, idx) => (
                <Polyline key={idx} positions={segment.points} color={segment.color} weight={6} />
            ))}

            {/* Gates */}
            {startGate && renderGate(startGate, 'var(--accent-green)')}
            {referenceTrack?.startGate && renderGate(referenceTrack.startGate, 'var(--accent-green)')}
            {referenceTrack?.finishGate && renderGate(referenceTrack.finishGate, 'var(--accent-red)')}
            {referenceTrack?.sectors?.map((sector, idx) => (
                <Fragment key={`sector-${idx}`}>
                    {renderGate(sector, '#EAB308')}
                </Fragment>
            ))}

            {/* Current Position */}
            {currentPos && (
                <Marker position={center} icon={carIcon} />
            )}
        </MapContainer>
    );
}
