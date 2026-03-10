import { useState, useEffect } from 'react';

export interface GPSData {
    lat: number;
    lon: number;
    speed: number; // m/s
    heading: number;
    accuracy: number;
    timestamp: number;
}

// --- Singleton State ---
let isSimulating = false;
let globalData: GPSData | null = null;
let globalError: string | null = null;
let simSpeedKmh = 72; // Default 72 km/h
const listeners = new Set<() => void>();
const GPS_RATE_MIN = 0.2;
const GPS_RATE_MAX = 2;
const GPS_RATE_STORAGE_KEY = 'apex_gps_refresh_hz';

const clampGPSRate = (value: number) => Math.max(GPS_RATE_MIN, Math.min(GPS_RATE_MAX, value));

const loadInitialGPSRate = () => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = window.localStorage.getItem(GPS_RATE_STORAGE_KEY);
    const parsed = saved ? Number(saved) : NaN;
    if (!Number.isFinite(parsed)) {
        return 1;
    }
    return clampGPSRate(parsed);
};

const notify = () => listeners.forEach(l => l());

let simInterval: number | null = null;
let watchId: number | null = null;
let currentAngle = 0; // Keep track of angle so speed changes don't jump position
let gpsRefreshRateHz = loadInitialGPSRate();
let lastRealGPSUpdateAt = 0;

const hasSecureLocationContext = () => {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return window.isSecureContext || isLocalhost;
};

const getGeoErrorMessage = (err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) {
        return 'Location permission denied. In Safari: Settings > Safari > Location > Allow, then reload.';
    }
    if (err.code === err.POSITION_UNAVAILABLE) {
        return 'GPS position unavailable. Move to open sky and ensure Location Services is enabled.';
    }
    if (err.code === err.TIMEOUT) {
        return 'GPS timeout. Please keep the page active and tap Retry GPS.';
    }
    return err.message || 'Failed to get GPS location.';
};

const startSimulation = () => {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (simInterval !== null) return;

    const centerLat = 31.2304; // Shanghai
    const centerLon = 121.4737;
    const radius = 200; // 200m radius
    let lastTime = Date.now();

    const intervalMs = 1000 / gpsRefreshRateHz;
    simInterval = window.setInterval(() => {
        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;

        const speedMs = simSpeedKmh / 3.6;
        const angularVelocity = speedMs / radius;
        currentAngle += angularVelocity * dt;

        // Convert meters to lat/lon offsets
        const latOffset = (radius * Math.cos(currentAngle)) / 111320;
        const lonOffset = (radius * Math.sin(currentAngle)) / (40075000 * Math.cos(centerLat * Math.PI / 180) / 360);

        // Heading is tangent to the circle
        let heading = (currentAngle * 180 / Math.PI) + 90;
        heading = (heading + 360) % 360;

        globalData = {
            lat: centerLat + latOffset,
            lon: centerLon + lonOffset,
            speed: speedMs,
            heading: heading,
            accuracy: 1,
            timestamp: now
        };
        globalError = null;
        notify();
    }, intervalMs);
};

const stopSimulation = () => {
    if (simInterval !== null) {
        clearInterval(simInterval);
        simInterval = null;
    }
};

const stopRealGPS = () => {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    lastRealGPSUpdateAt = 0;
};

const startRealGPS = () => {
    if (isSimulating) return;
    if (!('geolocation' in navigator)) {
        globalError = 'Geolocation is not supported by your browser';
        notify();
        return;
    }
    if (!hasSecureLocationContext()) {
        globalError = 'Safari requires HTTPS for GPS on mobile devices. Open this app via https:// or localhost.';
        notify();
        return;
    }
    if (watchId !== null) return;

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const minUpdateIntervalMs = 1000 / gpsRefreshRateHz;
            if (lastRealGPSUpdateAt > 0 && position.timestamp - lastRealGPSUpdateAt < minUpdateIntervalMs) {
                return;
            }

            globalData = {
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                speed: position.coords.speed || 0,
                heading: position.coords.heading || 0,
                accuracy: position.coords.accuracy,
                timestamp: position.timestamp,
            };
            lastRealGPSUpdateAt = position.timestamp;
            globalError = null;
            notify();
        },
        (err) => {
            globalError = getGeoErrorMessage(err);
            notify();
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000,
        }
    );
};

export const requestGPSPermission = () => {
    if (!('geolocation' in navigator)) {
        globalError = 'Geolocation is not supported by your browser';
        notify();
        return;
    }
    if (!hasSecureLocationContext()) {
        globalError = 'Safari requires HTTPS for GPS on mobile devices. Open this app via https:// or localhost.';
        notify();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            globalData = {
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                speed: position.coords.speed || 0,
                heading: position.coords.heading || 0,
                accuracy: position.coords.accuracy,
                timestamp: position.timestamp,
            };
            globalError = null;
            stopRealGPS();
            startRealGPS();
            notify();
        },
        (err) => {
            globalError = getGeoErrorMessage(err);
            notify();
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000,
        },
    );
};

export const retryGPS = () => {
    stopRealGPS();
    startRealGPS();
    notify();
};

export const isGPSRefreshRateSupported = () => {
    if (typeof navigator === 'undefined') {
        return false;
    }
    return 'geolocation' in navigator;
};

export const getGPSRefreshRateHz = () => gpsRefreshRateHz;

export const setGPSRefreshRateHz = (hz: number) => {
    gpsRefreshRateHz = clampGPSRate(hz);
    if (typeof window !== 'undefined') {
        window.localStorage.setItem(GPS_RATE_STORAGE_KEY, String(gpsRefreshRateHz));
    }

    // Rebind active source so the new refresh rate is applied immediately.
    if (isSimulating) {
        stopSimulation();
        startSimulation();
    } else {
        stopRealGPS();
        startRealGPS();
    }

    notify();
};

export const toggleSimulation = () => {
    isSimulating = !isSimulating;
    if (isSimulating) {
        startSimulation();
    } else {
        stopSimulation();
        startRealGPS();
    }
    notify();
};

export const setSimulationSpeed = (kmh: number) => {
    simSpeedKmh = Math.max(0, kmh);
    notify();
};

export function useGPS() {
    const [state, setState] = useState({
        data: globalData,
        error: globalError,
        simMode: isSimulating,
        simSpeed: simSpeedKmh,
        gpsRefreshRateHz,
    });

    useEffect(() => {
        const handleUpdate = () => {
            setState({
                data: globalData,
                error: globalError,
                simMode: isSimulating,
                simSpeed: simSpeedKmh,
                gpsRefreshRateHz,
            });
        };
        listeners.add(handleUpdate);

        if (!isSimulating && watchId === null) {
            startRealGPS();
        }

        return () => {
            listeners.delete(handleUpdate);
        };
    }, []);

    return {
        data: state.data,
        error: state.error,
        simMode: state.simMode,
        simSpeed: state.simSpeed,
        gpsRefreshRateHz: state.gpsRefreshRateHz,
        requestPermission: requestGPSPermission,
        retryGPS,
        toggleSimulation,
        setSimulationSpeed,
        setGPSRefreshRateHz,
    };
}


