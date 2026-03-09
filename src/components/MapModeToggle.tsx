import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layers } from 'lucide-react';
import { MapViewMode } from '../utils/map';

interface Props {
    mode: MapViewMode;
    onToggle: () => void;
    className?: string;
}

const MODE_LABELS: Record<MapViewMode, string> = {
    'dt-absolute': 'DT基准',
    'dt-trend': 'DT变化',
    'speed-heatmap': '速度热力图'
};

export function MapModeToggle({ mode, onToggle, className = "" }: Props) {
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        if (isExpanded) {
            const timer = setTimeout(() => setIsExpanded(false), 2500);
            return () => clearTimeout(timer);
        }
    }, [isExpanded, mode]);

    const handleClick = () => {
        onToggle();
        setIsExpanded(true);
    };

    return (
        <motion.button
            layout
            onClick={handleClick}
            className={`flex items-center bg-black/50 backdrop-blur-md rounded-full border border-white/10 text-accent-green overflow-hidden whitespace-nowrap shadow-lg ${className}`}
            initial={false}
            animate={{
                width: isExpanded ? 'auto' : '48px',
            }}
            transition={{ 
                type: 'spring', 
                stiffness: 400, 
                damping: 30,
                layout: { duration: 0.3 }
            }}
            style={{ height: '48px', minWidth: '48px' }}
        >
            <div className="w-12 h-12 flex items-center justify-center shrink-0">
                <Layers size={22} />
            </div>
            <AnimatePresence mode="wait">
                {isExpanded && (
                    <motion.span
                        key={mode}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ duration: 0.2 }}
                        className="text-[10px] font-black uppercase tracking-widest pr-5"
                    >
                        {MODE_LABELS[mode]}
                    </motion.span>
                )}
            </AnimatePresence>
        </motion.button>
    );
}


