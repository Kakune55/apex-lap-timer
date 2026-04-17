import { useState, useEffect, useRef } from 'react';
import { useGPS } from '../hooks/useGPS';
import { useViewportMetrics } from '../hooks/useViewportMetrics';
import { Track, TrackPoint, Gate, Lap } from '../types';
import { getDistance, formatTime, estimateGateCrossingTime, getTimeInterpolationRatio } from '../utils/geo';
import { MapPin, StopCircle, Flag } from 'lucide-react';
import { TrackMap } from './TrackMap';
import { useI18n } from '../i18n';

interface Props {
    onSave: (track: Track) => void;
    onCancel: () => void;
}

export function RecordTrack({ onSave, onCancel }: Props) {
    const { data: gps, error: gpsError, requestingPermission, requestPermission, retryGPS } = useGPS();
    const { mapOffsetY, isShort } = useViewportMetrics();
    const { t } = useI18n();
    const [step, setStep] = useState<'setup' | 'waiting_speed' | 'recording' | 'finished'>('setup');
    const [trackType, setTrackType] = useState<'circuit' | 'sprint'>('circuit');
    const [trackName, setTrackName] = useState('');

    const [points, setPoints] = useState<TrackPoint[]>([]);
    const [startGate, setStartGate] = useState<Gate | null>(null);
    const [startTime, setStartTime] = useState<number>(0);
    const [totalDistance, setTotalDistance] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [displaySpeedKmh, setDisplaySpeedKmh] = useState(0);

    const prevGpsRef = useRef(gps);

    const targetSpeedKmh = (gps?.speed || 0) * 3.6;

    useEffect(() => {
        let frameId = 0;
        const from = displaySpeedKmh;
        const to = targetSpeedKmh;
        const durationMs = 220;
        const startedAt = performance.now();

        const animate = (now: number) => {
            const t = Math.min(1, (now - startedAt) / durationMs);
            // Ease-out to keep speed digits lively but readable.
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplaySpeedKmh(from + (to - from) * eased);
            if (t < 1) {
                frameId = requestAnimationFrame(animate);
            }
        };

        frameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frameId);
    }, [targetSpeedKmh]);

    useEffect(() => {
        if (step !== 'recording') {
            setElapsedMs(0);
            return;
        }

        let frameId = 0;
        const tick = () => {
            setElapsedMs(Math.max(0, Date.now() - startTime));
            frameId = requestAnimationFrame(tick);
        };

        frameId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameId);
    }, [step, startTime]);

    useEffect(() => {
        if (!gps) return;

        if (step === 'waiting_speed') {
            // Need some speed to get a reliable heading for the start gate
            // 3 m/s is roughly 10.8 km/h
            if (gps.speed > 3) {
                setStartGate({
                    lat: gps.lat,
                    lon: gps.lon,
                    heading: gps.heading,
                    width: 30 // 30 meters wide gate
                });
                setStartTime(gps.timestamp);
                setPoints([{
                    lat: gps.lat,
                    lon: gps.lon,
                    timeOffset: 0,
                    distance: 0,
                    speed: gps.speed,
                }]);
                setStep('recording');
            }
        } else if (step === 'recording') {
            if (prevGpsRef.current) {
                const dist = getDistance(prevGpsRef.current.lat, prevGpsRef.current.lon, gps.lat, gps.lon);
                // Only record point if we moved a bit (e.g., 2 meters) to avoid noise
                if (dist > 2) {
                    const newTotalDist = totalDistance + dist;
                    setTotalDistance(newTotalDist);
                    setPoints(prev => [...prev, {
                        lat: gps.lat,
                        lon: gps.lon,
                        timeOffset: gps.timestamp - startTime,
                        distance: newTotalDist,
                        speed: gps.speed,
                    }]);
                }
            }
        }
        prevGpsRef.current = gps;
    }, [gps, step, startTime, totalDistance]);

    const handleStart = () => {
        if (!trackName) return;
        setStep('waiting_speed');
    };

    const handleStop = () => {
        if (!startGate || points.length === 0) return;

        let finalPoints = points;
        let finalDistance = totalDistance;
        let finalLapTime = finalPoints[finalPoints.length - 1].timeOffset;

        if (trackType === 'circuit' && points.length > 2) {
            // For circuit recording, cut at the first valid recrossing of start gate
            // so totalDistance reflects one clean lap instead of manual stop distance.
            const minLapDistance = 20;
            const minLapTime = 10000;
            for (let i = 1; i < points.length; i++) {
                const prev = points[i - 1];
                const curr = points[i];

                if (curr.distance < minLapDistance || curr.timeOffset < minLapTime) {
                    continue;
                }

                const crossingTime = estimateGateCrossingTime(
                    prev.lat,
                    prev.lon,
                    prev.timeOffset,
                    curr.lat,
                    curr.lon,
                    curr.timeOffset,
                    startGate,
                );

                if (crossingTime !== null) {
                    const ratio = getTimeInterpolationRatio(prev.timeOffset, curr.timeOffset, crossingTime);
                    const crossingPoint: TrackPoint = {
                        lat: prev.lat + (curr.lat - prev.lat) * ratio,
                        lon: prev.lon + (curr.lon - prev.lon) * ratio,
                        timeOffset: crossingTime,
                        distance: prev.distance + (curr.distance - prev.distance) * ratio,
                        speed: (prev.speed || 0) + ((curr.speed || 0) - (prev.speed || 0)) * ratio,
                    };

                    finalPoints = [...points.slice(0, i), crossingPoint];
                    finalDistance = crossingPoint.distance;
                    finalLapTime = crossingTime;
                    break;
                }
            }
        }

        let finishGate = startGate;
        if (trackType === 'sprint' && gps) {
            finishGate = {
                lat: gps.lat,
                lon: gps.lon,
                heading: gps.heading,
                width: 30
            };
        }

        const initialLapTime = finalLapTime;
        const initialLap: Lap = {
            id: `${Date.now()}-recorded`,
            time: initialLapTime,
            points: finalPoints,
            date: Date.now(),
        };

        const newTrack: Track = {
            id: Date.now().toString(),
            name: trackName,
            type: trackType,
            startGate,
            finishGate,
            points: finalPoints,
            totalDistance: finalDistance,
            bestTime: initialLapTime,
            history: [initialLapTime],
            laps: [initialLap],
            autoUpdateRecord: true
        };
        onSave(newTrack);
    };

    return (
        <div className="relative h-full flex flex-col bg-bg-color text-white overflow-hidden">
            {/* Map Background */}
            <div className="absolute inset-0 z-0">
                <TrackMap currentPos={gps} recordedPoints={points} startGate={startGate} offsetY={mapOffsetY} />
                <div className="absolute inset-0 bg-linear-to-t from-bg-color/60 via-transparent to-transparent z-10 pointer-events-none"></div>
            </div>

            <div className="relative z-20 flex flex-col h-full pt-0">
                <div className="app-shell flex justify-between items-center gap-3 mb-6 sm:mb-8 pt-[calc(var(--safe-top)+0.5rem)]">
                    <h2 className="text-2xl font-bold apex-pill px-4 py-2">{t('recordTrack.title')}</h2>
                    <button onClick={onCancel} className="text-text-secondary hover:text-white font-medium apex-pill px-4 py-2">{t('common.buttons.cancel')}</button>
                </div>

                {step === 'setup' && (
                    <div className="app-shell app-safe-bottom flex-1 flex flex-col justify-end gap-[clamp(1.25rem,3.5dvh,2rem)] pb-[clamp(1rem,4dvh,2rem)]">
                        <div>
                            <label className="block text-xs font-bold text-text-secondary mb-3 uppercase tracking-widest">{t('recordTrack.trackName')}</label>
                            <input
                                type="text"
                                value={trackName}
                                onChange={e => setTrackName(e.target.value)}
                                placeholder={t('recordTrack.trackNamePlaceholder')}
                                className="w-full apex-panel-muted px-5 py-4 text-white focus:outline-none focus:border-white/20 text-lg transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-text-secondary mb-3 uppercase tracking-widest">{t('recordTrack.trackType')}</label>
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => setTrackType('circuit')}
                                    className={`p-5 rounded-2xl border text-center transition-all backdrop-blur-md ${trackType === 'circuit' ? 'bg-accent-green text-black border-accent-green shadow-lg scale-[1.02]' : 'apex-panel-muted text-text-secondary hover:border-white/20'}`}
                                >
                                    <div className="font-bold mb-1 text-lg">{t('track.types.circuit')}</div>
                                    <div className="text-xs opacity-70">{t('track.typeDescriptions.circuit')}</div>
                                </button>
                                <button
                                    onClick={() => setTrackType('sprint')}
                                    className={`p-5 rounded-2xl border text-center transition-all backdrop-blur-md ${trackType === 'sprint' ? 'bg-accent-green text-black border-accent-green shadow-lg scale-[1.02]' : 'apex-panel-muted text-text-secondary hover:border-white/20'}`}
                                >
                                    <div className="font-bold mb-1 text-lg">{t('track.types.sprint')}</div>
                                    <div className="text-xs opacity-70">{t('track.typeDescriptions.sprint')}</div>
                                </button>
                            </div>
                        </div>

                        <div className="pt-4">
                            <button
                                onClick={handleStart}
                                disabled={!trackName || !gps}
                                className="w-full apex-btn-primary py-5 disabled:opacity-50 flex justify-center items-center gap-2 text-lg shadow-xl"
                            >
                                <MapPin size={22} /> {t('recordTrack.setStartGate')}
                            </button>
                            {!gps && (
                                <div className="mt-4 space-y-3">
                                    <p className="text-center text-sm text-accent-red font-medium bg-black/50 py-2 rounded-full backdrop-blur-md">
                                        {t('recordTrack.waitingGpsSignal')}
                                    </p>
                                    {gpsError ? (
                                        <p className="text-xs text-center text-white/80 bg-black/40 px-3 py-2 rounded-xl">
                                            {t(`gps.errors.${gpsError}`)}
                                        </p>
                                    ) : null}
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={requestPermission}
                                            disabled={requestingPermission}
                                            className="bg-accent-green text-black font-bold py-2 rounded-xl text-sm hover:brightness-110 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {requestingPermission ? t('recordTrack.requesting') : t('recordTrack.enableGps')}
                                        </button>
                                        <button
                                            onClick={retryGPS}
                                            className="bg-white/10 text-white font-bold py-2 rounded-xl text-sm hover:bg-white/20 transition-colors"
                                        >
                                            {t('recordTrack.retryGps')}
                                        </button>
                                    </div>
                                    {requestingPermission ? (
                                        <p className="text-xs text-center text-white/70">
                                            {t('recordTrack.waitingAndroidPermission')}
                                        </p>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {step === 'waiting_speed' && (
                    <div className="app-shell app-safe-bottom flex-1 flex flex-col items-center justify-end pb-[clamp(1.5rem,6dvh,3rem)] text-center">
                        <div className="w-24 h-24 rounded-full border-4 border-dashed border-text-secondary animate-[spin_3s_linear_infinite] mb-8 bg-black/10 backdrop-blur-sm"></div>
                        <h3 className="text-2xl font-bold mb-3 drop-shadow-lg">{t('recordTrack.waitingSpeedTitle')}</h3>
                        <p className="text-text-secondary max-w-62.5 drop-shadow-md">{t('recordTrack.waitingSpeedDescription')}</p>
                        <div className="mt-8 app-recording-number font-sans tabular-nums font-bold drop-shadow-xl bg-black/20 px-6 py-4 rounded-3xl backdrop-blur-md">
                            {displaySpeedKmh.toFixed(1)} <span className="text-lg text-text-secondary font-sans">{t('common.units.kmh')}</span>
                        </div>
                        {!gps && (
                            <button
                                onClick={requestPermission}
                                disabled={requestingPermission}
                                className="mt-4 bg-accent-green text-black font-bold py-2.5 px-4 rounded-xl text-sm hover:brightness-110 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {requestingPermission ? t('recordTrack.requestingPermission') : t('recordTrack.enableGpsPermission')}
                            </button>
                        )}
                    </div>
                )}

                {step === 'recording' && (
                    <div className="app-shell app-safe-bottom flex-1 flex flex-col justify-end">
                        <div className={`flex-1 flex flex-col items-center justify-center ${isShort ? 'mt-4' : 'mt-[clamp(1rem,6dvh,5rem)]'}`}>
                            <div className="bg-black/20 backdrop-blur-md px-6 sm:px-8 py-4 sm:py-6 rounded-3xl sm:rounded-4xl border border-white/10 flex flex-col items-center shadow-2xl">
                                <div className="text-accent-red animate-pulse mb-2 sm:mb-4 flex items-center gap-2 font-bold tracking-widest uppercase text-xs sm:text-sm">
                                    <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-accent-red"></div> {t('recordTrack.recording')}
                                </div>
                                <div className="app-recording-number font-bold font-sans tabular-nums mb-1 sm:mb-2 tracking-tighter">
                                    {formatTime(elapsedMs)}
                                </div>
                                <div className="text-2xl sm:text-3xl text-white font-sans tabular-nums font-bold tracking-tight mb-1">
                                    {displaySpeedKmh.toFixed(1)} <span className="text-base sm:text-lg text-text-secondary font-medium">{t('common.units.kmh')}</span>
                                </div>
                                <div className="text-base sm:text-lg text-text-secondary font-sans tabular-nums font-medium">
                                    {(totalDistance / 1000).toFixed(2)} {t('common.units.km')}
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleStop}
                            className="w-full apex-btn-primary py-4 sm:py-5 rounded-2xl flex justify-center items-center gap-2 text-base sm:text-lg shadow-xl mt-4 sm:mt-8"
                        >
                            {trackType === 'circuit' ? <StopCircle size={20} /> : <Flag size={20} />}
                            {trackType === 'circuit' ? t('recordTrack.stopAndSaveLap') : t('recordTrack.setFinishLine')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
