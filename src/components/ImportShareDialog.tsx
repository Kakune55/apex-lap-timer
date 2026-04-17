import { useEffect, useState } from 'react';
import { ClipboardPaste, Download, LoaderCircle } from 'lucide-react';
import { useI18n } from '../i18n';

interface Props {
    isOpen: boolean;
    isImporting: boolean;
    error: string | null;
    onClose: () => void;
    onImport: (input: string) => Promise<void>;
}

export function ImportShareDialog({ isOpen, isImporting, error, onClose, onImport }: Props) {
    const { t } = useI18n();
    const [input, setInput] = useState('');
    const [pasteFeedback, setPasteFeedback] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setInput('');
            setPasteFeedback(null);
        }
    }, [isOpen]);

    const handlePaste = async () => {
        try {
            const clipboardText = await navigator.clipboard.readText();
            setInput(clipboardText);
            setPasteFeedback(t('share.import.pasted'));
        } catch {
            setPasteFeedback(t('share.import.pasteFailed'));
        }
    };

    const handleImport = async () => {
        await onImport(input);
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4" onClick={onClose}>
            <div
                className="apex-panel w-full max-w-lg max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-2rem)] overflow-y-auto rounded-3xl p-6"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="text-xs font-bold uppercase tracking-widest text-text-secondary mb-2">{t('share.import.title')}</div>
                        <div className="text-lg font-semibold">{t('share.import.heading')}</div>
                        <p className="mt-2 text-sm text-text-secondary">{t('share.import.description')}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="apex-pill shrink-0 min-w-16 px-3 py-2 text-sm whitespace-nowrap hover:bg-white/10 transition-colors"
                    >
                        {t('common.buttons.cancel')}
                    </button>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3">
                    <div className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('share.import.code')}</div>
                    <button
                        onClick={handlePaste}
                        className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-white/15"
                    >
                        <span className="inline-flex items-center gap-2">
                            <ClipboardPaste size={14} />
                            {t('share.import.paste')}
                        </span>
                    </button>
                </div>

                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t('share.import.placeholder')}
                    className="mt-3 min-h-48 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs text-white/90 outline-none focus:border-white/20"
                />

                {pasteFeedback ? <div className="mt-2 text-xs text-text-secondary">{pasteFeedback}</div> : null}
                {error ? <div className="mt-2 text-xs text-accent-red">{error}</div> : null}

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                        onClick={onClose}
                        className="flex-1 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/15"
                    >
                        {t('common.buttons.cancel')}
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={isImporting || !input.trim()}
                        className="flex-1 rounded-2xl bg-accent-green px-4 py-3 text-sm font-bold text-black transition-colors hover:brightness-110 disabled:opacity-50"
                    >
                        <span className="inline-flex items-center justify-center gap-2">
                            {isImporting ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
                            {isImporting ? t('share.import.importing') : t('share.import.confirm')}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}
