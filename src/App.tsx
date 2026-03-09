import { useState, useEffect, useRef } from 'react';
import { Track } from './types';
import { TrackList } from './components/TrackList';
import { RecordTrack } from './components/RecordTrack';
import { RaceMode } from './components/RaceMode';
import { TrackDetails } from './components/TrackDetails';
import { useGPS } from './hooks/useGPS';
import { Bug, Plus, Minus } from 'lucide-react';
import { createCloudSync, SyncStatus } from './sync/cloudSync';

function DevTools() {
    const { simMode, simSpeed, toggleSimulation, setSimulationSpeed } = useGPS();
    const [isOpen, setIsOpen] = useState(false);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className={`fixed bottom-6 right-6 p-4 rounded-full shadow-2xl z-50 transition-colors ${
                    simMode ? 'bg-[var(--accent-green)] text-black' : 'bg-white/10 text-white hover:bg-white/20 backdrop-blur-md'
                }`}
            >
                <Bug size={24} />
            </button>
        );
    }

    return (
        <div className="fixed bottom-6 right-6 bg-black/90 backdrop-blur-xl border border-white/10 p-5 rounded-3xl shadow-2xl z-50 w-64">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-sm uppercase tracking-widest text-[var(--text-secondary)]">Dev Tools</h3>
                <button onClick={() => setIsOpen(false)} className="text-white/50 hover:text-white">✕</button>
            </div>

            <button
                onClick={toggleSimulation}
                className={`w-full py-3 rounded-xl font-bold mb-4 transition-colors ${
                    simMode ? 'bg-[var(--accent-green)] text-black' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
            >
                {simMode ? 'Disable Simulator' : 'Enable Simulator'}
            </button>

            {simMode && (
                <div className="bg-white/5 p-4 rounded-2xl">
                    <div className="text-xs font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-widest text-center">Sim Speed</div>
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
        };
    }, []);

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

    const syncText =
        syncStatus.state === 'syncing'
            ? 'Syncing cloud...'
            : syncStatus.state === 'offline'
            ? 'Offline mode'
            : syncStatus.state === 'error'
            ? 'Sync failed, retrying'
            : 'Cloud synced';

    return (
        <div className="min-h-screen bg-[var(--bg-color)] text-white selection:bg-white/20">
            <div className="fixed top-4 left-4 z-50 bg-black/60 backdrop-blur-md border border-white/10 rounded-full px-3 py-1 text-xs font-medium">
                {syncText}
                {syncStatus.pending > 0 ? ` (${syncStatus.pending} queued)` : ''}
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
            <DevTools />
        </div>
    );
}
