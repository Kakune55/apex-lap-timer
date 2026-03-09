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
        <div className="p-6 max-w-2xl mx-auto w-full">
            <div className="flex justify-between items-center mb-8 pt-8">
                <h1 className="text-3xl font-bold tracking-tight">Saved Tracks</h1>
                <button
                    onClick={onCreateNew}
                    className="bg-white text-black px-4 py-2 rounded-full font-medium flex items-center gap-2 hover:bg-gray-200 transition-colors"
                >
                    <Plus size={18} /> New Track
                </button>
            </div>

            {tracks.length === 0 ? (
                <div className="text-center py-16 text-[var(--text-secondary)] border border-white/10 rounded-3xl border-dashed">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Flag className="opacity-50" size={24} />
                    </div>
                    <p className="text-lg font-medium text-white mb-1">No tracks recorded</p>
                    <p className="text-sm">Record a circuit or sprint track to start racing.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {tracks.map(track => (
                        <div key={track.id} className="bg-[var(--card-bg)] p-5 rounded-3xl border border-white/5 flex items-center justify-between group hover:border-white/20 transition-colors">
                            <div>
                                <h3 className="text-xl font-medium mb-1">{track.name}</h3>
                                <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                                    <span className="uppercase tracking-wider text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded-md text-white">{track.type}</span>
                                    <span className="font-sans tabular-nums">{(track.totalDistance / 1000).toFixed(2)} km</span>
                                    <span className="font-sans text-[var(--accent-green)] font-bold tabular-nums">{formatTime(track.bestTime)}</span>
                                    {track.history && track.history.length > 0 && (
                                        <span className="flex items-center gap-1 text-xs bg-white/5 px-2 py-0.5 rounded-full">
                                            <History size={12} /> {track.history.length}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => onViewDetails(track)}
                                    className="p-3 text-[var(--text-secondary)] hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                    title="View Details"
                                >
                                    <Info size={20} />
                                </button>
                                <button
                                    onClick={() => onDelete(track.id)}
                                    className="p-3 text-[var(--text-secondary)] hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
                                >
                                    <Trash2 size={20} />
                                </button>
                                <button
                                    onClick={() => onSelect(track)}
                                    className="p-4 bg-white text-black rounded-full hover:bg-gray-200 transition-colors shadow-lg"
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
