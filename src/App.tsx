import { useState, useEffect, useRef } from 'react';
import { Track } from './types';
import { TrackList } from './components/TrackList';
import { RecordTrack } from './components/RecordTrack';
import { RaceMode } from './components/RaceMode';
import { TrackDetails } from './components/TrackDetails';
import { useGPS, getGPSRefreshRateHz, setGPSRefreshRateHz, isGPSRefreshRateSupported } from './hooks/useGPS';
import { Bug, Plus, Minus, Cloud, CloudOff, RefreshCw, AlertTriangle, CheckCircle2, Settings, X } from 'lucide-react';
import { createCloudSync, SyncStatus } from './sync/cloudSync';

function DevTools() {
    const { simMode, simSpeed, toggleSimulation, setSimulationSpeed } = useGPS();
    const [isOpen, setIsOpen] = useState(false);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className={`fixed bottom-6 right-6 p-4 rounded-full shadow-2xl z-50 transition-colors ${
                    simMode ? 'bg-accent-green text-black' : 'apex-pill text-white hover:bg-white/20'
                }`}
            >
                <Bug size={24} />
            </button>
        );
    }

    return (
        <div className="fixed bottom-6 right-6 bg-black/90 backdrop-blur-xl border border-white/10 p-5 rounded-3xl shadow-2xl z-50 w-64">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-sm uppercase tracking-widest text-text-secondary">Dev Tools</h3>
                <button onClick={() => setIsOpen(false)} className="text-white/50 hover:text-white">✕</button>
            </div>

            <button
                onClick={toggleSimulation}
                className={`w-full py-3 rounded-xl font-bold mb-4 transition-colors ${
                    simMode ? 'bg-accent-green text-black' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
            >
                {simMode ? 'Disable Simulator' : 'Enable Simulator'}
            </button>

            {simMode && (
                <div className="bg-white/5 p-4 rounded-2xl">
                    <div className="text-xs font-bold text-text-secondary mb-2 uppercase tracking-widest text-center">Sim Speed</div>
                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => setSimulationSpeed(simSpeed - 10)}
                            className="p-2 bg-white/10 rounded-full hover:bg-white/20 active:scale-95 transition-all"
                        >
                            <Minus size={16} />
                        </button>
                        <div className="font-sans text-xl font-bold w-16 text-center tabular-nums">{simSpeed}</div>
                        <button
                            onClick={() => setSimulationSpeed(simSpeed + 10)}
                            className="p-2 bg-white/10 rounded-full hover:bg-white/20 active:scale-95 transition-all"
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function App() {
    const [view, setView] = useState<'home' | 'record' | 'race' | 'details'>('home');
    const [tracks, setTracks] = useState<Track[]>([]);
    const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>({
        state: 'idle',
        pending: 0,
        lastSyncAt: null,
        error: null,
    });

    const tracksRef = useRef<Track[]>([]);
    const syncRef = useRef<ReturnType<typeof createCloudSync> | null>(null);
    const hideSyncTimeoutRef = useRef<number | null>(null);
    const [showSyncIndicator, setShowSyncIndicator] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [gpsHz, setGpsHz] = useState(getGPSRefreshRateHz());
    const [debugEnabled, setDebugEnabled] = useState(() => {
        if (typeof window === 'undefined') {
            return false;
        }
        const queryDebug = new URLSearchParams(window.location.search).get('debug') === 'true';
        const savedDebug = window.localStorage.getItem('apex_debug') === 'true';
        return queryDebug || savedDebug;
    });
    const [pendingDeleteTrack, setPendingDeleteTrack] = useState<Track | null>(null);

    const normalizeTracks = (incoming: Track[]) => {
        const now = Date.now();
        return incoming.map((track) => ({
            ...track,
            updatedAt: track.updatedAt ?? now,
        }));
    };

    const persistTracks = (nextTracks: Track[]) => {
        const normalized = normalizeTracks(nextTracks);
        tracksRef.current = normalized;
        setTracks(normalized);
        localStorage.setItem('apex_tracks', JSON.stringify(normalized));
        setSelectedTrack((prev) => {
            if (!prev) {
                return null;
            }
            return normalized.find((track) => track.id === prev.id) ?? null;
        });
    };

    useEffect(() => {
        const saved = localStorage.getItem('apex_tracks');
        if (saved) {
            try {
                persistTracks(JSON.parse(saved));
            } catch (e) {
                console.error('Failed to parse tracks', e);
            }
        }

        const syncManager = createCloudSync({
            getTracks: () => tracksRef.current,
            setTracks: (merged) => {
                persistTracks(merged);
            },
            setStatus: (status) => {
                setSyncStatus(status);
            },
        });
        syncRef.current = syncManager;
        syncManager.start();

        return () => {
            syncManager.stop();
            if (hideSyncTimeoutRef.current !== null) {
                clearTimeout(hideSyncTimeoutRef.current);
                hideSyncTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (hideSyncTimeoutRef.current !== null) {
            clearTimeout(hideSyncTimeoutRef.current);
            hideSyncTimeoutRef.current = null;
        }

        if (syncStatus.state !== 'idle') {
            setShowSyncIndicator(true);
            return;
        }

        hideSyncTimeoutRef.current = window.setTimeout(() => {
            setShowSyncIndicator(false);
        }, 5000);

        return () => {
            if (hideSyncTimeoutRef.current !== null) {
                clearTimeout(hideSyncTimeoutRef.current);
                hideSyncTimeoutRef.current = null;
            }
        };
    }, [syncStatus.state]);

    const handleSaveTrack = (track: Track) => {
        const newTrack = { ...track, updatedAt: Date.now() };
        persistTracks([...tracksRef.current, newTrack]);
        syncRef.current?.queueUpsert(newTrack);
        setView('home');
    };

    const requestDeleteTrack = (track: Track) => {
        setPendingDeleteTrack(track);
    };

    const confirmDeleteTrack = () => {
        if (!pendingDeleteTrack) {
            return;
        }
        const id = pendingDeleteTrack.id;
        persistTracks(tracksRef.current.filter((t) => t.id !== id));
        syncRef.current?.queueDelete(id, Date.now());
        setPendingDeleteTrack(null);
    };

    const handleSelectTrack = (track: Track) => {
        setSelectedTrack(track);
        setView('race');
    };

    const handleViewDetails = (track: Track) => {
        setSelectedTrack(track);
        setView('details');
    };

    const handleBackToHome = () => {
        setView('home');
        setSelectedTrack(null);
    };

    const handleUpdateTrack = (updatedTrack: Track) => {
        const next = { ...updatedTrack, updatedAt: Date.now() };
        const newTracks = tracksRef.current.map((t) => (t.id === next.id ? next : t));
        persistTracks(newTracks);
        syncRef.current?.queueUpsert(next);
        if (selectedTrack?.id === updatedTrack.id) {
            setSelectedTrack(next);
        }
    };

    const formatSyncTime = (timestamp: number | null) => {
        if (!timestamp) {
            return 'never';
        }

        const deltaMs = Date.now() - timestamp;
        if (deltaMs < 60000) {
            return 'just now';
        }

        const minutes = Math.floor(deltaMs / 60000);
        if (minutes < 60) {
            return `${minutes}m ago`;
        }

        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours}h ago`;
        }

        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    const syncText =
        syncStatus.state === 'syncing'
            ? 'Syncing to cloud'
            : syncStatus.state === 'offline'
            ? 'Offline mode active'
            : syncStatus.state === 'error'
            ? 'Sync paused, retry queued'
            : 'Cloud up to date';

    const SyncIcon =
        syncStatus.state === 'syncing'
            ? RefreshCw
            : syncStatus.state === 'offline'
            ? CloudOff
            : syncStatus.state === 'error'
            ? AlertTriangle
            : CheckCircle2;

    const syncAccentClass =
        syncStatus.state === 'syncing'
            ? 'text-cyan-300'
            : syncStatus.state === 'offline'
            ? 'text-amber-300'
            : syncStatus.state === 'error'
            ? 'text-rose-300'
            : 'text-emerald-300';

    const handleSetGpsHz = (nextHz: number) => {
        setGPSRefreshRateHz(nextHz);
        setGpsHz(getGPSRefreshRateHz());
    };

    const handleDebugToggle = () => {
        setDebugEnabled((prev) => {
            const next = !prev;
            if (typeof window !== 'undefined') {
                window.localStorage.setItem('apex_debug', String(next));
            }
            return next;
        });
    };

    const gpsRateSupported = isGPSRefreshRateSupported();

    return (
        <div className="h-full bg-bg-color text-white selection:bg-white/20 overflow-hidden">
            <div className={`fixed bottom-6 right-24 z-40 flex items-center gap-2 rounded-2xl apex-glass px-3 py-2 text-xs shadow-xl transition-all duration-500 ${showSyncIndicator ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
                <Cloud size={14} className="text-white/60" />
                <SyncIcon size={14} className={`${syncAccentClass} ${syncStatus.state === 'syncing' ? 'animate-spin' : ''}`} />
                <span className="font-medium text-white/90">{syncText}</span>
                {syncStatus.pending > 0 ? (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">{syncStatus.pending} queued</span>
                ) : null}
                <span className="text-[10px] text-white/50">{formatSyncTime(syncStatus.lastSyncAt)}</span>
            </div>
            {view === 'home' && (
                <TrackList
                    tracks={tracks}
                    onSelect={handleSelectTrack}
                    onDelete={requestDeleteTrack}
                    onViewDetails={handleViewDetails}
                    onCreateNew={() => setView('record')}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                />
            )}
            {view === 'record' && (
                <RecordTrack
                    onSave={handleSaveTrack}
                    onCancel={handleBackToHome}
                />
            )}
            {view === 'details' && selectedTrack && (
                <TrackDetails
                    track={selectedTrack}
                    onBack={handleBackToHome}
                    onUpdateTrack={handleUpdateTrack}
                />
            )}
            {view === 'race' && selectedTrack && (
                <RaceMode
                    track={selectedTrack}
                    onBack={handleBackToHome}
                    onUpdateTrack={handleUpdateTrack}
                />
            )}
            {isSettingsOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setIsSettingsOpen(false)}>
                    <div
                        className="absolute top-[calc(var(--safe-top)+3.5rem)] left-4 right-4 sm:left-6 sm:right-auto sm:w-90 apex-panel rounded-3xl p-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary flex items-center gap-2">
                                <Settings size={14} /> Settings
                            </h3>
                            <button onClick={() => setIsSettingsOpen(false)} className="p-2 apex-pill hover:bg-white/10 transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-5">
                            <div className="apex-panel-muted rounded-2xl p-4 space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-text-secondary font-bold uppercase tracking-widest text-[10px]">Location Refresh Rate</span>
                                    <span className="font-sans tabular-nums text-white">{gpsHz.toFixed(1)} Hz</span>
                                </div>
                                <input
                                    type="range"
                                    min={0.2}
                                    max={2}
                                    step={0.1}
                                    value={gpsHz}
                                    disabled={!gpsRateSupported}
                                    onChange={(e) => handleSetGpsHz(Number(e.target.value))}
                                    className="w-full accent-[--accent-green] disabled:opacity-40"
                                />
                                <p className="text-[10px] text-text-secondary">
                                    {gpsRateSupported ? 'Applied immediately. Real GPS rate may still be capped by device/browser (often around 1Hz).' : 'Not supported on this device/browser.'}
                                </p>
                            </div>

                            <div className="apex-panel-muted rounded-2xl p-4 flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Debug Tools</div>
                                    <div className="text-xs text-white/80 mt-1">Show simulator and diagnostics panel</div>
                                </div>
                                <button
                                    onClick={handleDebugToggle}
                                    className={`w-14 h-8 rounded-full border transition-colors ${debugEnabled ? 'bg-accent-green border-accent-green' : 'bg-white/10 border-white/20'}`}
                                    aria-label="Toggle debug tools"
                                >
                                    <span className={`block h-6 w-6 rounded-full bg-white transition-transform ${debugEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {pendingDeleteTrack && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setPendingDeleteTrack(null)}>
                    <div className="apex-panel w-full max-w-sm rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
                        <div className="text-xs font-bold uppercase tracking-widest text-text-secondary mb-2">Confirm Delete</div>
                        <div className="text-lg font-semibold mb-1 truncate">{pendingDeleteTrack.name}</div>
                        <p className="text-sm text-text-secondary mb-5">This track and its lap history will be removed.</p>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setPendingDeleteTrack(null)}
                                className="flex-1 apex-btn-secondary py-2.5 rounded-xl"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDeleteTrack}
                                className="flex-1 py-2.5 rounded-xl font-bold bg-accent-red/90 text-white hover:bg-accent-red transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {debugEnabled ? <DevTools /> : null}
        </div>
    );
}

