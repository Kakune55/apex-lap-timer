import { useMemo, useState, useEffect, useRef } from 'react';
import { useGPS } from '../hooks/useGPS';
import { Track, TrackPoint, Lap } from '../types';
import {
    getDistance,
    estimateGateCrossingTime,
    formatTime,
    formatDelta,
    getExpectedTime,
    projectToTrackDistance,
    getTimeInterpolationRatio,
} from '../utils/geo';
import { ChevronLeft } from 'lucide-react';
import { TrackMap } from './TrackMap';
import { MapViewMode, getNextMapViewMode } from '../utils/map';
import { MapModeToggle } from './MapModeToggle';

interface Props {
    track: Track;
    onBack: () => void;
    onUpdateTrack: (track: Track) => void;
}

export function RaceMode({ track, onBack, onUpdateTrack }: Props) {
    const MAX_SECTOR_SEGMENTS = 3;
    const MAX_SECTOR_GATES = MAX_SECTOR_SEGMENTS - 1;
    const { data: gps } = useGPS();
    const [raceState, setRaceState] = useState<'waiting' | 'racing' | 'finished'>('waiting');
    const [startTime, setStartTime] = useState(0);
    const [currentDistance, setCurrentDistance] = useState(0);
    const [currentLapTime, setCurrentLapTime] = useState(0);
    const [deltaTime, setDeltaTime] = useState(0);
    const [recordedPoints, setRecordedPoints] = useState<TrackPoint[]>([]);
    const [mapMode, setMapMode] = useState<MapViewMode>('dt-absolute');

    // History and Auto-update state
    const [autoUpdate, setAutoUpdate] = useState(track.autoUpdateRecord ?? true);
    const [showSprintModal, setShowSprintModal] = useState(false);
    const [sprintTime, setSprintTime] = useState(0);
    const [nextSectorGateIndex, setNextSectorGateIndex] = useState(0);
    const [currentSectorStartTime, setCurrentSectorStartTime] = useState(0);
    const [currentLapSectorDeltas, setCurrentLapSectorDeltas] = useState<Array<number | null>>([null, null, null]);
    const [displaySectorDeltas, setDisplaySectorDeltas] = useState<Array<number | null>>([null, null, null]);
    const [isSectorDisplayFrozen, setIsSectorDisplayFrozen] = useState(false);
    const currentLapPointsRef = useRef<TrackPoint[]>([]);
    const lastSprintLapRef = useRef<Lap | null>(null);
    const projectedDistanceRef = useRef(0);
    const currentLapSectorDeltasRef = useRef<Array<number | null>>([null, null, null]);
    const freezeTimeoutRef = useRef<number | null>(null);

    const prevGpsRef = useRef(gps);
    const requestRef = useRef<number>(0);

    const lapHistory = track.laps || [];
    const sectorGates = (track.sectors || []).slice(0, MAX_SECTOR_GATES);

    const sectorBoundaryDistances = useMemo(() => {
        const sectors = sectorGates;
        const gateDistances = sectors.map((sector, idx) => {
            const projected = projectToTrackDistance(track.points, sector.lat, sector.lon, {
                maxLateralError: 100,
            });
            const fallbackDistance = ((idx + 1) / (sectors.length + 1)) * track.totalDistance;
            return Math.max(0, projected?.distance ?? fallbackDistance);
        });

        // Boundaries are gates plus finish line, so 2 gates => 3 sectors.
        return [...gateDistances, track.totalDistance];
    }, [sectorGates, track.points, track.totalDistance]);

    const sectorBoundaryExpectedTimes = useMemo(
        () => sectorBoundaryDistances.map((distance) => getExpectedTime(track.points, distance)),
        [sectorBoundaryDistances, track.points],
    );

    const getLapSectorSplits = (lap: Lap): number[] => {
        if (sectorBoundaryDistances.length === 0) {
            return [];
        }

        const crossings = sectorBoundaryDistances.map((distance) => getExpectedTime(lap.points, distance));
        const splits: number[] = [];
        let previous = 0;
        for (const current of crossings) {
            splits.push(Math.max(0, current - previous));
            previous = current;
        }
        return splits;
    };

    const lapSectorDeltas = useMemo(() => {
        const map = new Map<string, number[]>();
        for (let i = 0; i < lapHistory.length; i++) {
            const current = lapHistory[i];
            if (i === 0) {
                map.set(current.id, []);
                continue;
            }

            const prev = lapHistory[i - 1];
            const currentSplits = getLapSectorSplits(current);
            const prevSplits = getLapSectorSplits(prev);
            const deltas = currentSplits.map((split, idx) => split - (prevSplits[idx] ?? split));
            map.set(current.id, deltas);
        }
        return map;
    }, [lapHistory, sectorBoundaryDistances]);

    const updateLiveSectorDelta = (segmentIndex: number, value: number) => {
        setCurrentLapSectorDeltas((prev) => {
            const next = [...prev];
            if (segmentIndex >= 0 && segmentIndex < MAX_SECTOR_SEGMENTS) {
                next[segmentIndex] = value;
            }
            currentLapSectorDeltasRef.current = next;
            if (!isSectorDisplayFrozen) {
                setDisplaySectorDeltas(next);
            }
            return next;
        });
    };

    const resetCurrentLapSectors = () => {
        const cleared: Array<number | null> = [null, null, null];
        setCurrentLapSectorDeltas(cleared);
        currentLapSectorDeltasRef.current = cleared;
        if (!isSectorDisplayFrozen) {
            setDisplaySectorDeltas(cleared);
        }
    };

    const holdSectorDisplayForFiveSeconds = () => {
        setIsSectorDisplayFrozen(true);
        if (freezeTimeoutRef.current !== null) {
            clearTimeout(freezeTimeoutRef.current);
            freezeTimeoutRef.current = null;
        }

        freezeTimeoutRef.current = window.setTimeout(() => {
            setIsSectorDisplayFrozen(false);
            setDisplaySectorDeltas(currentLapSectorDeltasRef.current);
            freezeTimeoutRef.current = null;
        }, 5000);
    };

    const estimateSegmentSpeed = (
        fromTimestamp: number,
        toTimestamp: number,
        segmentDistance: number,
    ): number | undefined => {
        const dt = (toTimestamp - fromTimestamp) / 1000;
        if (dt <= 0) {
            return undefined;
        }
        return segmentDistance / dt;
    };

    const sanitizeLapPointSpeed = (
        reportedSpeed: number | undefined,
        fallbackSpeed: number | undefined,
    ): number => {
        if (typeof reportedSpeed === 'number' && Number.isFinite(reportedSpeed) && reportedSpeed > 0.5) {
            return reportedSpeed;
        }
        if (typeof fallbackSpeed === 'number' && Number.isFinite(fallbackSpeed) && fallbackSpeed > 0) {
            return fallbackSpeed;
        }
        return Math.max(0, reportedSpeed ?? 0);
    };

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
            const startCrossingTime = estimateGateCrossingTime(
                prev.lat,
                prev.lon,
                prev.timestamp,
                curr.lat,
                curr.lon,
                curr.timestamp,
                track.startGate,
            );

            if (startCrossingTime !== null) {
                const startRatio = getTimeInterpolationRatio(prev.timestamp, curr.timestamp, startCrossingTime);
                const startLat = prev.lat + (curr.lat - prev.lat) * startRatio;
                const startLon = prev.lon + (curr.lon - prev.lon) * startRatio;
                const startSpeed = prev.speed + (curr.speed - prev.speed) * startRatio;
                setRaceState('racing');
                setStartTime(startCrossingTime);
                setCurrentDistance(0);
                setNextSectorGateIndex(0);
                setCurrentSectorStartTime(0);
                resetCurrentLapSectors();
                projectedDistanceRef.current = 0;
                const firstPoint = {
                    lat: startLat,
                    lon: startLon,
                    timeOffset: 0,
                    distance: 0,
                    delta: 0,
                    speed: startSpeed
                };
                currentLapPointsRef.current = [firstPoint];
                setRecordedPoints([firstPoint]);
            }
        } else if (raceState === 'racing') {
            const dist = getDistance(prev.lat, prev.lon, curr.lat, curr.lon);
            const segmentSpeed = estimateSegmentSpeed(prev.timestamp, curr.timestamp, dist);
            const gpsAccuracy = curr.accuracy || 12;
            const prevProjectedDistance = projectedDistanceRef.current;
            const lastRecordedSpeed = currentLapPointsRef.current[currentLapPointsRef.current.length - 1]?.speed;
            const positiveSegmentSpeed = typeof segmentSpeed === 'number' && segmentSpeed > 0 ? segmentSpeed : undefined;
            const speedFallback = positiveSegmentSpeed ?? lastRecordedSpeed;
            const safePrevSpeed = sanitizeLapPointSpeed(prev.speed, speedFallback);
            const safeCurrSpeed = sanitizeLapPointSpeed(curr.speed, speedFallback);

            const projection = projectToTrackDistance(track.points, curr.lat, curr.lon, {
                minDistance: Math.max(0, prevProjectedDistance - 12),
                maxDistance: prevProjectedDistance + Math.max(35, dist * 3 + gpsAccuracy * 1.5),
                maxLateralError: Math.max(12, Math.min(42, gpsAccuracy * 1.8)),
                targetDistance: prevProjectedDistance + dist,
                continuityWeight: 0.08,
            });

            let newDist: number;
            if (projection) {
                const maxAdvance = Math.max(22, dist * 3 + gpsAccuracy * 1.8);
                const projected = Math.max(prevProjectedDistance, projection.distance);
                newDist = Math.min(projected, prevProjectedDistance + maxAdvance);
            } else {
                // Fallback to dead reckoning when projection is temporarily unavailable.
                const maxFallbackStep = Math.max(8, gpsAccuracy * 1.2);
                newDist = prevProjectedDistance + Math.min(dist, maxFallbackStep);
            }

            projectedDistanceRef.current = newDist;
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
            const jumpThreshold = Math.max(60, gpsAccuracy * 4);
            if (dist > 2 && dist < jumpThreshold) {
                const newPoint = {
                    lat: curr.lat,
                    lon: curr.lon,
                    timeOffset: gpsLapTime,
                    distance: newDist,
                    delta: currentDelta,
                    speed: safeCurrSpeed
                };
                currentLapPointsRef.current.push(newPoint);
                setRecordedPoints(prev => [...prev, newPoint]);
            }

            if (nextSectorGateIndex < sectorGates.length) {
                const sectorGate = sectorGates[nextSectorGateIndex];
                const sectorCrossingTime = estimateGateCrossingTime(
                    prev.lat,
                    prev.lon,
                    prev.timestamp,
                    curr.lat,
                    curr.lon,
                    curr.timestamp,
                    sectorGate,
                );

                if (sectorCrossingTime !== null) {
                    const segmentIndex = nextSectorGateIndex;
                    const sectorLapTime = sectorCrossingTime - startTime;
                    const expectedEnd = sectorBoundaryExpectedTimes[segmentIndex] || 0;
                    const expectedStart = segmentIndex === 0 ? 0 : (sectorBoundaryExpectedTimes[segmentIndex - 1] || 0);
                    const expectedSegmentTime = Math.max(0, expectedEnd - expectedStart);
                    const currentSegmentTime = sectorLapTime - currentSectorStartTime;
                    updateLiveSectorDelta(segmentIndex, currentSegmentTime - expectedSegmentTime);
                    setCurrentSectorStartTime(sectorLapTime);
                    setNextSectorGateIndex((prevIdx) => prevIdx + 1);
                }
            }

            // Check finish gate crossing
            const finishCrossingTime = estimateGateCrossingTime(
                prev.lat,
                prev.lon,
                prev.timestamp,
                curr.lat,
                curr.lon,
                curr.timestamp,
                track.finishGate,
            );

            if (finishCrossingTime !== null) {
                const finishLapTime = Math.max(0, finishCrossingTime - startTime);
                const finishRatio = getTimeInterpolationRatio(prev.timestamp, curr.timestamp, finishCrossingTime);
                const finishLat = prev.lat + (curr.lat - prev.lat) * finishRatio;
                const finishLon = prev.lon + (curr.lon - prev.lon) * finishRatio;
                const finishSpeed = safePrevSpeed + (safeCurrSpeed - safePrevSpeed) * finishRatio;
                const finalSegmentIndex = sectorGates.length;
                if (finalSegmentIndex < MAX_SECTOR_SEGMENTS) {
                    const expectedEnd = sectorBoundaryExpectedTimes[finalSegmentIndex] || finishLapTime;
                    const expectedStart = finalSegmentIndex === 0 ? 0 : (sectorBoundaryExpectedTimes[finalSegmentIndex - 1] || 0);
                    const expectedSegmentTime = Math.max(0, expectedEnd - expectedStart);
                    const currentSegmentTime = finishLapTime - currentSectorStartTime;
                    updateLiveSectorDelta(finalSegmentIndex, currentSegmentTime - expectedSegmentTime);
                }

                const lapPoints = [
                    ...currentLapPointsRef.current,
                    {
                        lat: finishLat,
                        lon: finishLon,
                        timeOffset: finishLapTime,
                        distance: track.totalDistance,
                        delta: currentDelta,
                        speed: finishSpeed,
                    },
                ];

                const newLap: Lap = {
                    id: crypto.randomUUID(),
                    time: finishLapTime,
                    points: lapPoints,
                    date: Date.now()
                };

                if (track.type === 'circuit') {
                    // Lap completed
                    const isNewBest = finishLapTime < track.bestTime;
                    const newHistory = [...(track.history || []), finishLapTime];
                    const newLaps = [...(track.laps || []), newLap];

                    if (isNewBest && autoUpdate) {
                        onUpdateTrack({
                            ...track,
                            bestTime: finishLapTime,
                            points: lapPoints,
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
                    holdSectorDisplayForFiveSeconds();
                    setStartTime(finishCrossingTime);
                    setCurrentDistance(0);
                    setNextSectorGateIndex(0);
                    setCurrentSectorStartTime(0);
                    resetCurrentLapSectors();
                    projectedDistanceRef.current = 0;
                    const firstPoint = {
                        lat: finishLat,
                        lon: finishLon,
                        timeOffset: 0,
                        distance: 0,
                        delta: 0,
                        speed: finishSpeed
                    };
                    currentLapPointsRef.current = [firstPoint];
                    setRecordedPoints([firstPoint]);
                } else {
                    // Sprint finished
                    setSprintTime(finishLapTime);
                    setRaceState('finished');
                    setShowSprintModal(true);
                    lastSprintLapRef.current = newLap;
                }
            }
        }

        prevGpsRef.current = curr;
    }, [
        gps,
        raceState,
        track,
        startTime,
        autoUpdate,
        onUpdateTrack,
        nextSectorGateIndex,
        currentSectorStartTime,
        sectorBoundaryExpectedTimes,
        sectorGates,
        isSectorDisplayFrozen,
    ]);

    useEffect(() => {
        return () => {
            if (freezeTimeoutRef.current !== null) {
                clearTimeout(freezeTimeoutRef.current);
                freezeTimeoutRef.current = null;
            }
        };
    }, []);

    const speedKmh = Math.round((gps?.speed || 0) * 3.6);
    const isFaster = deltaTime <= 0;
    const lastLap = lapHistory.length > 0 ? lapHistory[lapHistory.length - 1] : null;
    const previousLap = lapHistory.length > 1 ? lapHistory[lapHistory.length - 2] : null;
    const bestLapTime = lapHistory.length > 0 ? Math.min(...lapHistory.map((lap) => lap.time)) : null;
    const lastLapColorClass =
        !lastLap ? 'text-text-secondary' :
        bestLapTime !== null && lastLap.time <= bestLapTime ? 'text-[var(--color-violet-600)]' :
        previousLap && lastLap.time < previousLap.time ? 'text-accent-green' :
        previousLap && lastLap.time > previousLap.time ? 'text-accent-yellow' :
        'text-text-secondary';

    const shortDelta = (ms: number) => {
        const sign = ms > 0 ? '+' : '-';
        const abs = Math.abs(ms);
        return `${sign}${(abs / 1000).toFixed(1)}`;
    };

    const displaySectorValues = displaySectorDeltas.map((value) => (value === null ? '+0.0' : shortDelta(value)));

    const toFixedSectorCount = (values: number[]) => {
        const copy = values.slice(0, MAX_SECTOR_SEGMENTS);
        while (copy.length < MAX_SECTOR_SEGMENTS) {
            copy.push(0);
        }
        return copy;
    };

    const toggleMapMode = () => {
        setMapMode((prevMode) => getNextMapViewMode(prevMode));
    };

    const saveSprintResult = (updateBest: boolean) => {
        const lastLap = lastSprintLapRef.current;
        if (!lastLap) {
            onBack();
            return;
        }

        const nextTrack: Track = {
            ...track,
            history: [...(track.history || []), sprintTime],
            laps: [...(track.laps || []), lastLap],
            ...(updateBest
                ? {
                      bestTime: sprintTime,
                      points: [...currentLapPointsRef.current],
                  }
                : {}),
        };

        onUpdateTrack(nextTrack);
        onBack();
    };

    const sprintDelta = sprintTime - track.bestTime;
    const sprintIsNewBest = sprintTime < track.bestTime;
    const sprintLap = lastSprintLapRef.current;
    const referenceSectorSplits = toFixedSectorCount(
        sectorBoundaryExpectedTimes.map((expectedEnd, idx) => {
            const expectedStart = idx === 0 ? 0 : (sectorBoundaryExpectedTimes[idx - 1] || 0);
            return Math.max(0, expectedEnd - expectedStart);
        }),
    );
    const sprintSectorSplits = sprintLap ? toFixedSectorCount(getLapSectorSplits(sprintLap)) : [0, 0, 0];
    const sprintSectorDeltas = sprintSectorSplits.map((split, idx) => split - (referenceSectorSplits[idx] ?? split));

    return (
        <div className="relative h-full flex flex-col bg-bg-color text-white overflow-hidden">
            {/* Map Background */}
            <div className="absolute inset-0 z-0">
                <TrackMap 
                    currentPos={gps} 
                    referenceTrack={track} 
                    recordedPoints={recordedPoints} 
                    offsetY={150} 
                    mode={mapMode}
                />
                <div className="absolute inset-0 bg-linear-to-t from-bg-color/60 via-transparent to-transparent z-10 pointer-events-none"></div>
            </div>

            {/* Header */}
            <div className="relative z-20 px-6 pb-4 pt-[calc(var(--safe-top)+0.5rem)] flex items-center justify-between">
                <button onClick={onBack} className="p-3 apex-pill hover:bg-white/10 transition-colors">
                    <ChevronLeft size={24} />
                </button>
                <div className="text-center apex-pill px-6 py-2">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-text-secondary">{track.name}</h2>
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
                    <div className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-text-secondary mt-0 drop-shadow-md">KM/H</div>
                </div>

                {/* Time & Delta Grid */}
                <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-2 sm:mb-3">
                    {/* Time */}
                    <div className="apex-panel rounded-2xl p-3 sm:p-5 relative overflow-hidden flex flex-col justify-center">
                        <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-0.5 sm:mb-1">Time</div>
                        <div className="text-2xl sm:text-4xl font-sans font-bold tabular-nums tracking-tighter">
                            {formatTime(currentLapTime)}
                        </div>
                        <div className="text-[13px] sm:text-[15px] text-text-secondary mt-0.5 sm:mt-1 font-sans font-semibold tabular-nums">
                            Best: {formatTime(track.bestTime)}
                        </div>
                        <div className={`text-[12px] sm:text-[14px] mt-1 font-sans font-bold tabular-nums ${lastLapColorClass}`}>
                            Last: {lastLap ? formatTime(lastLap.time) : '--:--.--'}
                        </div>
                    </div>

                    {/* Delta */}
                    <div className={`rounded-2xl p-3 sm:p-5 border shadow-2xl transition-colors duration-300 backdrop-blur-sm flex flex-col justify-center ${
                        raceState === 'waiting' ? 'apex-panel-muted' :
                        isFaster ? 'bg-accent-green/20 border-accent-green/50' : 'bg-accent-red/20 border-accent-red/50'
                    }`}>
                        <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-0.5 sm:mb-1">Delta</div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-text-secondary mb-1">Live Sectors</div>
                        <div className={`text-2xl sm:text-4xl font-sans font-bold tabular-nums tracking-tighter ${
                            raceState === 'waiting' ? 'text-text-secondary' :
                            isFaster ? 'text-accent-green' : 'text-accent-red'
                        }`}>
                            {raceState === 'waiting' ? '+0.00' : formatDelta(deltaTime)}
                        </div>
                        <div className="mt-1 space-y-1">
                            <div className="flex items-center gap-1.5 text-[10px] tabular-nums">
                                {displaySectorValues.map((val, idx) => (
                                    <span
                                        key={`live-sector-val-${idx}`}
                                        className={`${displaySectorDeltas[idx] === null ? 'text-text-secondary' : (displaySectorDeltas[idx]! < 0 ? 'text-accent-green' : displaySectorDeltas[idx]! > 0 ? 'text-accent-yellow' : 'text-text-secondary')}`}
                                    >
                                        {val}
                                    </span>
                                ))}
                            </div>
                            <div className="flex items-center gap-1.5">
                                {displaySectorDeltas.map((val, idx) => (
                                    <span
                                        key={`live-sector-bar-${idx}`}
                                        className={`inline-block h-1.5 w-6 rounded-full ${val === null ? 'bg-white/20' : val < 0 ? 'bg-accent-green' : val > 0 ? 'bg-accent-yellow' : 'bg-white/30'}`}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Laps (Circuit only) */}
                {track.type === 'circuit' && lapHistory.length > 0 && (
                    <div className="apex-panel-muted rounded-2xl p-2 sm:p-3">
                        <div className="flex justify-between items-center mb-1.5">
                            <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-text-secondary">Previous Laps</div>
                            <label className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold text-text-secondary cursor-pointer hover:text-white transition-colors">
                                <input
                                    type="checkbox"
                                    checked={autoUpdate}
                                    onChange={(e) => {
                                        setAutoUpdate(e.target.checked);
                                        onUpdateTrack({ ...track, autoUpdateRecord: e.target.checked });
                                    }}
                                    className="accent-accent-green w-3 h-3 rounded"
                                />
                                Auto-Update
                            </label>
                        </div>
                        <div className="space-y-1">
                            {lapHistory.slice(-3).reverse().map((lap, i) => {
                                const lapDelta = lap.time - track.bestTime;
                                const isLapFaster = lapDelta <= 0;
                                const sectorDeltas = toFixedSectorCount(lapSectorDeltas.get(lap.id) || []);
                                return (
                                    <div key={lap.id} className="text-xs sm:text-sm font-sans tabular-nums bg-white/5 p-1.5 sm:p-2 rounded-xl">
                                        <div className="flex justify-between items-center">
                                            <span className="text-text-secondary font-medium text-[10px] sm:text-xs">Lap {lapHistory.length - i}</span>
                                            <div className="flex items-center gap-2 sm:gap-3">
                                                <span className={`font-bold ${isLapFaster ? 'text-accent-green' : 'text-accent-red'}`}>
                                                    {formatDelta(lapDelta)}
                                                </span>
                                                <span className="font-bold text-white/90">{formatTime(lap.time)}</span>
                                            </div>
                                        </div>
                                        {sectorDeltas.length > 0 && (
                                            <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                                                {sectorDeltas.map((sd, idx) => (
                                                    <span
                                                        key={`${lap.id}-bar-${idx}`}
                                                        className={`inline-block h-1.5 w-4 rounded-full ${sd < 0 ? 'bg-accent-green' : sd > 0 ? 'bg-accent-yellow' : 'bg-white/30'}`}
                                                    />
                                                ))}
                                                <span className="mx-1 text-white/25">|</span>
                                                {sectorDeltas.map((sd, idx) => (
                                                    <span
                                                        key={`${lap.id}-num-${idx}`}
                                                        className={`tabular-nums ${sd < 0 ? 'text-accent-green' : sd > 0 ? 'text-accent-yellow' : 'text-text-secondary'}`}
                                                    >
                                                        {shortDelta(sd)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
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
                    <div className="apex-panel p-6 sm:p-8 rounded-3xl max-w-md w-full text-center">
                        <h3 className="text-2xl font-bold mb-2">Sprint Finished!</h3>
                        <div className="text-5xl font-sans font-bold mb-3 text-accent-green tabular-nums">
                            {formatTime(sprintTime)}
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-4">
                            <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-left">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-1">Delta</div>
                                <div className={`text-lg font-sans font-bold tabular-nums ${sprintDelta <= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                                    {formatDelta(sprintDelta)}
                                </div>
                            </div>
                            <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-left">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-1">Reference</div>
                                <div className="text-lg font-sans font-bold tabular-nums text-white/90">
                                    {formatTime(track.bestTime)}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl bg-white/5 border border-white/10 p-3 mb-6 text-left">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-2">Sectors</div>
                            <div className="space-y-1.5">
                                {sprintSectorSplits.map((split, idx) => {
                                    const sectorDelta = sprintSectorDeltas[idx] || 0;
                                    const deltaClass = sectorDelta < 0 ? 'text-accent-green' : sectorDelta > 0 ? 'text-accent-yellow' : 'text-text-secondary';
                                    return (
                                        <div key={`sprint-sector-${idx}`} className="grid grid-cols-[44px_1fr_auto] items-center gap-2 text-xs tabular-nums">
                                            <span className="text-text-secondary font-bold">S{idx + 1}</span>
                                            <span className="text-white/90 font-semibold">{formatTime(split)}</span>
                                            <span className={`font-bold ${deltaClass}`}>{shortDelta(sectorDelta)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {sprintIsNewBest ? (
                            <>
                                <div className="text-accent-green font-bold mb-6 uppercase tracking-widest text-sm">
                                    New Personal Best!
                                </div>
                                <p className="text-text-secondary mb-6 text-sm">
                                    Would you like to update the reference track with this new record?
                                </p>
                                <div className="flex gap-4">
                                    <button
                                        onClick={() => saveSprintResult(true)}
                                        className="flex-1 apex-btn-primary py-3"
                                    >
                                        Update
                                    </button>
                                    <button
                                        onClick={() => saveSprintResult(false)}
                                        className="flex-1 bg-white/10 text-white font-bold py-3 rounded-xl hover:bg-white/20 transition-colors"
                                    >
                                        Skip
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="text-text-secondary font-bold mb-6 uppercase tracking-widest text-sm">
                                    Slower than Best ({formatTime(track.bestTime)})
                                </div>
                                <button
                                    onClick={() => saveSprintResult(false)}
                                    className="w-full apex-btn-primary py-3"
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

