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
    const { data: gps } = useGPS();
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
        <div className="relative h-screen flex flex-col bg-[var(--bg-color)] text-white overflow-hidden">
            {/* Map Background */}
            <div className="absolute inset-0 z-0">
                <TrackMap currentPos={gps} recordedPoints={points} startGate={startGate} offsetY={150} />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-color)]/60 via-transparent to-transparent z-10 pointer-events-none"></div>
            </div>

            <div className="relative z-20 flex flex-col h-full p-6 max-w-md mx-auto w-full">
                <div className="flex justify-between items-center mb-8 pt-4">
                    <h2 className="text-2xl font-bold bg-black/50 px-4 py-2 rounded-full backdrop-blur-md">Record Track</h2>
                    <button onClick={onCancel} className="text-[var(--text-secondary)] hover:text-white font-medium bg-black/50 px-4 py-2 rounded-full backdrop-blur-md">Cancel</button>
                </div>

                {step === 'setup' && (
                    <div className="space-y-8 flex-1 flex flex-col justify-end pb-8">
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-3 uppercase tracking-widest">Track Name</label>
                            <input
                                type="text"
                                value={trackName}
                                onChange={e => setTrackName(e.target.value)}
                                placeholder="e.g. Nurburgring Nordschleife"
                                className="w-full bg-[var(--card-bg)]/90 backdrop-blur-md border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-white/30 text-lg transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-3 uppercase tracking-widest">Track Type</label>
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => setTrackType('circuit')}
                                    className={`p-5 rounded-2xl border text-center transition-all backdrop-blur-md ${trackType === 'circuit' ? 'bg-white text-black border-white shadow-lg scale-[1.02]' : 'bg-[var(--card-bg)]/90 border-white/10 text-[var(--text-secondary)] hover:border-white/20'}`}
                                >
                                    <div className="font-bold mb-1 text-lg">Circuit</div>
                                    <div className="text-xs opacity-70">Loop track</div>
                                </button>
                                <button
                                    onClick={() => setTrackType('sprint')}
                                    className={`p-5 rounded-2xl border text-center transition-all backdrop-blur-md ${trackType === 'sprint' ? 'bg-white text-black border-white shadow-lg scale-[1.02]' : 'bg-[var(--card-bg)]/90 border-white/10 text-[var(--text-secondary)] hover:border-white/20'}`}
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
                                className="w-full bg-white text-black font-bold py-5 rounded-2xl disabled:opacity-50 flex justify-center items-center gap-2 text-lg transition-transform active:scale-95 shadow-xl"
                            >
                                <MapPin size={22} /> Set Start Gate
                            </button>
                            {!gps && <p className="text-center text-sm text-[var(--accent-red)] mt-4 font-medium bg-black/50 py-2 rounded-full backdrop-blur-md">Waiting for GPS signal...</p>}
                        </div>
                    </div>
                )}

                {step === 'waiting_speed' && (
                    <div className="flex-1 flex flex-col items-center justify-end pb-12 text-center">
                        <div className="w-24 h-24 rounded-full border-4 border-dashed border-[var(--text-secondary)] animate-[spin_3s_linear_infinite] mb-8 bg-black/10 backdrop-blur-sm"></div>
                        <h3 className="text-2xl font-bold mb-3 drop-shadow-lg">Drive to Set Start</h3>
                        <p className="text-[var(--text-secondary)] max-w-[250px] drop-shadow-md">Accelerate past 10km/h to automatically set the start line heading.</p>
                        <div className="mt-8 text-5xl font-sans tabular-nums font-bold drop-shadow-xl bg-black/20 px-6 py-4 rounded-3xl backdrop-blur-md">
                            {Math.round((gps?.speed || 0) * 3.6)} <span className="text-lg text-[var(--text-secondary)] font-sans">km/h</span>
                        </div>
                    </div>
                )}

                {step === 'recording' && (
                    <div className="flex-1 flex flex-col justify-end pb-4 sm:pb-8">
                        <div className="flex-1 flex flex-col items-center justify-center mt-10 sm:mt-20">
                            <div className="bg-black/20 backdrop-blur-md px-6 sm:px-8 py-4 sm:py-6 rounded-[24px] sm:rounded-[32px] border border-white/10 flex flex-col items-center shadow-2xl">
                                <div className="text-[var(--accent-red)] animate-pulse mb-2 sm:mb-4 flex items-center gap-2 font-bold tracking-widest uppercase text-xs sm:text-sm">
                                    <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-[var(--accent-red)]"></div> Recording
                                </div>
                                <div className="text-5xl sm:text-6xl font-bold font-sans tabular-nums mb-1 sm:mb-2 tracking-tighter">
                                    {formatTime(gps ? gps.timestamp - startTime : 0)}
                                </div>
                                <div className="text-lg sm:text-xl text-[var(--text-secondary)] font-sans tabular-nums font-medium">
                                    {(totalDistance / 1000).toFixed(2)} km
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleStop}
                            className="w-full bg-white text-black font-bold py-4 sm:py-5 rounded-2xl flex justify-center items-center gap-2 text-base sm:text-lg transition-transform active:scale-95 shadow-xl mt-4 sm:mt-8"
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
