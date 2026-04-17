import { useEffect, useMemo, useState } from 'react';
import { Copy, LoaderCircle, Share2 } from 'lucide-react';
import { Track } from '../types';
import { createTrackShareCode } from '../utils/trackShare';
import { useI18n } from '../i18n';

interface Props {
    isOpen: boolean;
    track: Track;
    onClose: () => void;
}

type ShareFeedback = 'copied' | 'shared' | 'copyFailed' | 'shareFailed' | null;

export function TrackShareDialog({ isOpen, track, onClose }: Props) {
    const { t, formatDateTime } = useI18n();
    const [includeRecords, setIncludeRecords] = useState(true);
    const [shareText, setShareText] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<ShareFeedback>(null);

    const shareAvailable = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    const lapsCount = track.laps?.length ?? track.history?.length ?? 0;
    const summaryText = useMemo(
        () =>
            includeRecords
                ? t('share.summaryWithRecords', { count: lapsCount })
                : t('share.summaryTrackOnly'),
        [includeRecords, lapsCount, t],
    );

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        let cancelled = false;
        setFeedback(null);
        setError(null);
        setIsGenerating(true);

        void createTrackShareCode(track, includeRecords)
            .then((code) => {
                if (cancelled) {
                    return;
                }

                setShareText(
                    [
                        t('share.messageTitle', { track: track.name }),
                        t('share.messageMeta', {
                            mode: includeRecords ? t('share.includeRecordsOn') : t('share.includeRecordsOff'),
                            time: formatDateTime(Date.now()),
                        }),
                        '',
                        code,
                    ].join('\n'),
                );
            })
            .catch(() => {
                if (!cancelled) {
                    setError(t('share.errors.generateFailed'));
                    setShareText('');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsGenerating(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [formatDateTime, includeRecords, isOpen, t, track]);

    useEffect(() => {
        if (!isOpen) {
            setIncludeRecords(true);
            setShareText('');
            setIsGenerating(false);
            setError(null);
            setFeedback(null);
        }
    }, [isOpen]);

    const handleCopy = async () => {
        if (!shareText) {
            return;
        }

        try {
            await navigator.clipboard.writeText(shareText);
            setFeedback('copied');
        } catch {
            setFeedback('copyFailed');
        }
    };

    const handleSystemShare = async () => {
        if (!shareText || !shareAvailable) {
            return;
        }

        try {
            await navigator.share({
                title: t('share.messageTitle', { track: track.name }),
                text: shareText,
            });
            setFeedback('shared');
        } catch {
            setFeedback('shareFailed');
        }
    };

    const feedbackText =
        feedback === 'copied'
            ? t('share.feedback.copied')
            : feedback === 'shared'
            ? t('share.feedback.shared')
            : feedback === 'copyFailed'
            ? t('share.feedback.copyFailed')
            : feedback === 'shareFailed'
            ? t('share.feedback.shareFailed')
            : null;

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
                        <div className="text-xs font-bold uppercase tracking-widest text-text-secondary mb-2">{t('share.title')}</div>
                        <div className="text-lg font-semibold">{track.name}</div>
                        <p className="mt-2 text-sm text-text-secondary">{summaryText}</p>
                    </div>
                    <button onClick={onClose} className="apex-pill px-3 py-2 text-sm hover:bg-white/10 transition-colors">
                        {t('common.buttons.cancel')}
                    </button>
                </div>

                <label className="mt-5 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <input
                        type="checkbox"
                        checked={includeRecords}
                        onChange={(e) => setIncludeRecords(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[--accent-green]"
                    />
                    <div>
                        <div className="text-sm font-semibold">{t('share.includeRecords')}</div>
                        <div className="text-xs text-text-secondary mt-1">{t('share.includeRecordsHelp')}</div>
                    </div>
                </label>

                <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('share.code')}</div>
                        {isGenerating ? (
                            <div className="flex items-center gap-2 text-xs text-text-secondary">
                                <LoaderCircle size={14} className="animate-spin" />
                                {t('share.generating')}
                            </div>
                        ) : null}
                    </div>
                    <textarea
                        readOnly
                        value={shareText}
                        className="min-h-44 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs text-white/90 outline-none"
                    />
                    {error ? <div className="mt-2 text-xs text-accent-red">{error}</div> : null}
                    {feedbackText ? <div className="mt-2 text-xs text-accent-green">{feedbackText}</div> : null}
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                        onClick={handleCopy}
                        disabled={!shareText || isGenerating}
                        className="flex-1 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/15 disabled:opacity-50"
                    >
                        <span className="inline-flex items-center justify-center gap-2">
                            <Copy size={16} />
                            {t('share.copy')}
                        </span>
                    </button>
                    {shareAvailable ? (
                        <button
                            onClick={handleSystemShare}
                            disabled={!shareText || isGenerating}
                            className="flex-1 rounded-2xl bg-accent-green px-4 py-3 text-sm font-bold text-black transition-colors hover:brightness-110 disabled:opacity-50"
                        >
                            <span className="inline-flex items-center justify-center gap-2">
                                <Share2 size={16} />
                                {t('share.systemShare')}
                            </span>
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
