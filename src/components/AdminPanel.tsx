import { useEffect, useState } from 'react';
import { ArrowLeft, PencilLine, Plus, RefreshCw, Shield, Trash2, UserRound } from 'lucide-react';
import { createAdminUser, deleteAdminUser, listAdminUsers, updateAdminUser, type AdminUserRecord } from '../sync/auth';
import { useI18n } from '../i18n';

type Props = {
    currentUserId: string;
    onBack: () => void;
};

type FormState = {
    userId: string;
    displayName: string;
    password: string;
    dashboardAccess: boolean;
    isAdmin: boolean;
    isActive: boolean;
};

const EMPTY_FORM: FormState = {
    userId: '',
    displayName: '',
    password: '',
    dashboardAccess: false,
    isAdmin: false,
    isActive: true,
};

export function AdminPanel({ currentUserId, onBack }: Props) {
    const { t, formatDateTime } = useI18n();
    const [users, setUsers] = useState<AdminUserRecord[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [mode, setMode] = useState<'create' | 'edit'>('create');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const loadUsers = async (keepSelection = true) => {
        setIsLoading(true);
        setError(null);
        try {
            const nextUsers = await listAdminUsers();
            setUsers(nextUsers);
            if (keepSelection && selectedUserId) {
                const current = nextUsers.find((user) => user.userId === selectedUserId);
                if (current) {
                    applyUserToForm(current);
                    return;
                }
            }
            if (!keepSelection) {
                resetForm();
            }
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : t('admin.messages.loadFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyUserToForm = (user: AdminUserRecord) => {
        setMode('edit');
        setSelectedUserId(user.userId);
        setForm({
            userId: user.userId,
            displayName: user.displayName ?? '',
            password: '',
            dashboardAccess: user.dashboardAccess,
            isAdmin: user.isAdmin,
            isActive: user.isActive,
        });
        setNotice(null);
    };

    const resetForm = () => {
        setMode('create');
        setSelectedUserId(null);
        setForm(EMPTY_FORM);
        setNotice(null);
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        setNotice(null);

        try {
            if (mode === 'create') {
                const created = await createAdminUser({
                    userId: form.userId.trim(),
                    displayName: form.displayName.trim(),
                    password: form.password,
                    dashboardAccess: form.dashboardAccess,
                    isAdmin: form.isAdmin,
                    isActive: form.isActive,
                });
                setNotice(t('admin.messages.created'));
                await loadUsers(false);
                applyUserToForm(created);
                setUsers((prev) => {
                    const next = prev.filter((user) => user.userId !== created.userId);
                    return [created, ...next];
                });
            } else if (selectedUserId) {
                const updated = await updateAdminUser(selectedUserId, {
                    displayName: form.displayName.trim(),
                    password: form.password || undefined,
                    dashboardAccess: form.dashboardAccess,
                    isAdmin: form.isAdmin,
                    isActive: form.isActive,
                });
                setUsers((prev) => prev.map((user) => (user.userId === updated.userId ? updated : user)));
                applyUserToForm(updated);
                setNotice(t('admin.messages.updated'));
            }
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : t('admin.messages.saveFailed'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedUserId) {
            return;
        }

        const confirmed = window.confirm(t('admin.messages.confirmDelete', { userId: selectedUserId }));
        if (!confirmed) {
            return;
        }

        setIsSaving(true);
        setError(null);
        setNotice(null);
        try {
            await deleteAdminUser(selectedUserId);
            setUsers((prev) => prev.filter((user) => user.userId !== selectedUserId));
            resetForm();
            setNotice(t('admin.messages.deleted'));
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : t('admin.messages.deleteFailed'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggleDashboardAccess = () => {
        setForm((prev) => {
            const dashboardAccess = !prev.dashboardAccess;
            return {
                ...prev,
                dashboardAccess,
                isAdmin: dashboardAccess ? prev.isAdmin : false,
            };
        });
    };

    const handleToggleAdmin = () => {
        setForm((prev) => {
            const isAdmin = !prev.isAdmin;
            return {
                ...prev,
                isAdmin,
                dashboardAccess: isAdmin ? true : prev.dashboardAccess,
            };
        });
    };

    const handleToggleActive = () => {
        setForm((prev) => ({
            ...prev,
            isActive: !prev.isActive,
        }));
    };

    return (
        <div className="h-full overflow-hidden px-5 py-5 lg:px-7 lg:py-7">
            <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-5">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.32em] text-cyan-300">{t('admin.title')}</div>
                        <h1 className="mt-2 text-3xl font-semibold">{t('admin.subtitle')}</h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => void loadUsers()} className="rounded-2xl apex-btn-secondary px-4 py-3" disabled={isLoading || isSaving}>
                            <span className="flex items-center gap-2">
                                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                                {t('admin.actions.refresh')}
                            </span>
                        </button>
                        <button onClick={onBack} className="rounded-2xl apex-btn-secondary px-4 py-3">
                            <span className="flex items-center gap-2">
                                <ArrowLeft size={16} />
                                {t('admin.actions.back')}
                            </span>
                        </button>
                    </div>
                </div>

                <div className="grid min-h-0 grid-cols-[1.05fr_0.95fr] gap-5">
                    <section className="apex-panel flex min-h-0 flex-col rounded-[2rem] p-5">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">{t('admin.userList.title')}</div>
                            </div>
                            <button onClick={resetForm} className="rounded-2xl bg-accent-green px-4 py-2 text-sm font-bold text-black transition-colors hover:brightness-110">
                                <span className="flex items-center gap-2">
                                    <Plus size={16} />
                                    {t('admin.actions.newUser')}
                                </span>
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                            {isLoading ? (
                                <div className="rounded-[1.5rem] apex-panel-muted p-5 text-sm text-text-secondary">{t('admin.messages.loading')}</div>
                            ) : users.length === 0 ? (
                                <div className="rounded-[1.5rem] apex-panel-muted p-5 text-sm text-text-secondary">{t('admin.messages.empty')}</div>
                            ) : (
                                users.map((user) => {
                                    const isSelected = user.userId === selectedUserId;
                                    return (
                                        <button
                                            key={user.userId}
                                            onClick={() => applyUserToForm(user)}
                                            className={`w-full rounded-[1.5rem] border p-4 text-left transition-colors ${
                                                isSelected
                                                    ? 'border-accent-green bg-accent-green/8'
                                                    : 'border-white/8 bg-white/4 hover:bg-white/8'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/8 text-white">
                                                            <UserRound size={18} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-semibold">{user.displayName || user.userId}</div>
                                                            <div className="truncate text-xs text-text-secondary">{user.userId}</div>
                                                        </div>
                                                    </div>
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${user.dashboardAccess ? 'bg-accent-green/15 text-accent-green' : 'bg-white/8 text-white/50'}`}>
                                                            {t('admin.permissions.dashboard')}
                                                        </span>
                                                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${user.isAdmin ? 'bg-cyan-400/15 text-cyan-300' : 'bg-white/8 text-white/50'}`}>
                                                            {t('admin.permissions.admin')}
                                                        </span>
                                                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${user.isActive ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>
                                                            {user.isActive ? t('admin.status.active') : t('admin.status.disabled')}
                                                        </span>
                                                    </div>
                                                </div>
                                                {user.isAdmin ? <Shield size={16} className="shrink-0 text-cyan-300" /> : null}
                                            </div>
                                            <div className="mt-3 text-[11px] text-text-secondary">
                                                {t('admin.userList.updatedAt', { time: formatDateTime(user.updatedAt) })}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </section>

                    <section className="apex-panel min-h-0 overflow-y-auto rounded-[2rem] p-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-text-secondary">
                                    {mode === 'create' ? t('admin.editor.createTitle') : t('admin.editor.editTitle')}
                                </div>
                            </div>
                            {mode === 'edit' ? <PencilLine size={18} className="text-white/60" /> : <Plus size={18} className="text-white/60" />}
                        </div>

                        <div className="mt-5 space-y-4">
                            <label className="block space-y-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary">{t('admin.fields.userId')}</span>
                                <input
                                    value={form.userId}
                                    disabled={mode === 'edit'}
                                    onChange={(e) => setForm((prev) => ({ ...prev, userId: e.target.value }))}
                                    className="w-full rounded-2xl border border-white/12 bg-white/8 px-4 py-3 text-sm outline-none transition-colors focus:border-accent-green disabled:opacity-50"
                                />
                            </label>

                            <label className="block space-y-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary">{t('admin.fields.displayName')}</span>
                                <input
                                    value={form.displayName}
                                    onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
                                    className="w-full rounded-2xl border border-white/12 bg-white/8 px-4 py-3 text-sm outline-none transition-colors focus:border-accent-green"
                                />
                            </label>

                            <label className="block space-y-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary">
                                    {mode === 'create' ? t('admin.fields.password') : t('admin.fields.passwordOptional')}
                                </span>
                                <input
                                    type="password"
                                    value={form.password}
                                    onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                                    className="w-full rounded-2xl border border-white/12 bg-white/8 px-4 py-3 text-sm outline-none transition-colors focus:border-accent-green"
                                />
                            </label>

                            <div className="grid grid-cols-3 gap-3">
                                <button
                                    type="button"
                                    onClick={handleToggleDashboardAccess}
                                    className={`rounded-[1.25rem] border px-3 py-4 text-sm font-semibold transition-colors ${
                                        form.dashboardAccess
                                            ? 'border-accent-green bg-accent-green/10 text-accent-green'
                                            : 'border-white/10 bg-white/6 text-white/65'
                                    }`}
                                >
                                    {t('admin.permissions.dashboard')}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleToggleAdmin}
                                    className={`rounded-[1.25rem] border px-3 py-4 text-sm font-semibold transition-colors ${
                                        form.isAdmin
                                            ? 'border-accent-green bg-accent-green/10 text-accent-green'
                                            : 'border-white/10 bg-white/6 text-white/65'
                                    }`}
                                >
                                    {t('admin.permissions.admin')}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleToggleActive}
                                    className={`rounded-[1.25rem] border px-3 py-4 text-sm font-semibold transition-colors ${
                                        form.isActive
                                            ? 'border-accent-green bg-accent-green/10 text-accent-green'
                                            : 'border-white/10 bg-white/6 text-white/65'
                                    }`}
                                >
                                    {t('admin.status.active')}
                                </button>
                            </div>

                            {error ? <div className="rounded-2xl bg-rose-400/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
                            {notice ? <div className="rounded-2xl bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">{notice}</div> : null}

                            <div className="flex items-center gap-3 pt-2">
                                <button onClick={handleSave} disabled={isSaving} className="rounded-2xl bg-accent-green px-5 py-3 text-sm font-bold text-black transition-colors hover:brightness-110 disabled:opacity-60">
                                    {isSaving ? t('admin.actions.saving') : mode === 'create' ? t('admin.actions.create') : t('admin.actions.update')}
                                </button>
                                <button onClick={resetForm} className="rounded-2xl apex-btn-secondary px-5 py-3 text-sm">
                                    {t('admin.actions.reset')}
                                </button>
                                {mode === 'edit' ? (
                                    <button
                                        onClick={handleDelete}
                                        disabled={isSaving || selectedUserId === currentUserId}
                                        className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-5 py-3 text-sm font-bold text-rose-300 transition-colors hover:bg-rose-400/15 disabled:opacity-50"
                                    >
                                        <span className="flex items-center gap-2">
                                            <Trash2 size={16} />
                                            {t('admin.actions.delete')}
                                        </span>
                                    </button>
                                ) : null}
                            </div>

                            {mode === 'edit' && selectedUserId ? (
                                <div className="rounded-[1.5rem] apex-panel-muted p-4 text-xs leading-6 text-text-secondary">
                                    <div>{t('admin.editor.createdAt', { time: formatDateTime(users.find((user) => user.userId === selectedUserId)?.createdAt ?? Date.now()) })}</div>
                                    <div>{t('admin.editor.updatedAt', { time: formatDateTime(users.find((user) => user.userId === selectedUserId)?.updatedAt ?? Date.now()) })}</div>
                                    {selectedUserId === currentUserId ? <div className="mt-1 text-amber-300">{t('admin.editor.selfGuard')}</div> : null}
                                </div>
                            ) : null}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
