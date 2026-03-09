import { useState } from 'react';
import { Track, Lap, TrackPoint } from '../types';
import { TrackMap } from './TrackMap';
import { formatTime } from '../utils/geo';
import { ArrowLeft, History, Map as MapIcon, Trophy, Ruler, Edit3, Save, X, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapViewMode } from '../utils/map';
import { MapModeToggle } from './MapModeToggle';
import { LapAnalysisCharts } from './LapAnalysisCharts';

interface Props {
    track: Track;
    onBack: () => void;
    onUpdateTrack: (track: Track) => void;
}

export function TrackDetails({ track, onBack, onUpdateTrack }: Props) {
    const [selectedLap, setSelectedLap] = useState<Lap | null>(null);
    const [mapMode, setMapMode] = useState<MapViewMode>('dt-absolute');
    const [isEditingSectors, setIsEditingSectors] = useState(false);

    const toggleMapMode = () => {
        const modes: MapViewMode[] = ['dt-absolute', 'dt-trend', 'speed-heatmap'];
        const nextIndex = (modes.indexOf(mapMode) + 1) % modes.length;
        setMapMode(modes[nextIndex]);
    };

    const displayedPoints = selectedLap ? selectedLap.points : track.points;
    return (
        <div className="relative h-screen flex flex-col bg-bg-color text-white overflow-hidden">
            {/* Header */}
            <div className="relative z-30 p-6 flex justify-between items-center bg-linear-to-b from-black/80 to-transparent">
                <button 
                    onClick={onBack}
                    className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full transition-colors"
                >
                    <ArrowLeft size={24} />
                </button>
                <div className="text-center">
                    <h2 className="text-xl font-bold tracking-tight">{track.name}</h2>
                    {selectedLap && (
                        <div className="text-[10px] font-bold text-accent-green uppercase tracking-widest">
                            Analyzing Lap: {formatTime(selectedLap.time)}
                        </div>
                    )}
                </div>
                <MapModeToggle mode={mapMode} onToggle={toggleMapMode} />
            </div>

            <div className="flex-1 overflow-y-auto pb-20">
                {/* Map Section */}
                <div className="h-64 relative">
                    <TrackMap 
                        currentPos={null} 
                        referenceTrack={selectedLap ? null : track} 
                        recordedPoints={displayedPoints} 
                        offsetY={0}
                        mode={mapMode}
                    />
                    <div className="absolute inset-0 pointer-events-none bg-linear-to-t from-bg-color via-transparent to-transparent"></div>
                    
                    {/* Map Mode Label */}
                    <div className="absolute bottom-4 left-6 bg-black/50 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                        Mode: {mapMode.replace('-', ' ')}
                    </div>
                </div>

                <div className="px-6 -mt-12 relative z-10 space-y-6">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-card-bg p-5 rounded-3xl border border-white/5">
                            <div className="flex items-center gap-2 text-text-secondary text-xs font-bold uppercase tracking-widest mb-2">
                                <Trophy size={14} className="text-accent-green" />
                                Best Lap
                            </div>
                            <div className="text-3xl font-sans font-bold text-accent-green tabular-nums">
                                {formatTime(track.bestTime)}
                            </div>
                        </div>
                        <div className="bg-card-bg p-5 rounded-3xl border border-white/5">
                            <div className="flex items-center gap-2 text-text-secondary text-xs font-bold uppercase tracking-widest mb-2">
                                <Ruler size={14} />
                                Distance
                            </div>
                            <div className="text-3xl font-sans font-bold tabular-nums">
                                {(track.totalDistance / 1000).toFixed(2)} <span className="text-sm font-sans text-text-secondary">km</span>
                            </div>
                        </div>
                    </div>

                    {/* Analysis Charts */}
                    <AnimatePresence>
                        {selectedLap && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                            >
                                <LapAnalysisCharts lap={selectedLap} />
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Lap History */}
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest flex items-center gap-2">
                                <History size={14} /> Lap History
                            </h3>
                            {selectedLap && (
                                <button 
                                    onClick={() => setSelectedLap(null)}
                                    className="text-[10px] font-bold text-accent-red uppercase tracking-widest hover:underline"
                                >
                                    Reset View
                                </button>
                            )}
                        </div>
                        
                        {!track.laps || track.laps.length === 0 ? (
                            <div className="bg-white/5 p-8 rounded-3xl text-center text-text-secondary border border-dashed border-white/10">
                                No detailed history available. Record new laps to see analysis.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {[...track.laps].reverse().map((lap, idx) => (
                                    <motion.div 
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: idx * 0.05 }}
                                        key={lap.id} 
                                        onClick={() => setSelectedLap(lap)}
                                        className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                                            selectedLap?.id === lap.id 
                                            ? 'bg-accent-green/10 border-accent-green shadow-[0_0_20px_rgba(0,255,102,0.1)]' 
                                            : 'bg-card-bg border-white/5 hover:border-white/20'
                                        } flex justify-between items-center`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="text-text-secondary font-sans text-xs tabular-nums">#{track.laps!.length - idx}</span>
                                            <div className="flex flex-col">
                                                <span className={`font-sans font-bold tabular-nums ${lap.time === track.bestTime ? 'text-accent-green' : ''}`}>
                                                    {formatTime(lap.time)}
                                                </span>
                                                <span className="text-[9px] text-text-secondary font-medium">
                                                    {new Date(lap.date).toLocaleDateString()} {new Date(lap.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {lap.time === track.bestTime && (
                                                <span className="text-[10px] font-bold bg-accent-green/20 text-accent-green px-2 py-0.5 rounded-full uppercase tracking-wider">Record</span>
                                            )}
                                            <Edit3 size={14} className="text-white/20" />
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Track Info & Sectors */}
                    <div className="bg-card-bg p-6 rounded-3xl border border-white/5">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest flex items-center gap-2">
                                <MapIcon size={14} /> Track Info
                            </h3>
                            <button 
                                onClick={() => setIsEditingSectors(!isEditingSectors)}
                                className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors"
                            >
                                <Edit3 size={16} />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-text-secondary">Type</span>
                                <span className="font-bold capitalize">{track.type}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-text-secondary">Total Laps</span>
                                <span className="font-bold">{track.history?.length || 0}</span>
                            </div>
                            
                            {/* Sectors */}
                            <div className="pt-4 border-t border-white/5">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-text-secondary text-xs font-bold uppercase tracking-widest">Sectors</span>
                                    {isEditingSectors && (
                                        <button className="text-[10px] font-bold text-accent-green flex items-center gap-1">
                                            <Plus size={12} /> Add Sector
                                        </button>
                                    )}
                                </div>
                                {!track.sectors || track.sectors.length === 0 ? (
                                    <div className="text-xs text-text-secondary italic">No sectors defined</div>
                                ) : (
                                    <div className="space-y-2">
                                        {track.sectors.map((s, i) => (
                                            <div key={i} className="flex justify-between items-center bg-white/5 p-2 rounded-lg text-sm">
                                                <span>Sector {i + 1}</span>
                                                {isEditingSectors && <X size={14} className="text-accent-red cursor-pointer" />}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
