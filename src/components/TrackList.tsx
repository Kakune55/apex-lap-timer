import { Track } from '../types';
import { Play, Plus, Trash2, History, Info, Settings } from 'lucide-react';
import { formatTime } from '../utils/geo';
import { Flag } from 'lucide-react';
import { useI18n } from '../i18n';

interface Props {
    tracks: Track[];
    onSelect: (track: Track) => void;
    onDelete: (track: Track) => void;
    onViewDetails: (track: Track) => void;
    onCreateNew: () => void;
    onOpenSettings: () => void;
}

export function TrackList({ tracks, onSelect, onDelete, onViewDetails, onCreateNew, onOpenSettings }: Props) {
    const { t } = useI18n();

    return (
        <div className="app-shell-wide h-full overflow-y-auto overscroll-y-contain pb-[calc(var(--safe-bottom)+1rem)] pt-[calc(var(--safe-top)+0.5rem)] sm:pb-[calc(var(--safe-bottom)+1.5rem)]">
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 mb-5 sm:mb-8">
                <button
                    onClick={onOpenSettings}
                    className="p-3 apex-pill hover:bg-white/10 transition-colors"
                    title={t('trackList.settings')}
                >
                    <Settings size={20} />
                </button>
                <h1 className="min-w-0 text-lg sm:text-3xl font-bold tracking-tight text-center">{t('trackList.title')}</h1>
                <button
                    onClick={onCreateNew}
                    className="p-3 rounded-full bg-accent-green text-black hover:brightness-110 transition-colors shadow-lg shrink-0"
                    title={t('trackList.newTrack')}
                    aria-label={t('trackList.createNewTrack')}
                >
                    <Plus size={20} />
                </button>
            </div>

            {tracks.length === 0 ? (
                <div className="text-center py-16 text-text-secondary border border-white/10 rounded-3xl border-dashed apex-panel-muted">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Flag className="opacity-50" size={24} />
                    </div>
                    <p className="text-lg font-medium text-white mb-1">{t('trackList.emptyTitle')}</p>
                    <p className="text-sm">{t('trackList.emptyDescription')}</p>
                </div>
            ) : (
                <div className="space-y-3 sm:space-y-4">
                    {tracks.map(track => (
                        <div key={track.id} className="apex-panel p-4 sm:p-5 rounded-3xl flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between group hover:border-white/20 transition-colors">
                            <div className="min-w-0">
                                <h3 className="text-lg sm:text-xl font-medium mb-1 truncate">{track.name}</h3>
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-text-secondary">
                                    <span className="uppercase tracking-wider text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded-md text-white">{t(`track.types.${track.type}`)}</span>
                                    <span className="font-sans tabular-nums">{(track.totalDistance / 1000).toFixed(2)} {t('common.units.km')}</span>
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
                                    title={t('trackList.viewDetails')}
                                >
                                    <Info size={20} />
                                </button>
                                <button
                                    onClick={() => onDelete(track)}
                                    className="p-2.5 sm:p-3 text-text-secondary hover:text-accent-red hover:bg-accent-red/10 rounded-full transition-colors"
                                >
                                    <Trash2 size={20} />
                                </button>
                                <button
                                    onClick={() => onSelect(track)}
                                    className="p-3 sm:p-4 bg-accent-green text-black rounded-full hover:brightness-110 transition-colors shadow-lg"
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
