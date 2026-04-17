import { useCallback, useEffect, useState } from 'react';

export type AppRoute =
    | { name: 'home' }
    | { name: 'record' }
    | { name: 'track-details'; trackId: string }
    | { name: 'track-race'; trackId: string }
    | { name: 'dashboard' }
    | { name: 'admin' };

type NavigateOptions = {
    replace?: boolean;
};

const HOME_ROUTE: AppRoute = { name: 'home' };

function normalizeHashPath(hash: string) {
    const rawPath = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!rawPath) {
        return '/';
    }
    return rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
}

function decodeSegment(segment: string) {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

function buildUrlWithHash(path: string) {
    const url = new URL(window.location.href);
    url.hash = path;
    return url.toString();
}

export function parseAppRoute(hash: string): AppRoute {
    const normalizedPath = normalizeHashPath(hash);
    const [pathname] = normalizedPath.split('?');
    const segments = pathname.split('/').filter(Boolean).map(decodeSegment);

    if (segments.length === 0) {
        return HOME_ROUTE;
    }

    if (segments.length === 1) {
        if (segments[0] === 'record') {
            return { name: 'record' };
        }
        if (segments[0] === 'dashboard') {
            return { name: 'dashboard' };
        }
        if (segments[0] === 'admin') {
            return { name: 'admin' };
        }
        return HOME_ROUTE;
    }

    if (segments[0] === 'tracks' && segments[1]) {
        const trackId = segments[1];
        if (segments.length === 2) {
            return { name: 'track-details', trackId };
        }
        if (segments.length === 3 && segments[2] === 'race') {
            return { name: 'track-race', trackId };
        }
    }

    return HOME_ROUTE;
}

export function buildAppPath(route: AppRoute) {
    switch (route.name) {
        case 'home':
            return '/';
        case 'record':
            return '/record';
        case 'track-details':
            return `/tracks/${encodeURIComponent(route.trackId)}`;
        case 'track-race':
            return `/tracks/${encodeURIComponent(route.trackId)}/race`;
        case 'dashboard':
            return '/dashboard';
        case 'admin':
            return '/admin';
    }
}

export function readCurrentAppRoute() {
    if (typeof window === 'undefined') {
        return HOME_ROUTE;
    }
    return parseAppRoute(window.location.hash);
}

export function useAppRoute() {
    const [route, setRoute] = useState<AppRoute>(readCurrentAppRoute);

    useEffect(() => {
        if (!window.location.hash) {
            window.history.replaceState(window.history.state, '', buildUrlWithHash(buildAppPath(HOME_ROUTE)));
            setRoute(HOME_ROUTE);
        }

        const syncRoute = () => {
            setRoute(readCurrentAppRoute());
        };

        window.addEventListener('hashchange', syncRoute);
        window.addEventListener('popstate', syncRoute);

        return () => {
            window.removeEventListener('hashchange', syncRoute);
            window.removeEventListener('popstate', syncRoute);
        };
    }, []);

    const navigate = useCallback((nextRoute: AppRoute, options?: NavigateOptions) => {
        if (typeof window === 'undefined') {
            return;
        }

        const nextPath = buildAppPath(nextRoute);
        if (options?.replace) {
            window.history.replaceState(window.history.state, '', buildUrlWithHash(nextPath));
            setRoute(nextRoute);
            return;
        }

        if (window.location.hash === `#${nextPath}`) {
            setRoute(nextRoute);
            return;
        }

        window.location.hash = nextPath;
    }, []);

    const replace = useCallback((nextRoute: AppRoute) => navigate(nextRoute, { replace: true }), [navigate]);

    return {
        route,
        navigate,
        replace,
    };
}
