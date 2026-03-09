import { useState, useEffect, useRef } from 'react';
import { useGPS } from '../hooks/useGPS';
import { Track, TrackPoint, Gate } from '../types';
import { getDistance, formatTime } from '../utils/geo';
import { MapPin, StopCircle, Flag } from 'lucide-react';
import { TrackMap } from './TrackMap';

interface Props {
    onSave: (track: Track) => void;
    onCancel: () => void;
}

export function RecordTrack({ onSave, onCancel }: Props) {
    const { data: gps, error: gpsError, requestPermission, retryGPS } = useGPS();
    const [step, setStep] = useState<'setup' | 'waiting_speed' | 'recording' | 'finished'>('setup');
    const [trackType, setTrackType] = useState<'circuit' | 'sprint'>('circuit');
    const [trackName, setTrackName] = useState('');

    const [points, setPoints] = useState<TrackPoint[]>([]);
    const [startGate, setStartGate] = useState<Gate | null>(null);
    const [startTime, setStartTime] = useState<number>(0);
    const [totalDistance, setTotalDistance] = useState(0);

    const prevGpsRef = useRef(gps);

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
                    distance: 0
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
                        distance: newTotalDist
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

        let finishGate = startGate;
        if (trackType === 'sprint' && gps) {
            finishGate = {
                lat: gps.lat,
                lon: gps.lon,
                heading: gps.heading,
                width: 30
            };
        }

        const newTrack: Track = {
            id: Date.now().toString(),
            name: trackName,
            type: trackType,
            startGate,
            finishGate,
            points,
            totalDistance,
            bestTime: points[points.length - 1].timeOffset,
            history: [points[points.length - 1].timeOffset],
            autoUpdateRecord: true
        };
        onSave(newTrack);
    };

    return (
        <div className="relative h-full flex flex-col bg-bg-color text-white overflow-hidden">
            {/* Map Background */}
            <div className="absolute inset-0 z-0">
                <TrackMap currentPos={gps} recordedPoints={points} startGate={startGate} offsetY={150} />
                <div className="absolute inset-0 bg-linear-to-t from-bg-color/60 via-transparent to-transparent z-10 pointer-events-none"></div>
            </div>

            <div className="relative z-20 flex flex-col h-full px-6 pb-6 pt-0 max-w-md mx-auto w-full">
                <div className="flex justify-between items-center mb-8 pt-[calc(var(--safe-top)+0.5rem)]">
                    <h2 className="text-2xl font-bold apex-pill px-4 py-2">Record Track</h2>
                    <button onClick={onCancel} className="text-text-secondary hover:text-white font-medium apex-pill px-4 py-2">Cancel</button>
                </div>

                {step === 'setup' && (
                    <div className="space-y-8 flex-1 flex flex-col justify-end pb-8">
                        <div>
                            <label className="block text-xs font-bold text-text-secondary mb-3 uppercase tracking-widest">Track Name</label>
                            <input
                                type="text"
                                value={trackName}
                                onChange={e => setTrackName(e.target.value)}
                                placeholder="e.g. Nurburgring Nordschleife"
                                className="w-full apex-panel-muted px-5 py-4 text-white focus:outline-none focus:border-white/20 text-lg transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-text-secondary mb-3 uppercase tracking-widest">Track Type</label>
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => setTrackType('circuit')}
                                    className={`p-5 rounded-2xl border text-center transition-all backdrop-blur-md ${trackType === 'circuit' ? 'bg-accent-green text-black border-accent-green shadow-lg scale-[1.02]' : 'apex-panel-muted text-text-secondary hover:border-white/20'}`}
                                >
                                    <div className="font-bold mb-1 text-lg">Circuit</div>
                                    <div className="text-xs opacity-70">Loop track</div>
                                </button>
                                <button
                                    onClick={() => setTrackType('sprint')}
                                    className={`p-5 rounded-2xl border text-center transition-all backdrop-blur-md ${trackType === 'sprint' ? 'bg-accent-green text-black border-accent-green shadow-lg scale-[1.02]' : 'apex-panel-muted text-text-secondary hover:border-white/20'}`}
                                >
                                    <div className="font-bold mb-1 text-lg">Sprint</div>
                                    <div className="text-xs opacity-70">Point to point</div>
                                </button>
                            </div>
                        </div>

                        <div className="pt-4">
                            <button
                                onClick={handleStart}
                                disabled={!trackName || !gps}
                                className="w-full apex-btn-primary py-5 disabled:opacity-50 flex justify-center items-center gap-2 text-lg shadow-xl"
                            >
                                <MapPin size={22} /> Set Start Gate
                            </button>
                            {!gps && (
                                <div className="mt-4 space-y-3">
                                    <p className="text-center text-sm text-accent-red font-medium bg-black/50 py-2 rounded-full backdrop-blur-md">
                                        Waiting for GPS signal...
                                    </p>
                                    {gpsError ? (
                                        <p className="text-xs text-center text-white/80 bg-black/40 px-3 py-2 rounded-xl">
                                            {gpsError}
                                        </p>
                                    ) : null}
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={requestPermission}
                                            className="bg-accent-green text-black font-bold py-2 rounded-xl text-sm hover:brightness-110 transition-colors"
                                        >
                                            Enable GPS
                                        </button>
                                        <button
                                            onClick={retryGPS}
                                            className="bg-white/10 text-white font-bold py-2 rounded-xl text-sm hover:bg-white/20 transition-colors"
                                        >
                                            Retry GPS
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {step === 'waiting_speed' && (
                    <div className="flex-1 flex flex-col items-center justify-end pb-12 text-center">
                        <div className="w-24 h-24 rounded-full border-4 border-dashed border-text-secondary animate-[spin_3s_linear_infinite] mb-8 bg-black/10 backdrop-blur-sm"></div>
                        <h3 className="text-2xl font-bold mb-3 drop-shadow-lg">Drive to Set Start</h3>
                        <p className="text-text-secondary max-w-62.5 drop-shadow-md">Accelerate past 10km/h to automatically set the start line heading.</p>
                        <div className="mt-8 text-5xl font-sans tabular-nums font-bold drop-shadow-xl bg-black/20 px-6 py-4 rounded-3xl backdrop-blur-md">
                            {Math.round((gps?.speed || 0) * 3.6)} <span className="text-lg text-text-secondary font-sans">km/h</span>
                        </div>
                        {!gps && (
                            <button
                                onClick={requestPermission}
                                className="mt-4 bg-accent-green text-black font-bold py-2.5 px-4 rounded-xl text-sm hover:brightness-110 transition-colors"
                            >
                                Enable GPS Permission
                            </button>
                        )}
                    </div>
                )}

                {step === 'recording' && (
                    <div className="flex-1 flex flex-col justify-end pb-4 sm:pb-8">
                        <div className="flex-1 flex flex-col items-center justify-center mt-10 sm:mt-20">
                            <div className="bg-black/20 backdrop-blur-md px-6 sm:px-8 py-4 sm:py-6 rounded-3xl sm:rounded-4xl border border-white/10 flex flex-col items-center shadow-2xl">
                                <div className="text-accent-red animate-pulse mb-2 sm:mb-4 flex items-center gap-2 font-bold tracking-widest uppercase text-xs sm:text-sm">
                                    <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-accent-red"></div> Recording
                                </div>
                                <div className="text-5xl sm:text-6xl font-bold font-sans tabular-nums mb-1 sm:mb-2 tracking-tighter">
                                    {formatTime(gps ? gps.timestamp - startTime : 0)}
                                </div>
                                <div className="text-lg sm:text-xl text-text-secondary font-sans tabular-nums font-medium">
                                    {(totalDistance / 1000).toFixed(2)} km
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleStop}
                            className="w-full apex-btn-primary py-4 sm:py-5 rounded-2xl flex justify-center items-center gap-2 text-base sm:text-lg shadow-xl mt-4 sm:mt-8"
                        >
                            {trackType === 'circuit' ? <StopCircle size={20} /> : <Flag size={20} />}
                            {trackType === 'circuit' ? 'Stop & Save Lap' : 'Set Finish Line'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

