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
export type GPSErrorKey =
    | 'unsupported'
    | 'secureContextRequired'
    | 'permissionDenied'
    | 'positionUnavailable'
    | 'timeout'
    | 'requestSlow'
    | 'permissionDialogPending'
    | 'permissionPromptNoResponse'
    | 'unknown';

let globalError: GPSErrorKey | null = null;
let simSpeedKmh = 72; // Default 72 km/h
const listeners = new Set<() => void>();
const GPS_RATE_MIN = 0.2;
const GPS_RATE_MAX = 2;
const GPS_RATE_STORAGE_KEY = 'apex_gps_refresh_hz';
type GPSPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported' | 'secureContextRequired';

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
let realGPSWatchdogTimeout: number | null = null;
let permissionRequestTimeout: number | null = null;
let isPermissionRequestInFlight = false;
let gpsPermissionState: GPSPermissionState = 'unknown';
let permissionStatusHandle: PermissionStatus | null = null;
const FIRST_FIX_WATCHDOG_MS = 12000;
const PERMISSION_REQUEST_WATCHDOG_MS = 10000;

const clearRealGPSWatchdog = () => {
    if (realGPSWatchdogTimeout !== null) {
        clearTimeout(realGPSWatchdogTimeout);
        realGPSWatchdogTimeout = null;
    }
};

const clearPermissionRequestWatchdog = () => {
    if (permissionRequestTimeout !== null) {
        clearTimeout(permissionRequestTimeout);
        permissionRequestTimeout = null;
    }
};

const hasSecureLocationContext = () => {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return window.isSecureContext || isLocalhost;
};

const getGeoErrorMessage = (err: GeolocationPositionError): GPSErrorKey => {
    if (err.code === err.PERMISSION_DENIED) {
        return 'permissionDenied';
    }
    if (err.code === err.POSITION_UNAVAILABLE) {
        return 'positionUnavailable';
    }
    if (err.code === err.TIMEOUT) {
        return 'timeout';
    }
    return 'unknown';
};

const updatePermissionState = (next: GPSPermissionState) => {
    if (gpsPermissionState === next) {
        return;
    }
    gpsPermissionState = next;
    notify();
};

const refreshGPSPermissionState = async () => {
    if (!('geolocation' in navigator)) {
        updatePermissionState('unsupported');
        return 'unsupported';
    }
    if (!hasSecureLocationContext()) {
        updatePermissionState('secureContextRequired');
        return 'secureContextRequired';
    }
    if (!('permissions' in navigator) || typeof navigator.permissions.query !== 'function') {
        updatePermissionState('unknown');
        return 'unknown';
    }

    try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        if (permissionStatusHandle !== status) {
            if (permissionStatusHandle) {
                permissionStatusHandle.onchange = null;
            }
            permissionStatusHandle = status;
            permissionStatusHandle.onchange = () => {
                updatePermissionState(permissionStatusHandle?.state as GPSPermissionState ?? 'unknown');
                if (permissionStatusHandle?.state === 'granted' && !isSimulating) {
                    startRealGPS(true);
                }
            };
        }
        updatePermissionState(status.state as GPSPermissionState);
        return status.state as GPSPermissionState;
    } catch {
        updatePermissionState('unknown');
        return 'unknown';
    }
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
    clearRealGPSWatchdog();
    lastRealGPSUpdateAt = 0;
};

const startRealGPS = (skipPermissionGate = false) => {
    if (isSimulating) return;
    if (!('geolocation' in navigator)) {
        updatePermissionState('unsupported');
        globalError = 'unsupported';
        notify();
        return;
    }
    if (!hasSecureLocationContext()) {
        updatePermissionState('secureContextRequired');
        globalError = 'secureContextRequired';
        notify();
        return;
    }
    if (!skipPermissionGate && gpsPermissionState !== 'granted') {
        return;
    }
    if (watchId !== null) return;

    clearRealGPSWatchdog();
    realGPSWatchdogTimeout = window.setTimeout(() => {
        if (lastRealGPSUpdateAt === 0 && watchId !== null && !isPermissionRequestInFlight) {
            globalError = 'requestSlow';
            notify();
        }
    }, FIRST_FIX_WATCHDOG_MS);

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const minUpdateIntervalMs = 1000 / gpsRefreshRateHz;
            if (lastRealGPSUpdateAt > 0 && position.timestamp - lastRealGPSUpdateAt < minUpdateIntervalMs) {
                return;
            }

            clearRealGPSWatchdog();

            globalData = {
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                speed: position.coords.speed || 0,
                heading: position.coords.heading || 0,
                accuracy: position.coords.accuracy,
                timestamp: position.timestamp,
            };
            lastRealGPSUpdateAt = position.timestamp;
            updatePermissionState('granted');
            globalError = null;
            notify();
        },
        (err) => {
            clearRealGPSWatchdog();
            if (err.code === err.PERMISSION_DENIED) {
                updatePermissionState('denied');
            }
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
        updatePermissionState('unsupported');
        globalError = 'unsupported';
        notify();
        return;
    }
    if (!hasSecureLocationContext()) {
        updatePermissionState('secureContextRequired');
        globalError = 'secureContextRequired';
        notify();
        return;
    }

    if (isPermissionRequestInFlight) {
        globalError = 'permissionDialogPending';
        notify();
        return;
    }

    isPermissionRequestInFlight = true;
    globalError = null;
    notify();

    clearPermissionRequestWatchdog();
    permissionRequestTimeout = window.setTimeout(() => {
        if (!isPermissionRequestInFlight) {
            return;
        }
        isPermissionRequestInFlight = false;
        globalError = 'permissionPromptNoResponse';
        notify();
    }, PERMISSION_REQUEST_WATCHDOG_MS);

    navigator.geolocation.getCurrentPosition(
        (position) => {
            isPermissionRequestInFlight = false;
            clearPermissionRequestWatchdog();
            updatePermissionState('granted');
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
            isPermissionRequestInFlight = false;
            clearPermissionRequestWatchdog();
            if (err.code === err.PERMISSION_DENIED) {
                updatePermissionState('denied');
            }
            globalError = getGeoErrorMessage(err);
            notify();
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 12000,
        },
    );
};

export const retryGPS = () => {
    isPermissionRequestInFlight = false;
    clearPermissionRequestWatchdog();
    stopRealGPS();
    if (gpsPermissionState === 'granted') {
        startRealGPS(true);
    } else {
        requestGPSPermission();
        return;
    }
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
        requestingPermission: isPermissionRequestInFlight,
        permissionState: gpsPermissionState,
    });

    useEffect(() => {
        const handleUpdate = () => {
            setState({
                data: globalData,
                error: globalError,
                simMode: isSimulating,
                simSpeed: simSpeedKmh,
                gpsRefreshRateHz,
                requestingPermission: isPermissionRequestInFlight,
                permissionState: gpsPermissionState,
            });
        };
        listeners.add(handleUpdate);

        void refreshGPSPermissionState().then((permissionState) => {
            if (!isSimulating && watchId === null && permissionState === 'granted') {
                startRealGPS(true);
            }
        });

        const handleVisibilityOrFocus = () => {
            if (document.visibilityState !== 'visible') {
                return;
            }
            void refreshGPSPermissionState().then((permissionState) => {
                if (!isSimulating && watchId === null && permissionState === 'granted') {
                    startRealGPS(true);
                }
            });
        };

        document.addEventListener('visibilitychange', handleVisibilityOrFocus);
        window.addEventListener('focus', handleVisibilityOrFocus);

        return () => {
            listeners.delete(handleUpdate);
            document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
            window.removeEventListener('focus', handleVisibilityOrFocus);
        };
    }, []);

    return {
        data: state.data,
        error: state.error,
        simMode: state.simMode,
        simSpeed: state.simSpeed,
        gpsRefreshRateHz: state.gpsRefreshRateHz,
        requestingPermission: state.requestingPermission,
        permissionState: state.permissionState,
        requestPermission: requestGPSPermission,
        retryGPS,
        toggleSimulation,
        setSimulationSpeed,
        setGPSRefreshRateHz,
    };
}
