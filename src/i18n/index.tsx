import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

const LOCALE_STORAGE_KEY = 'apex_locale';

const messages = {
    en,
    'zh-CN': zhCN,
} as const;

export type Locale = keyof typeof messages;

type MessageTree = typeof en;
type Primitive = string | number | boolean | null;
type TranslationKey<T = MessageTree> = T extends Primitive
    ? never
    : {
          [K in Extract<keyof T, string>]: T[K] extends Primitive
              ? K
              : `${K}.${TranslationKey<T[K]>}`;
      }[Extract<keyof T, string>];

type TranslationValues = Record<string, string | number>;

type I18nContextValue = {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (key: TranslationKey | string, values?: TranslationValues) => string;
    formatDateTime: (timestamp: number) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const getBrowserLocale = (): Locale => {
    if (typeof window === 'undefined') {
        return 'en';
    }

    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'en' || saved === 'zh-CN') {
        return saved;
    }

    const [first] = window.navigator.languages;
    return first?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
};

const resolveMessage = (locale: Locale, key: string) => {
    const keys = key.split('.');
    let current: unknown = messages[locale];

    for (const part of keys) {
        if (!current || typeof current !== 'object' || !(part in current)) {
            current = undefined;
            break;
        }
        current = (current as Record<string, unknown>)[part];
    }

    if (typeof current === 'string') {
        return current;
    }

    let fallback: unknown = messages.en;
    for (const part of keys) {
        if (!fallback || typeof fallback !== 'object' || !(part in fallback)) {
            return key;
        }
        fallback = (fallback as Record<string, unknown>)[part];
    }

    return typeof fallback === 'string' ? fallback : key;
};

const interpolate = (template: string, values?: TranslationValues) => {
    if (!values) {
        return template;
    }

    return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
        const value = values[token];
        return value === undefined ? `{{${token}}}` : String(value);
    });
};

export function I18nProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(getBrowserLocale);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
        }
        document.documentElement.lang = locale;
    }, [locale]);

    const value = useMemo<I18nContextValue>(() => {
        const t = (key: TranslationKey | string, values?: TranslationValues) =>
            interpolate(resolveMessage(locale, key), values);

        const formatDateTime = (timestamp: number) =>
            new Intl.DateTimeFormat(locale, {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            }).format(timestamp);

        return {
            locale,
            setLocale: setLocaleState,
            t,
            formatDateTime,
        };
    }, [locale]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
    const context = useContext(I18nContext);
    if (!context) {
        throw new Error('useI18n must be used within I18nProvider');
    }
    return context;
}
