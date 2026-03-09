import { useState, useEffect, useRef } from 'react';
import { Track } from './types';
import { TrackList } from './components/TrackList';
import { RecordTrack } from './components/RecordTrack';
import { RaceMode } from './components/RaceMode';
import { TrackDetails } from './components/TrackDetails';
import { useGPS } from './hooks/useGPS';
import { Bug, Plus, Minus, Cloud, CloudOff, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { createCloudSync, SyncStatus } from './sync/cloudSync';

function DevTools() {
    const { simMode, simSpeed, toggleSimulation, setSimulationSpeed } = useGPS();
    const [isOpen, setIsOpen] = useState(false);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className={`fixed bottom-6 right-6 p-4 rounded-full shadow-2xl z-50 transition-colors ${
                    simMode ? 'bg-accent-green text-black' : 'bg-white/10 text-white hover:bg-white/20 backdrop-blur-md'
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

    const handleDeleteTrack = (id: string) => {
        persistTracks(tracksRef.current.filter((t) => t.id !== id));
        syncRef.current?.queueDelete(id, Date.now());
    };

    const handleSelectTrack = (track: Track) => {
        setSelectedTrack(track);
        setView('race');
    };

    const handleViewDetails = (track: Track) => {
        setSelectedTrack(track);
        setView('details');
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

    const debugEnabled =
        typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'true';

    return (
        <div className="min-h-screen bg-bg-color text-white selection:bg-white/20">
            <div className={`fixed bottom-6 right-24 z-40 flex items-center gap-2 rounded-2xl border border-white/15 bg-black/65 px-3 py-2 text-xs backdrop-blur-md shadow-xl transition-all duration-500 ${showSyncIndicator ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
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
                    onDelete={handleDeleteTrack}
                    onViewDetails={handleViewDetails}
                    onCreateNew={() => setView('record')}
                />
            )}
            {view === 'record' && (
                <RecordTrack
                    onSave={handleSaveTrack}
                    onCancel={() => setView('home')}
                />
            )}
            {view === 'details' && selectedTrack && (
                <TrackDetails
                    track={selectedTrack}
                    onBack={() => {
                        setView('home');
                        setSelectedTrack(null);
                    }}
                    onUpdateTrack={handleUpdateTrack}
                />
            )}
            {view === 'race' && selectedTrack && (
                <RaceMode
                    track={selectedTrack}
                    onBack={() => {
                        setView('home');
                        setSelectedTrack(null);
                    }}
                    onUpdateTrack={handleUpdateTrack}
                />
            )}
            {debugEnabled ? <DevTools /> : null}
        </div>
    );
}

