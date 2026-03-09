import { useState, useEffect, useRef } from 'react';
import { useGPS } from '../hooks/useGPS';
import { Track, TrackPoint, Lap } from '../types';
import { getDistance, checkGateCrossing, formatTime, formatDelta, getExpectedTime } from '../utils/geo';
import { ChevronLeft } from 'lucide-react';
import { TrackMap } from './TrackMap';
import { MapViewMode } from '../utils/map';
import { MapModeToggle } from './MapModeToggle';

interface Props {
    track: Track;
    onBack: () => void;
    onUpdateTrack: (track: Track) => void;
}

export function RaceMode({ track, onBack, onUpdateTrack }: Props) {
    const { data: gps } = useGPS();
    const [raceState, setRaceState] = useState<'waiting' | 'racing' | 'finished'>('waiting');
    const [startTime, setStartTime] = useState(0);
    const [currentDistance, setCurrentDistance] = useState(0);
    const [currentLapTime, setCurrentLapTime] = useState(0);
    const [deltaTime, setDeltaTime] = useState(0);
    const [laps, setLaps] = useState<number[]>([]);
    const [recordedPoints, setRecordedPoints] = useState<TrackPoint[]>([]);
    const [mapMode, setMapMode] = useState<MapViewMode>('dt-absolute');

    // History and Auto-update state
    const [autoUpdate, setAutoUpdate] = useState(track.autoUpdateRecord ?? true);
    const [showSprintModal, setShowSprintModal] = useState(false);
    const [sprintTime, setSprintTime] = useState(0);
    const currentLapPointsRef = useRef<TrackPoint[]>([]);

    const prevGpsRef = useRef(gps);
    const requestRef = useRef<number>(0);

    // High frequency timer update for UI
    useEffect(() => {
        if (raceState !== 'racing') return;

        const updateTimer = () => {
            setCurrentLapTime(Date.now() - startTime);
            requestRef.current = requestAnimationFrame(updateTimer);
        };
        requestRef.current = requestAnimationFrame(updateTimer);

        return () => cancelAnimationFrame(requestRef.current);
    }, [raceState, startTime]);

    // GPS Logic
    useEffect(() => {
        if (!gps || !prevGpsRef.current) {
            prevGpsRef.current = gps;
            return;
        }

        const prev = prevGpsRef.current;
        const curr = gps;

        if (raceState === 'waiting') {
            // Check start gate crossing
            if (checkGateCrossing(prev.lat, prev.lon, curr.lat, curr.lon, track.startGate)) {
                setRaceState('racing');
                setStartTime(curr.timestamp);
                setCurrentDistance(0);
                const firstPoint = {
                    lat: curr.lat,
                    lon: curr.lon,
                    timeOffset: 0,
                    distance: 0,
                    delta: 0,
                    speed: curr.speed
                };
                currentLapPointsRef.current = [firstPoint];
                setRecordedPoints([firstPoint]);
            }
        } else if (raceState === 'racing') {
            // Update distance
            const dist = getDistance(prev.lat, prev.lon, curr.lat, curr.lon);
            const newDist = currentDistance + dist;
            setCurrentDistance(newDist);

            // Calculate Delta based on GPS timestamp for accuracy, not Date.now()
            const gpsLapTime = curr.timestamp - startTime;
            const expectedTime = getExpectedTime(track.points, newDist);
            let currentDelta = 0;
            if (expectedTime > 0) {
                currentDelta = gpsLapTime - expectedTime;
                setDeltaTime(currentDelta);
            }

            // Record points for potential update
            if (dist > 2) {
                const newPoint = {
                    lat: curr.lat,
                    lon: curr.lon,
                    timeOffset: gpsLapTime,
                    distance: newDist,
                    delta: currentDelta,
                    speed: curr.speed
                };
                currentLapPointsRef.current.push(newPoint);
                setRecordedPoints(prev => [...prev, newPoint]);
            }

            // Check finish gate crossing
            if (checkGateCrossing(prev.lat, prev.lon, curr.lat, curr.lon, track.finishGate)) {
                const newLap: Lap = {
                    id: Math.random().toString(36).substr(2, 9),
                    time: gpsLapTime,
                    points: [...currentLapPointsRef.current],
                    date: Date.now()
                };

                if (track.type === 'circuit') {
                    // Lap completed
                    setLaps(prevLaps => [...prevLaps, gpsLapTime]);

                    const isNewBest = gpsLapTime < track.bestTime;
                    const newHistory = [...(track.history || []), gpsLapTime];
                    const newLaps = [...(track.laps || []), newLap];

                    if (isNewBest && autoUpdate) {
                        onUpdateTrack({
                            ...track,
                            bestTime: gpsLapTime,
                            points: [...currentLapPointsRef.current],
                            history: newHistory,
                            laps: newLaps,
                            autoUpdateRecord: autoUpdate
                        });
                    } else {
                        onUpdateTrack({
                            ...track,
                            history: newHistory,
                            laps: newLaps,
                            autoUpdateRecord: autoUpdate
                        });
                    }

                    // Reset for next lap
                    setStartTime(curr.timestamp);
                    setCurrentDistance(0);
                    const firstPoint = {
                        lat: curr.lat,
                        lon: curr.lon,
                        timeOffset: 0,
                        distance: 0,
                        delta: 0,
                        speed: curr.speed
                    };
                    currentLapPointsRef.current = [firstPoint];
                    setRecordedPoints([firstPoint]);
                } else {
                    // Sprint finished
                    setSprintTime(gpsLapTime);
                    setRaceState('finished');
                    setShowSprintModal(true);
                    
                    // Store the finished lap points in a ref to use in modal save
                    (window as any)._lastSprintLap = newLap;
                }
            }
        }

        prevGpsRef.current = curr;
    }, [gps, raceState, track, currentDistance, startTime, autoUpdate, onUpdateTrack]);

    const speedKmh = Math.round((gps?.speed || 0) * 3.6);
    const isFaster = deltaTime <= 0;

    const toggleMapMode = () => {
        const modes: MapViewMode[] = ['dt-absolute', 'dt-trend', 'speed-heatmap'];
        const nextIndex = (modes.indexOf(mapMode) + 1) % modes.length;
        setMapMode(modes[nextIndex]);
    };

    return (
        <div className="relative h-screen flex flex-col bg-[var(--bg-color)] text-white overflow-hidden">
            {/* Map Background */}
            <div className="absolute inset-0 z-0">
                <TrackMap 
                    currentPos={gps} 
                    referenceTrack={track} 
                    recordedPoints={recordedPoints} 
                    offsetY={150} 
                    mode={mapMode}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-color)]/60 via-transparent to-transparent z-10 pointer-events-none"></div>
            </div>

            {/* Header */}
            <div className="relative z-20 p-6 flex items-center justify-between pt-8">
                <button onClick={onBack} className="p-3 bg-black/50 backdrop-blur-md rounded-full hover:bg-white/10 transition-colors border border-white/10">
                    <ChevronLeft size={24} />
                </button>
                <div className="text-center bg-black/50 backdrop-blur-md px-6 py-2 rounded-full border border-white/10">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)]">{track.name}</h2>
                    <div className="text-xs text-white mt-0.5 font-medium">
                        {raceState === 'waiting' ? 'APPROACH START LINE' : raceState === 'finished' ? 'FINISHED' : 'RACING'}
                    </div>
                </div>
                <MapModeToggle mode={mapMode} onToggle={toggleMapMode} />
            </div>

            {/* Main Dashboard */}
            <div className="relative z-20 flex-1 flex flex-col justify-end px-4 sm:px-6 pb-3 sm:pb-6 max-w-md mx-auto w-full">
                {/* Speed */}
                <div className="text-center mb-1 sm:mb-2">
                    <div className="text-[80px] sm:text-[110px] leading-none font-bold font-sans tabular-nums tracking-tighter drop-shadow-2xl">
                        {speedKmh}
                    </div>
                    <div className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] mt-0 drop-shadow-md">KM/H</div>
                </div>

                {/* Time & Delta Grid */}
                <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-2 sm:mb-3">
                    {/* Time */}
                    <div className="bg-[var(--card-bg)]/50 backdrop-blur-sm rounded-2xl p-3 sm:p-5 border border-white/10 shadow-2xl relative overflow-hidden flex flex-col justify-center">
                        <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-0.5 sm:mb-1">Time</div>
                        <div className="text-2xl sm:text-4xl font-sans font-bold tabular-nums tracking-tighter">
                            {formatTime(currentLapTime)}
                        </div>
                        <div className="text-[13px] sm:text-[15px] text-[var(--text-secondary)] mt-0.5 sm:mt-1 font-sans font-semibold tabular-nums">
                            Best: {formatTime(track.bestTime)}
                        </div>
                    </div>

                    {/* Delta */}
                    <div className={`rounded-2xl p-3 sm:p-5 border shadow-2xl transition-colors duration-300 backdrop-blur-sm flex flex-col justify-center ${
                        raceState === 'waiting' ? 'bg-[var(--card-bg)]/50 border-white/10' :
                        isFaster ? 'bg-[var(--accent-green)]/20 border-[var(--accent-green)]/50' : 'bg-[var(--accent-red)]/20 border-[var(--accent-red)]/50'
                    }`}>
                        <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-0.5 sm:mb-1">Delta</div>
                        <div className={`text-2xl sm:text-4xl font-sans font-bold tabular-nums tracking-tighter ${
                            raceState === 'waiting' ? 'text-[var(--text-secondary)]' :
                            isFaster ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'
                        }`}>
                            {raceState === 'waiting' ? '+0.00' : formatDelta(deltaTime)}
                        </div>
                    </div>
                </div>

                {/* Laps (Circuit only) */}
                {track.type === 'circuit' && laps.length > 0 && (
                    <div className="bg-black/20 backdrop-blur-sm rounded-2xl p-2 sm:p-3 border border-white/5">
                        <div className="flex justify-between items-center mb-1.5">
                            <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Previous Laps</div>
                            <label className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold text-[var(--text-secondary)] cursor-pointer hover:text-white transition-colors">
                                <input
                                    type="checkbox"
                                    checked={autoUpdate}
                                    onChange={(e) => {
                                        setAutoUpdate(e.target.checked);
                                        onUpdateTrack({ ...track, autoUpdateRecord: e.target.checked });
                                    }}
                                    className="accent-[var(--accent-green)] w-3 h-3 rounded"
                                />
                                Auto-Update
                            </label>
                        </div>
                        <div className="space-y-1">
                            {laps.slice(-3).map((lap, i) => {
                                const lapDelta = lap - track.bestTime;
                                const isLapFaster = lapDelta <= 0;
                                return (
                                    <div key={i} className="flex justify-between items-center text-xs sm:text-sm font-sans tabular-nums bg-white/5 p-1.5 sm:p-2 rounded-xl">
                                        <span className="text-[var(--text-secondary)] font-medium text-[10px] sm:text-xs">Lap {laps.length - Math.min(laps.length, 3) + i + 1}</span>
                                        <div className="flex items-center gap-2 sm:gap-3">
                                            <span className={`font-bold ${isLapFaster ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                                                {formatDelta(lapDelta)}
                                            </span>
                                            <span className="font-bold text-white/90">{formatTime(lap)}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Sprint Finish Modal */}
            {showSprintModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
                    <div className="bg-[var(--card-bg)] border border-white/10 p-8 rounded-3xl max-w-sm w-full shadow-2xl text-center">
                        <h3 className="text-2xl font-bold mb-2">Sprint Finished!</h3>
                        <div className="text-5xl font-sans font-bold mb-6 text-[var(--accent-green)] tabular-nums">
                            {formatTime(sprintTime)}
                        </div>
                        {sprintTime < track.bestTime ? (
                            <>
                                <div className="text-[var(--accent-green)] font-bold mb-6 uppercase tracking-widest text-sm">
                                    New Personal Best!
                                </div>
                                <p className="text-[var(--text-secondary)] mb-8 text-sm">
                                    Would you like to update the reference track with this new record?
                                </p>
                                <div className="flex gap-4">
                                    <button
                                        onClick={() => {
                                            const lastLap = (window as any)._lastSprintLap as Lap;
                                            onUpdateTrack({
                                                ...track,
                                                bestTime: sprintTime,
                                                points: [...currentLapPointsRef.current],
                                                history: [...(track.history || []), sprintTime],
                                                laps: [...(track.laps || []), lastLap]
                                            });
                                            onBack();
                                        }}
                                        className="flex-1 bg-white text-black font-bold py-3 rounded-xl hover:bg-gray-200 transition-colors"
                                    >
                                        Update
                                    </button>
                                    <button
                                        onClick={() => {
                                            const lastLap = (window as any)._lastSprintLap as Lap;
                                            onUpdateTrack({
                                                ...track,
                                                history: [...(track.history || []), sprintTime],
                                                laps: [...(track.laps || []), lastLap]
                                            });
                                            onBack();
                                        }}
                                        className="flex-1 bg-white/10 text-white font-bold py-3 rounded-xl hover:bg-white/20 transition-colors"
                                    >
                                        Skip
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="text-[var(--text-secondary)] font-bold mb-6 uppercase tracking-widest text-sm">
                                    Slower than Best ({formatTime(track.bestTime)})
                                </div>
                                <button
                                    onClick={() => {
                                        const lastLap = (window as any)._lastSprintLap as Lap;
                                        onUpdateTrack({
                                            ...track,
                                            history: [...(track.history || []), sprintTime],
                                            laps: [...(track.laps || []), lastLap]
                                        });
                                        onBack();
                                    }}
                                    className="w-full bg-white text-black font-bold py-3 rounded-xl hover:bg-gray-200 transition-colors"
                                >
                                    Continue
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
