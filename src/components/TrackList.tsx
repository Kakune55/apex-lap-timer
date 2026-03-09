import { Track } from '../types';
import { Play, Plus, Trash2, History, Info } from 'lucide-react';
import { formatTime } from '../utils/geo';
import { Flag } from 'lucide-react';

interface Props {
    tracks: Track[];
    onSelect: (track: Track) => void;
    onDelete: (id: string) => void;
    onViewDetails: (track: Track) => void;
    onCreateNew: () => void;
}

export function TrackList({ tracks, onSelect, onDelete, onViewDetails, onCreateNew }: Props) {
    return (
        <div className="p-3 sm:p-6 max-w-3xl mx-auto w-full">
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-5 sm:mb-8 pt-4 sm:pt-8">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Saved Tracks</h1>
                <button
                    onClick={onCreateNew}
                    className="bg-white text-black px-4 py-2 rounded-full font-medium flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors w-full sm:w-auto"
                >
                    <Plus size={18} /> New Track
                </button>
            </div>

            {tracks.length === 0 ? (
                <div className="text-center py-16 text-text-secondary border border-white/10 rounded-3xl border-dashed">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Flag className="opacity-50" size={24} />
                    </div>
                    <p className="text-lg font-medium text-white mb-1">No tracks recorded</p>
                    <p className="text-sm">Record a circuit or sprint track to start racing.</p>
                </div>
            ) : (
                <div className="space-y-3 sm:space-y-4">
                    {tracks.map(track => (
                        <div key={track.id} className="bg-card-bg p-4 sm:p-5 rounded-3xl border border-white/5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between group hover:border-white/20 transition-colors">
                            <div className="min-w-0">
                                <h3 className="text-lg sm:text-xl font-medium mb-1 truncate">{track.name}</h3>
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-text-secondary">
                                    <span className="uppercase tracking-wider text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded-md text-white">{track.type}</span>
                                    <span className="font-sans tabular-nums">{(track.totalDistance / 1000).toFixed(2)} km</span>
                                    <span className="font-sans text-accent-green font-bold tabular-nums">{formatTime(track.bestTime)}</span>
                                    {track.history && track.history.length > 0 && (
                                        <span className="flex items-center gap-1 text-xs bg-white/5 px-2 py-0.5 rounded-full">
                                            <History size={12} /> {track.history.length}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-2 sm:gap-3 w-full sm:w-auto">
                                <button
                                    onClick={() => onViewDetails(track)}
                                    className="p-2.5 sm:p-3 text-text-secondary hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                    title="View Details"
                                >
                                    <Info size={20} />
                                </button>
                                <button
                                    onClick={() => onDelete(track.id)}
                                    className="p-2.5 sm:p-3 text-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
                                >
                                    <Trash2 size={20} />
                                </button>
                                <button
                                    onClick={() => onSelect(track)}
                                    className="p-3 sm:p-4 bg-white text-black rounded-full hover:bg-gray-200 transition-colors shadow-lg"
                                >
                                    <Play size={20} className="ml-0.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
