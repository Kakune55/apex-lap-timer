import { useEffect, useState } from 'react';

type ViewportMetrics = {
    width: number;
    height: number;
    isNarrow: boolean;
    isShort: boolean;
    mapOffsetY: number;
};

const FALLBACK_METRICS: ViewportMetrics = {
    width: 390,
    height: 844,
    isNarrow: false,
    isShort: false,
    mapOffsetY: 135,
};

function readViewportMetrics(): ViewportMetrics {
    if (typeof window === 'undefined') {
        return FALLBACK_METRICS;
    }

    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width ?? window.innerWidth);
    const height = Math.round(viewport?.height ?? window.innerHeight);
    const shortestSide = Math.min(width, height);
    const mapOffsetY = Math.round(
        Math.max(84, Math.min(150, Math.min(height * 0.16, shortestSide * 0.38))),
    );

    return {
        width,
        height,
        isNarrow: width < 390,
        isShort: height < 760,
        mapOffsetY,
    };
}

export function useViewportMetrics() {
    const [metrics, setMetrics] = useState<ViewportMetrics>(() => readViewportMetrics());

    useEffect(() => {
        const handleResize = () => {
            setMetrics(readViewportMetrics());
        };

        handleResize();
        const viewport = window.visualViewport;
        window.addEventListener('resize', handleResize);
        viewport?.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            viewport?.removeEventListener('resize', handleResize);
        };
    }, []);

    return metrics;
}
