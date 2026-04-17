import { AlertTriangle, ArrowLeft, LayoutDashboard, Monitor, Shield, UserRound } from 'lucide-react';
import { type SyncStatus } from '../sync/cloudSync';
import { SessionUser } from '../sync/auth';
import { useI18n } from '../i18n';
import { useViewportMetrics } from '../hooks/useViewportMetrics';

type Props = {
    authUser: SessionUser;
    tracksCount: number;
    syncStatus: SyncStatus;
    syncText: string;
    lastSyncText: string;
    onBackToMobile: () => void;
    onOpenAdmin: () => void;
};

export function DashboardView({
    authUser,
    tracksCount,
    syncStatus,
    syncText,
    lastSyncText,
    onBackToMobile,
    onOpenAdmin,
}: Props) {
    const { t } = useI18n();
    const viewport = useViewportMetrics();
    const isWideDevice = viewport.width >= 960 && viewport.width > viewport.height;

    if (!isWideDevice) {
        return (
            <div className="h-full overflow-y-auto px-6 py-8 lg:px-10 lg:py-10">
                <div className="mx-auto flex min-h-full max-w-3xl items-center justify-center">
                    <div className="apex-panel w-full max-w-xl rounded-4xl p-8 text-center">
                        <div className="mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-full bg-amber-400/10 text-amber-300">
                            <AlertTriangle size={34} />
                        </div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-text-secondary">
                            {t('dashboard.portrait.title')}
                        </div>
                        <h2 className="mt-3 text-3xl font-semibold">{t('dashboard.portrait.heading')}</h2>
                        <button onClick={onBackToMobile} className="mt-7 inline-flex items-center gap-2 rounded-2xl apex-btn-secondary px-5 py-3">
                            <ArrowLeft size={18} />
                            {t('dashboard.backToMobile')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-hidden px-5 py-5 lg:px-7 lg:py-7">
            <div className="grid h-full grid-cols-[280px_minmax(0,1fr)] gap-5">
                <aside className="apex-panel flex h-full flex-col rounded-4xl p-5">
                    <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.32em] text-accent-green">
                            APEX DESKTOP
                        </div>
                        <h1 className="mt-2 text-3xl font-semibold">{t('dashboard.title')}</h1>
                    </div>

                    <div className="mt-6 rounded-3xl apex-panel-muted p-4">
                        <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">
                            {t('dashboard.account')}
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8 text-white">
                                <UserRound size={22} />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-base font-semibold">{authUser.displayName || authUser.userId}</div>
                                <div className="truncate text-xs text-text-secondary">{authUser.userId}</div>
                            </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] ${authUser.dashboardAccess ? 'bg-accent-green/15 text-accent-green' : 'bg-white/8 text-white/55'}`}>
                                {t('dashboard.permissions.dashboard')}
                            </span>
                            <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] ${authUser.isAdmin ? 'bg-cyan-400/15 text-cyan-300' : 'bg-white/8 text-white/55'}`}>
                                {t('dashboard.permissions.admin')}
                            </span>
                        </div>
                    </div>

                    <div className="mt-4 space-y-3">
                        <button className="flex w-full items-center gap-3 rounded-[1.25rem] border border-white/12 bg-white/6 px-4 py-3 text-left text-sm font-medium text-white">
                            <LayoutDashboard size={18} className="text-accent-green" />
                            {t('dashboard.sections.overview')}
                        </button>
                        <button
                            onClick={authUser.isAdmin ? onOpenAdmin : undefined}
                            disabled={!authUser.isAdmin}
                            className={`flex w-full items-center gap-3 rounded-[1.25rem] border px-4 py-3 text-left text-sm font-medium transition-colors ${
                                authUser.isAdmin
                                    ? 'border-white/12 bg-white/6 text-white hover:bg-white/10'
                                    : 'border-white/8 bg-white/4 text-white/40'
                            }`}
                        >
                            <Shield size={18} className={authUser.isAdmin ? 'text-cyan-300' : 'text-white/30'} />
                            {t('dashboard.sections.admin')}
                        </button>
                        <button onClick={onBackToMobile} className="flex w-full items-center gap-3 rounded-[1.25rem] border border-white/12 bg-white/6 px-4 py-3 text-left text-sm font-medium text-white hover:bg-white/10 transition-colors">
                            <Monitor size={18} className="text-white/70" />
                            {t('dashboard.backToMobile')}
                        </button>
                    </div>

                    <div className="mt-auto rounded-3xl bg-black/35 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">
                            {t('dashboard.sync')}
                        </div>
                        <div className="mt-2 text-sm font-semibold">{syncText}</div>
                        <div className="mt-1 text-xs text-text-secondary">{t('dashboard.lastSync', { time: lastSyncText })}</div>
                        {syncStatus.pending > 0 ? (
                            <div className="mt-3 inline-flex rounded-full bg-white/8 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/80">
                                {t('dashboard.pendingTasks', { count: syncStatus.pending })}
                            </div>
                        ) : null}
                    </div>
                </aside>

                <main className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-5 overflow-hidden">
                    <section className="grid grid-cols-3 gap-4">
                        <div className="apex-panel rounded-[1.75rem] p-5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">{t('dashboard.cards.trackCount')}</div>
                            <div className="mt-3 text-4xl font-semibold lcd-text">{tracksCount}</div>
                            <div className="mt-2 text-xs text-text-secondary">{t('dashboard.cards.trackCountHint')}</div>
                        </div>
                        <div className="apex-panel rounded-[1.75rem] p-5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">{t('dashboard.cards.syncStatus')}</div>
                            <div className="mt-3 text-2xl font-semibold">{syncText}</div>
                            <div className="mt-2 text-xs text-text-secondary">{t('dashboard.lastSync', { time: lastSyncText })}</div>
                        </div>
                        <div className="apex-panel rounded-[1.75rem] p-5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">{t('dashboard.cards.adminAccess')}</div>
                            <div className="mt-3 text-2xl font-semibold">{authUser.isAdmin ? t('dashboard.status.enabled') : t('dashboard.status.disabled')}</div>
                            <div className="mt-2 text-xs text-text-secondary">{t('dashboard.cards.adminAccessHint')}</div>
                        </div>
                    </section>

                    <section className="grid min-h-0 grid-cols-[1.35fr_0.9fr] gap-5">
                        <div className="apex-panel flex min-h-0 flex-col rounded-4xl p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">{t('dashboard.sections.overview')}</div>
                                    <h2 className="mt-2 text-2xl font-semibold">{t('dashboard.workspaceTitle')}</h2>
                                </div>
                                {authUser.isAdmin ? (
                                    <button onClick={onOpenAdmin} className="rounded-2xl bg-accent-green px-4 py-2 text-sm font-bold text-black transition-colors hover:brightness-110">
                                        {t('dashboard.openAdmin')}
                                    </button>
                                ) : null}
                            </div>
                            <div className="mt-6 grid min-h-0 flex-1 grid-cols-2 gap-4">
                                <div className="rounded-3xl apex-panel-muted p-5">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">{t('dashboard.placeholders.liveFeed.title')}</div>
                                    <p className="mt-3 text-sm leading-6 text-text-secondary">{t('dashboard.placeholders.liveFeed.description')}</p>
                                </div>
                                <div className="rounded-3xl apex-panel-muted p-5">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">{t('dashboard.placeholders.analytics.title')}</div>
                                    <p className="mt-3 text-sm leading-6 text-text-secondary">{t('dashboard.placeholders.analytics.description')}</p>
                                </div>
                                <div className="col-span-2 rounded-3xl apex-panel-muted p-5">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">{t('dashboard.placeholders.professional.title')}</div>
                                    <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">{t('dashboard.placeholders.professional.description')}</p>
                                </div>
                            </div>
                        </div>

                        <div className="grid min-h-0 grid-rows-2 gap-5">
                            <div className="apex-panel rounded-4xl p-6">
                                <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">{t('dashboard.placeholders.modules.title')}</div>
                                <div className="mt-5 space-y-3">
                                    {['pitWall', 'events', 'exports'].map((key) => (
                                        <div key={key} className="rounded-[1.25rem] border border-white/8 bg-white/5 px-4 py-3">
                                            <div className="text-sm font-semibold">{t(`dashboard.placeholders.modules.items.${key}.title`)}</div>
                                            <div className="mt-1 text-xs leading-5 text-text-secondary">{t(`dashboard.placeholders.modules.items.${key}.description`)}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="apex-panel rounded-4xl p-6">
                                <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">{t('dashboard.placeholders.guidance.title')}</div>
                                <p className="mt-4 text-sm leading-6 text-text-secondary">{t('dashboard.placeholders.guidance.description')}</p>
                            </div>
                        </div>
                    </section>
                </main>
            </div>
        </div>
    );
}
