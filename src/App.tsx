import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo, type FormEvent } from 'react';
import { Track } from './types';
import { TrackList } from './components/TrackList';
import { useGPS, getGPSRefreshRateHz, setGPSRefreshRateHz, isGPSRefreshRateSupported } from './hooks/useGPS';
import { Bug, Plus, Minus, Cloud, CloudOff, RefreshCw, AlertTriangle, CheckCircle2, Settings, X, LogOut, Download, Upload } from 'lucide-react';
import { createCloudSync, SyncConflict, SyncConflictChoice, SyncStatus } from './sync/cloudSync';
import { AuthError, getCurrentUser, login, logout, SessionUser } from './sync/auth';
import { Locale, useI18n } from './i18n';
import { parseTrackShareInput } from './utils/trackShare';
import { type AppRoute, useAppRoute } from './navigation/appRouter';
import { loadStoredTracks, saveStoredTracks } from './storage/trackStore';
import { formatTime } from './utils/geo';

const WAKE_LOCK_STORAGE_KEY = 'apex_keep_screen_awake';
type WakeLockErrorKey = 'unsupported' | 'failed';
type LoginErrorKey = 'missingCredentials' | 'invalidCredentials' | 'loginFailed';

type WakeLockNavigator = Navigator & {
    wakeLock?: {
        request(type: 'screen'): Promise<WakeLockSentinel>;
    };
};

const RecordTrack = lazy(() =>
    import('./components/RecordTrack').then((module) => ({ default: module.RecordTrack })),
);
const RaceMode = lazy(() =>
    import('./components/RaceMode').then((module) => ({ default: module.RaceMode })),
);
const TrackDetails = lazy(() =>
    import('./components/TrackDetails').then((module) => ({ default: module.TrackDetails })),
);
const AdminPanel = lazy(() =>
    import('./components/AdminPanel').then((module) => ({ default: module.AdminPanel })),
);
const DashboardView = lazy(() =>
    import('./components/DashboardView').then((module) => ({ default: module.DashboardView })),
);
const ImportShareDialog = lazy(() =>
    import('./components/ImportShareDialog').then((module) => ({ default: module.ImportShareDialog })),
);

function getRouteTitle(route: AppRoute, trackName: string | null, t: ReturnType<typeof useI18n>['t']) {
    switch (route.name) {
        case 'home':
            return t('trackList.title');
        case 'record':
            return t('recordTrack.title');
        case 'track-details':
            return trackName ?? t('trackList.viewDetails');
        case 'track-race':
            return trackName ?? t('trackList.title');
        case 'dashboard':
            return t('dashboard.title');
        case 'admin':
            return t('admin.title');
    }
}

function DevTools() {
    const { simMode, simSpeed, toggleSimulation, setSimulationSpeed } = useGPS();
    const [isOpen, setIsOpen] = useState(false);
    const { t } = useI18n();

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className={`fixed app-floating-action p-4 rounded-full shadow-2xl z-50 transition-colors ${
                    simMode ? 'bg-accent-green text-black' : 'apex-pill text-white hover:bg-white/20'
                }`}
            >
                <Bug size={24} />
            </button>
        );
    }

    return (
        <div className="fixed app-floating-action bg-black/90 backdrop-blur-xl border border-white/10 p-5 rounded-3xl shadow-2xl z-50 w-64 max-w-[calc(100vw-var(--safe-left)-var(--safe-right)-2rem)]">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-sm uppercase tracking-widest text-text-secondary">{t('devTools.title')}</h3>
                <button onClick={() => setIsOpen(false)} className="text-white/50 hover:text-white">✕</button>
            </div>

            <button
                onClick={toggleSimulation}
                className={`w-full py-3 rounded-xl font-bold mb-4 transition-colors ${
                    simMode ? 'bg-accent-green text-black' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
            >
                {simMode ? t('devTools.disableSimulator') : t('devTools.enableSimulator')}
            </button>

            {simMode && (
                <div className="bg-white/5 p-4 rounded-2xl">
                    <div className="text-xs font-bold text-text-secondary mb-2 uppercase tracking-widest text-center">{t('devTools.simSpeed')}</div>
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

function ViewFallback({ label }: { label: string }) {
    return (
        <div className="h-full flex items-center justify-center px-5">
            <div className="apex-panel rounded-3xl px-6 py-5 text-sm text-text-secondary">{label}</div>
        </div>
    );
}

export default function App() {
    const { locale, setLocale, t, formatDateTime } = useI18n();
    const { route, navigate, replace } = useAppRoute();
    const [tracks, setTracks] = useState<Track[]>([]);
    const [tracksReady, setTracksReady] = useState(false);
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
    const [keepScreenAwake, setKeepScreenAwake] = useState(() => {
        if (typeof window === 'undefined') {
            return false;
        }
        return window.localStorage.getItem(WAKE_LOCK_STORAGE_KEY) === 'true';
    });
    const [wakeLockActive, setWakeLockActive] = useState(false);
    const [wakeLockError, setWakeLockError] = useState<WakeLockErrorKey | null>(null);
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);
    const [pendingDeleteTrack, setPendingDeleteTrack] = useState<Track | null>(null);
    const [authUser, setAuthUser] = useState<SessionUser | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [loginUsername, setLoginUsername] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginBusy, setLoginBusy] = useState(false);
    const [loginError, setLoginError] = useState<LoginErrorKey | null>(null);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [importBusy, setImportBusy] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [forceSyncBusy, setForceSyncBusy] = useState<'upload' | 'download' | null>(null);
    const [pendingSyncConflict, setPendingSyncConflict] = useState<SyncConflict | null>(null);
    const syncConflictResolverRef = useRef<((choice: SyncConflictChoice) => void) | null>(null);

    const normalizeTracks = useCallback((incoming: Track[]) => {
        const now = Date.now();
        return incoming.map((track) => ({
            ...track,
            updatedAt: track.updatedAt ?? now,
        }));
    }, []);

    const persistTracks = useCallback((nextTracks: Track[]) => {
        const normalized = normalizeTracks(nextTracks);
        tracksRef.current = normalized;
        setTracks(normalized);
        void saveStoredTracks(normalized).catch((error) => {
            console.error('Failed to persist tracks', error);
        });
    }, [normalizeTracks]);

    const handleSyncConflict = useCallback((conflict: SyncConflict) => {
        return new Promise<SyncConflictChoice>((resolve) => {
            syncConflictResolverRef.current = resolve;
            setPendingSyncConflict(conflict);
        });
    }, []);

    const resolveSyncConflict = (choice: SyncConflictChoice) => {
        syncConflictResolverRef.current?.(choice);
        syncConflictResolverRef.current = null;
        setPendingSyncConflict(null);
    };

    const formatConflictTrackSummary = (track: Track | null, updatedAt: number) => {
        if (!track) {
            return t('app.syncConflict.deleted');
        }

        const laps = track.laps?.length ?? track.history?.length ?? 0;
        return t('app.syncConflict.summary', {
            updatedAt: updatedAt ? formatDateTime(updatedAt) : t('app.sync.relative.never'),
            laps,
            best: formatTime(track.bestTime),
            distance: (track.totalDistance / 1000).toFixed(2),
        });
    };

    const routeTrackId =
        route.name === 'track-details' || route.name === 'track-race'
            ? route.trackId
            : null;

    const activeTrack = useMemo(() => {
        if (!routeTrackId) {
            return null;
        }
        return tracks.find((track) => track.id === routeTrackId) ?? null;
    }, [routeTrackId, tracks]);

    useEffect(() => {
        let disposed = false;
        void (async () => {
            try {
                const storedTracks = await loadStoredTracks();
                if (!disposed) {
                    persistTracks(storedTracks);
                    setTracksReady(true);
                }

                const user = await getCurrentUser();
                if (!disposed) {
                    setAuthUser(user);
                }
            } catch (e) {
                if (!disposed) {
                    console.error('Failed to initialize app data', e);
                    setTracksReady(true);
                }
            } finally {
                if (!disposed) {
                    setAuthLoading(false);
                }
            }
        })();

        return () => {
            disposed = true;
        };
    }, [persistTracks]);

    useEffect(() => {
        if (!authUser) {
            if (syncRef.current) {
                syncRef.current.stop();
                syncRef.current = null;
            }
            syncConflictResolverRef.current?.('skip');
            syncConflictResolverRef.current = null;
            setPendingSyncConflict(null);
            setSyncStatus({
                state: 'idle',
                pending: 0,
                lastSyncAt: null,
                error: null,
            });
            return;
        }

        const syncManager = createCloudSync({
            getTracks: () => tracksRef.current,
            setTracks: (merged) => {
                persistTracks(merged);
            },
            setStatus: (status) => {
                setSyncStatus(status);
            },
            onConflict: handleSyncConflict,
        });
        syncRef.current = syncManager;
        syncManager.start();

        return () => {
            syncManager.stop();
            syncRef.current = null;
            syncConflictResolverRef.current?.('skip');
            syncConflictResolverRef.current = null;
            if (hideSyncTimeoutRef.current !== null) {
                clearTimeout(hideSyncTimeoutRef.current);
                hideSyncTimeoutRef.current = null;
            }
        };
    }, [authUser, handleSyncConflict, persistTracks]);

    useEffect(() => {
        if (!tracksReady || !routeTrackId) {
            return;
        }
        if (!activeTrack) {
            replace({ name: 'home' });
        }
    }, [activeTrack, replace, routeTrackId, tracksReady]);

    useEffect(() => {
        if (authLoading || !authUser) {
            return;
        }

        if (route.name === 'dashboard' && !authUser.dashboardAccess) {
            replace({ name: 'home' });
            return;
        }

        if (route.name === 'admin' && !authUser.isAdmin) {
            replace(authUser.dashboardAccess ? { name: 'dashboard' } : { name: 'home' });
        }
    }, [authLoading, authUser, replace, route.name]);

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

    useEffect(() => {
        setIsSettingsOpen(false);
    }, [route.name]);

    useEffect(() => {
        const title = getRouteTitle(route, activeTrack?.name ?? null, t);
        document.title = `${title} | Apex Lap Timer`;
    }, [activeTrack?.name, route, t]);

    const handleSaveTrack = (track: Track) => {
        const newTrack = { ...track, updatedAt: Date.now() };
        persistTracks([...tracksRef.current, newTrack]);
        syncRef.current?.queueUpsert(newTrack);
        navigate({ name: 'home' });
    };

    const requestDeleteTrack = (track: Track) => {
        setPendingDeleteTrack(track);
    };

    const confirmDeleteTrack = () => {
        if (!pendingDeleteTrack) {
            return;
        }
        const id = pendingDeleteTrack.id;
        persistTracks(tracksRef.current.filter((track) => track.id !== id));
        syncRef.current?.queueDelete(id, Date.now());
        setPendingDeleteTrack(null);
        if (routeTrackId === id) {
            replace({ name: 'home' });
        }
    };

    const openImportDialog = () => {
        setImportError(null);
        setIsSettingsOpen(false);
        setIsImportOpen(true);
    };

    const handleImportSharedTrack = async (input: string) => {
        if (!input.trim()) {
            setImportError(t('share.import.errors.empty'));
            return;
        }

        setImportBusy(true);
        setImportError(null);

        try {
            const parsed = await parseTrackShareInput(input);
            const importedTrack = {
                ...parsed.track,
                updatedAt: Date.now(),
            };
            persistTracks([importedTrack, ...tracksRef.current]);
            syncRef.current?.queueUpsert(importedTrack);
            setIsImportOpen(false);
            navigate({ name: 'track-details', trackId: importedTrack.id });
        } catch (error) {
            const key =
                error instanceof Error && error.message === 'decompression_unsupported'
                    ? 'unsupported'
                    : 'invalid';
            setImportError(t(`share.import.errors.${key}`));
        } finally {
            setImportBusy(false);
        }
    };

    const handleBackToHome = () => {
        navigate({ name: 'home' });
    };

    const handleUpdateTrack = (updatedTrack: Track) => {
        const next = { ...updatedTrack, updatedAt: Date.now() };
        const newTracks = tracksRef.current.map((track) => (track.id === next.id ? next : track));
        persistTracks(newTracks);
        syncRef.current?.queueUpsert(next);
    };

    const formatSyncTime = (timestamp: number | null) => {
        if (!timestamp) {
            return t('app.sync.relative.never');
        }

        const deltaMs = Date.now() - timestamp;
        if (deltaMs < 60000) {
            return t('app.sync.relative.justNow');
        }

        const minutes = Math.floor(deltaMs / 60000);
        if (minutes < 60) {
            return t('app.sync.relative.minutesAgo', { count: minutes });
        }

        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return t('app.sync.relative.hoursAgo', { count: hours });
        }

        const days = Math.floor(hours / 24);
        return t('app.sync.relative.daysAgo', { count: days });
    };

    const syncText =
        syncStatus.state === 'syncing'
            ? t('app.sync.states.syncing')
            : syncStatus.state === 'offline'
            ? t('app.sync.states.offline')
            : syncStatus.state === 'error'
            ? t('app.sync.states.error')
            : t('app.sync.states.idle');

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

    const releaseWakeLock = useCallback(async () => {
        if (!wakeLockRef.current) {
            setWakeLockActive(false);
            return;
        }

        try {
            await wakeLockRef.current.release();
        } catch {
            // Ignore release failures and keep the UI state consistent.
        } finally {
            wakeLockRef.current = null;
            setWakeLockActive(false);
        }
    }, []);

    const requestWakeLock = useCallback(async () => {
        const wakeLockApi = (navigator as WakeLockNavigator).wakeLock;

        if (!wakeLockApi) {
            setWakeLockActive(false);
            setWakeLockError('unsupported');
            return;
        }

        if (document.visibilityState !== 'visible') {
            return;
        }

        try {
            const sentinel = await wakeLockApi.request('screen');
            sentinel.onrelease = () => {
                setWakeLockActive(false);
            };
            wakeLockRef.current = sentinel;
            setWakeLockActive(!sentinel.released);
            setWakeLockError(null);
        } catch {
            setWakeLockActive(false);
            setWakeLockError('failed');
        }
    }, []);

    useEffect(() => {
        if (!keepScreenAwake) {
            setWakeLockError(null);
            void releaseWakeLock();
            return;
        }

        void requestWakeLock();

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && keepScreenAwake) {
                void requestWakeLock();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            void releaseWakeLock();
        };
    }, [keepScreenAwake, requestWakeLock, releaseWakeLock]);

    const handleWakeLockToggle = () => {
        setKeepScreenAwake((prev) => {
            const next = !prev;
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(WAKE_LOCK_STORAGE_KEY, String(next));
            }
            if (!next) {
                setWakeLockError(null);
            }
            return next;
        });
    };

    const handleEnterDashboard = () => {
        if (!authUser?.dashboardAccess) {
            return;
        }
        setIsSettingsOpen(false);
        navigate({ name: 'dashboard' });
    };

    const handleBackToMobile = () => {
        navigate({ name: 'home' });
    };

    const handleOpenAdmin = () => {
        if (!authUser?.isAdmin) {
            return;
        }
        navigate({ name: 'admin' });
    };

    const handleForceUploadLocal = async () => {
        if (!syncRef.current || forceSyncBusy) {
            return;
        }
        if (!window.confirm(t('app.settings.syncTools.confirmUpload'))) {
            return;
        }
        setForceSyncBusy('upload');
        try {
            await syncRef.current.forceUploadLocal();
        } finally {
            setForceSyncBusy(null);
        }
    };

    const handleForceDownloadCloud = async () => {
        if (!syncRef.current || forceSyncBusy) {
            return;
        }
        if (!window.confirm(t('app.settings.syncTools.confirmDownload'))) {
            return;
        }
        setForceSyncBusy('download');
        try {
            await syncRef.current.forceDownloadCloud();
        } finally {
            setForceSyncBusy(null);
        }
    };

    const gpsRateSupported = isGPSRefreshRateSupported();

    const handleLogin = async (e: FormEvent) => {
        e.preventDefault();
        if (!loginUsername.trim() || !loginPassword) {
            setLoginError('missingCredentials');
            return;
        }

        setLoginBusy(true);
        setLoginError(null);
        try {
            const user = await login(loginUsername.trim(), loginPassword);
            setAuthUser(user);
            setLoginPassword('');
        } catch (error) {
            setLoginError(error instanceof AuthError && error.code === 'invalid_credentials' ? 'invalidCredentials' : 'loginFailed');
        } finally {
            setLoginBusy(false);
        }
    };

    const handleLogout = async () => {
        await logout();
        setAuthUser(null);
        setLoginPassword('');
        setLoginError(null);
        setIsSettingsOpen(false);
        navigate({ name: 'home' });
    };

    const loginErrorText =
        loginError === 'missingCredentials'
            ? t('app.auth.missingCredentials')
            : loginError === 'invalidCredentials'
            ? t('app.auth.errors.invalidCredentials')
            : loginError === 'loginFailed'
            ? t('app.auth.errors.loginFailed')
            : null;

    if (authLoading) {
        return (
            <div className="h-full bg-bg-color text-white flex items-center justify-center">
                <div className="apex-panel rounded-3xl px-6 py-5 text-sm text-text-secondary">{t('app.auth.checkingSession')}</div>
            </div>
        );
    }

    if (!authUser) {
        return (
            <div className="h-full bg-bg-color text-white flex items-center justify-center px-5">
                <form onSubmit={handleLogin} className="w-full max-w-sm apex-panel rounded-3xl p-6 space-y-4">
                    <div>
                        <h2 className="text-2xl font-bold">{t('app.auth.title')}</h2>
                        <p className="text-sm text-text-secondary mt-1">{t('app.auth.subtitle')}</p>
                    </div>

                    <label className="block space-y-1">
                        <span className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('app.auth.username')}</span>
                        <input
                            value={loginUsername}
                            onChange={(e) => setLoginUsername(e.target.value)}
                            autoComplete="username"
                            className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-sm outline-none focus:border-accent-green"
                        />
                    </label>

                    <label className="block space-y-1">
                        <span className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('app.auth.password')}</span>
                        <input
                            type="password"
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            autoComplete="current-password"
                            className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-sm outline-none focus:border-accent-green"
                        />
                    </label>

                    {loginErrorText ? <div className="text-xs text-accent-red font-bold">{loginErrorText}</div> : null}

                    <button
                        type="submit"
                        disabled={loginBusy}
                        className="w-full apex-btn-primary py-2.5 disabled:opacity-60"
                    >
                        {loginBusy ? t('app.auth.signingIn') : t('app.auth.signIn')}
                    </button>
                </form>
            </div>
        );
    }

    return (
        <div className="h-full bg-bg-color text-white selection:bg-white/20 overflow-hidden">
            <div className={`fixed app-floating-status z-40 flex items-center gap-2 rounded-2xl apex-glass px-3 py-2 text-xs shadow-xl transition-all duration-500 ${showSyncIndicator ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
                <Cloud size={14} className="text-white/60" />
                <SyncIcon size={14} className={`${syncAccentClass} ${syncStatus.state === 'syncing' ? 'animate-spin' : ''}`} />
                <span className="min-w-0 truncate font-medium text-white/90">{syncText}</span>
                {syncStatus.pending > 0 ? (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">{t('app.sync.queued', { count: syncStatus.pending })}</span>
                ) : null}
                <span className="text-[10px] text-white/50 compact-hide">{formatSyncTime(syncStatus.lastSyncAt)}</span>
            </div>

            {route.name === 'home' && (
                <TrackList
                    tracks={tracks}
                    onSelect={(track) => navigate({ name: 'track-race', trackId: track.id })}
                    onDelete={requestDeleteTrack}
                    onViewDetails={(track) => navigate({ name: 'track-details', trackId: track.id })}
                    onCreateNew={() => navigate({ name: 'record' })}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                />
            )}

            {route.name === 'record' && (
                <Suspense fallback={<ViewFallback label={t('recordTrack.title')} />}>
                    <RecordTrack
                        onSave={handleSaveTrack}
                        onCancel={handleBackToHome}
                    />
                </Suspense>
            )}

            {route.name === 'track-details' && activeTrack && (
                <Suspense fallback={<ViewFallback label={activeTrack.name} />}>
                    <TrackDetails
                        track={activeTrack}
                        onBack={handleBackToHome}
                        onUpdateTrack={handleUpdateTrack}
                    />
                </Suspense>
            )}

            {route.name === 'track-race' && activeTrack && (
                <Suspense fallback={<ViewFallback label={activeTrack.name} />}>
                    <RaceMode
                        track={activeTrack}
                        onBack={handleBackToHome}
                        onUpdateTrack={handleUpdateTrack}
                    />
                </Suspense>
            )}

            {route.name === 'dashboard' && authUser.dashboardAccess && (
                <Suspense fallback={<ViewFallback label={t('dashboard.title')} />}>
                    <DashboardView
                        authUser={authUser}
                        tracksCount={tracks.length}
                        syncStatus={syncStatus}
                        syncText={syncText}
                        lastSyncText={formatSyncTime(syncStatus.lastSyncAt)}
                        onBackToMobile={handleBackToMobile}
                        onOpenAdmin={handleOpenAdmin}
                    />
                </Suspense>
            )}

            {route.name === 'admin' && authUser.isAdmin && (
                <Suspense fallback={<ViewFallback label={t('admin.title')} />}>
                    <AdminPanel
                        currentUserId={authUser.userId}
                        onBack={() => navigate({ name: 'dashboard' })}
                    />
                </Suspense>
            )}

            {isSettingsOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setIsSettingsOpen(false)}>
                    <div
                        className="absolute top-[calc(var(--safe-top)+3.5rem)] left-4 right-4 sm:left-6 sm:right-auto sm:w-90 max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-5rem)] overflow-y-auto apex-panel rounded-3xl p-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary flex items-center gap-2">
                                <Settings size={14} /> {t('app.settings.title')}
                            </h3>
                            <button onClick={() => setIsSettingsOpen(false)} className="p-2 apex-pill hover:bg-white/10 transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-5">
                            <div className="apex-panel-muted rounded-2xl p-4 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('app.settings.signedIn')}</div>
                                    <div className="mt-1 min-w-0 truncate text-xs text-white/90">{authUser.displayName || authUser.userId}</div>
                                    {(authUser.dashboardAccess || authUser.isAdmin) && (
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            {authUser.dashboardAccess && (
                                                <span className="rounded-full bg-accent-green/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-accent-green">
                                                    {t('app.settings.permissionDashboard')}
                                                </span>
                                            )}
                                            {authUser.isAdmin && (
                                                <span className="rounded-full bg-cyan-400/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-300">
                                                    {t('app.settings.permissionAdmin')}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors shrink-0"
                                    aria-label={t('common.buttons.logout')}
                                    title={t('common.buttons.logout')}
                                >
                                    <LogOut size={18} />
                                </button>
                            </div>

                            <div className="apex-panel-muted rounded-2xl p-4 space-y-3">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('app.settings.desktopMode')}</div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleEnterDashboard}
                                        disabled={!authUser.dashboardAccess}
                                        className="flex-1 rounded-xl bg-accent-green px-4 py-3 text-sm font-bold text-black transition-colors hover:brightness-110 disabled:opacity-40"
                                    >
                                        {route.name === 'dashboard' || route.name === 'admin' ? t('app.settings.desktopModeCurrent') : t('app.settings.enterDesktop')}
                                    </button>
                                    {(route.name === 'dashboard' || route.name === 'admin') ? (
                                        <button
                                            onClick={() => {
                                                setIsSettingsOpen(false);
                                                handleBackToMobile();
                                            }}
                                            className="flex-1 rounded-xl bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/15"
                                        >
                                            {t('app.settings.backToMobile')}
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            <div className="apex-panel-muted rounded-2xl p-4 space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-text-secondary font-bold uppercase tracking-widest text-[10px]">{t('app.settings.locationRefreshRate')}</span>
                                    <span className="font-sans tabular-nums text-white">{gpsHz.toFixed(1)} {t('common.units.hz')}</span>
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
                            </div>

                            <div className="apex-panel-muted rounded-2xl p-4 space-y-3">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('app.settings.trackShare.title')}</div>
                                <p className="text-[10px] text-text-secondary">{t('app.settings.trackShare.description')}</p>
                                <button
                                    onClick={openImportDialog}
                                    className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/15"
                                >
                                    <span className="inline-flex items-center gap-2">
                                        <Download size={16} />
                                        {t('app.settings.trackShare.import')}
                                    </span>
                                </button>
                            </div>

                            <div className="apex-panel-muted rounded-2xl p-4 space-y-3">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('app.settings.syncTools.title')}</div>
                                <p className="text-[10px] text-text-secondary">{t('app.settings.syncTools.description')}</p>
                                <div className="grid grid-cols-1 gap-2">
                                    <button
                                        onClick={handleForceUploadLocal}
                                        disabled={forceSyncBusy !== null}
                                        className="w-full rounded-xl bg-accent-green px-4 py-3 text-sm font-bold text-black transition-colors hover:brightness-110 disabled:opacity-50"
                                    >
                                        <span className="inline-flex items-center gap-2">
                                            <Upload size={16} />
                                            {forceSyncBusy === 'upload' ? t('app.settings.syncTools.running') : t('app.settings.syncTools.uploadLocal')}
                                        </span>
                                    </button>
                                    <button
                                        onClick={handleForceDownloadCloud}
                                        disabled={forceSyncBusy !== null}
                                        className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/15 disabled:opacity-50"
                                    >
                                        <span className="inline-flex items-center gap-2">
                                            <Download size={16} />
                                            {forceSyncBusy === 'download' ? t('app.settings.syncTools.running') : t('app.settings.syncTools.downloadCloud')}
                                        </span>
                                    </button>
                                </div>
                            </div>

                            <div className="apex-panel-muted rounded-2xl p-4 space-y-3">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('app.settings.language')}</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['en', 'zh-CN'] as Locale[]).map((language) => (
                                        <button
                                            key={language}
                                            onClick={() => setLocale(language)}
                                            className={`rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${
                                                locale === language
                                                    ? 'bg-accent-green text-black border-accent-green'
                                                    : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
                                            }`}
                                        >
                                            {t(`common.languageNames.${language}`)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="apex-panel-muted rounded-2xl p-4 flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('app.settings.debugTools')}</div>
                                </div>
                                <button
                                    onClick={handleDebugToggle}
                                    className={`w-14 h-8 rounded-full border transition-colors ${debugEnabled ? 'bg-accent-green border-accent-green' : 'bg-white/10 border-white/20'}`}
                                    aria-label={t('app.settings.toggleDebugTools')}
                                >
                                    <span className={`block h-6 w-6 rounded-full bg-white transition-transform ${debugEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
                                </button>
                            </div>

                            <div className="apex-panel-muted rounded-2xl p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('app.settings.keepScreenAwake')}</div>
                                    </div>
                                    <button
                                        onClick={handleWakeLockToggle}
                                        className={`w-14 h-8 rounded-full border transition-colors ${keepScreenAwake ? 'bg-accent-green border-accent-green' : 'bg-white/10 border-white/20'}`}
                                        aria-label={t('app.settings.toggleKeepScreenAwake')}
                                    >
                                        <span className={`block h-6 w-6 rounded-full bg-white transition-transform ${keepScreenAwake ? 'translate-x-7' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                                <p className="text-[10px] text-text-secondary">
                                    {keepScreenAwake
                                        ? wakeLockActive
                                            ? t('app.settings.wakeLock.active')
                                            : t('app.settings.wakeLock.enabling')
                                        : t('app.settings.wakeLock.off')}
                                </p>
                                {wakeLockError ? <p className="text-[10px] text-accent-red">{t(`app.settings.wakeLock.${wakeLockError}`)}</p> : null}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {pendingDeleteTrack && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setPendingDeleteTrack(null)}>
                    <div className="apex-panel w-full max-w-sm max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-2rem)] overflow-y-auto rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
                        <div className="text-xs font-bold uppercase tracking-widest text-text-secondary mb-2">{t('app.deleteTrack.title')}</div>
                        <div className="text-lg font-semibold mb-1 truncate">{pendingDeleteTrack.name}</div>
                        <p className="text-sm text-text-secondary mb-5">{t('app.deleteTrack.description')}</p>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setPendingDeleteTrack(null)}
                                className="flex-1 apex-btn-secondary py-2.5 rounded-xl"
                            >
                                {t('common.buttons.cancel')}
                            </button>
                            <button
                                onClick={confirmDeleteTrack}
                                className="flex-1 py-2.5 rounded-xl font-bold bg-accent-red/90 text-white hover:bg-accent-red transition-colors"
                            >
                                {t('common.buttons.delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {pendingSyncConflict && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4">
                    <div className="apex-panel w-full max-w-sm max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-2rem)] overflow-y-auto rounded-3xl p-6">
                        <div className="text-xs font-bold uppercase tracking-widest text-text-secondary mb-2">{t('app.syncConflict.title')}</div>
                        <div className="text-lg font-semibold mb-1 truncate">
                            {pendingSyncConflict.localTrack?.name || pendingSyncConflict.remoteTrack?.name || pendingSyncConflict.trackId}
                        </div>
                        <p className="text-sm text-text-secondary mb-5">{t('app.syncConflict.description')}</p>
                        <div className="mb-5 grid grid-cols-1 gap-2 text-xs">
                            <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
                                <div className="mb-1 font-bold uppercase tracking-widest text-text-secondary">{t('app.syncConflict.local')}</div>
                                <div className="text-white/85">{formatConflictTrackSummary(pendingSyncConflict.localTrack, pendingSyncConflict.localUpdatedAt)}</div>
                            </div>
                            <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
                                <div className="mb-1 font-bold uppercase tracking-widest text-text-secondary">{t('app.syncConflict.cloud')}</div>
                                <div className="text-white/85">{formatConflictTrackSummary(pendingSyncConflict.remoteTrack, pendingSyncConflict.remoteUpdatedAt)}</div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                            <button
                                onClick={() => resolveSyncConflict('local')}
                                className="w-full rounded-xl bg-accent-green px-4 py-3 text-sm font-bold text-black transition-colors hover:brightness-110"
                            >
                                {t('app.syncConflict.keepLocal')}
                            </button>
                            <button
                                onClick={() => resolveSyncConflict('remote')}
                                className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/15"
                            >
                                {pendingSyncConflict.remoteDeleted ? t('app.syncConflict.acceptDelete') : t('app.syncConflict.useCloud')}
                            </button>
                            <button
                                onClick={() => resolveSyncConflict('skip')}
                                className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-text-secondary transition-colors hover:bg-white/5"
                            >
                                {t('common.buttons.skip')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {debugEnabled ? <DevTools /> : null}

            {isImportOpen ? (
                <Suspense fallback={null}>
                    <ImportShareDialog
                        isOpen={isImportOpen}
                        isImporting={importBusy}
                        error={importError}
                        onClose={() => {
                            if (importBusy) {
                                return;
                            }
                            setImportError(null);
                            setIsImportOpen(false);
                        }}
                        onImport={handleImportSharedTrack}
                    />
                </Suspense>
            ) : null}
        </div>
    );
}
