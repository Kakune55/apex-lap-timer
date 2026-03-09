import { useMemo, useState } from 'react';
import { Lap } from '../types';
import { 
    AreaChart, 
    Area, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ResponsiveContainer,
    ReferenceLine,
    Legend,
    Brush
} from 'recharts';
import { Activity, Zap, Maximize2 } from 'lucide-react';

interface Props {
    lap: Lap;
}

export function LapAnalysisCharts({ lap }: Props) {
    const chartData = useMemo(() => {
        if (!lap.points || lap.points.length < 3) return [];

        return lap.points.map((p, i) => {
            if (i === 0 || i === lap.points.length - 1) {
                return {
                    distance: Math.round(p.distance),
                    speed: Math.round((p.speed || 0) * 3.6),
                    longG: 0,
                    latG: 0,
                };
            }

            const prev = lap.points[i - 1];
            const next = lap.points[i + 1];
            
            // 1. Longitudinal G (Speed change)
            let longG = 0;
            const dtLong = (p.timeOffset - prev.timeOffset) / 1000;
            if (dtLong > 0 && p.speed !== undefined && prev.speed !== undefined) {
                const dv = p.speed - prev.speed;
                longG = (dv / dtLong) / 9.81;
            }

            // 2. Lateral G (Heading change)
            // Use simple Cartesian approximation for local heading
            let latG = 0;
            const dtLat = (next.timeOffset - prev.timeOffset) / 1000;
            if (dtLat > 0 && p.speed !== undefined) {
                const dx1 = (p.lon - prev.lon) * Math.cos(p.lat * Math.PI / 180);
                const dy1 = (p.lat - prev.lat);
                const heading1 = Math.atan2(dx1, dy1);

                const dx2 = (next.lon - p.lon) * Math.cos(p.lat * Math.PI / 180);
                const dy2 = (next.lat - p.lat);
                const heading2 = Math.atan2(dx2, dy2);

                let dHeading = heading2 - heading1;
                // Normalize to [-PI, PI]
                while (dHeading > Math.PI) dHeading -= 2 * Math.PI;
                while (dHeading < -Math.PI) dHeading += 2 * Math.PI;

                const omega = dHeading / dtLat; // rad/s
                latG = (p.speed * omega) / 9.81;
            }

            return {
                distance: Math.round(p.distance),
                speed: Math.round((p.speed || 0) * 3.6), // km/h
                longG: Number(longG.toFixed(2)),
                latG: Number(latG.toFixed(2)),
                totalG: Number(Math.sqrt(longG * longG + latG * latG).toFixed(2)),
            };
        });
    }, [lap.points]);

    if (chartData.length === 0) return null;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between px-2">
                <div className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest flex items-center gap-2">
                    <Maximize2 size={12} /> Use slider below to zoom
                </div>
            </div>

            {/* Speed Chart */}
            <div className="bg-[var(--card-bg)] p-4 rounded-3xl border border-white/5">
                <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs font-bold uppercase tracking-widest mb-4">
                    <Activity size={14} className="text-[var(--accent-green)]" />
                    Speed (km/h)
                </div>
                <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} syncId="lapAnalysis">
                            <defs>
                                <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--accent-green)" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="var(--accent-green)" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                            <XAxis 
                                dataKey="distance" 
                                stroke="rgba(255,255,255,0.2)"
                                fontSize={9}
                                tickFormatter={(val) => `${val}m`}
                                minTickGap={50}
                            />
                            <YAxis 
                                stroke="rgba(255,255,255,0.3)" 
                                fontSize={10}
                                tickFormatter={(val) => `${val}`}
                                domain={['auto', 'auto']}
                            />
                            <Tooltip 
                                contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '12px', fontSize: '10px' }}
                                labelStyle={{ color: 'var(--text-secondary)' }}
                                itemStyle={{ color: 'var(--accent-green)' }}
                                formatter={(val) => [`${val} km/h`, 'Speed']}
                                labelFormatter={(val) => `${val}m`}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="speed" 
                                stroke="var(--accent-green)" 
                                fillOpacity={1} 
                                fill="url(#colorSpeed)" 
                                strokeWidth={2}
                                isAnimationActive={false}
                            />
                            <Brush 
                                dataKey="distance" 
                                height={20} 
                                stroke="var(--accent-green)" 
                                fill="rgba(0,0,0,0.5)"
                                travellerWidth={10}
                                gap={10}
                                tickFormatter={() => ''}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Combined G-Force Chart */}
            <div className="bg-[var(--card-bg)] p-4 rounded-3xl border border-white/5">
                <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs font-bold uppercase tracking-widest mb-4">
                    <Zap size={14} className="text-[var(--accent-red)]" />
                    G-Force Analysis
                </div>
                <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} syncId="lapAnalysis">
                            <defs>
                                <linearGradient id="colorLong" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--accent-red)" stopOpacity={0.2}/>
                                    <stop offset="95%" stopColor="var(--accent-red)" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorLat" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/>
                                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#FBBF24" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#FBBF24" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                            <XAxis 
                                dataKey="distance" 
                                stroke="rgba(255,255,255,0.2)"
                                fontSize={9}
                                tickFormatter={(val) => `${val}m`}
                                minTickGap={50}
                            />
                            <YAxis 
                                stroke="rgba(255,255,255,0.3)" 
                                fontSize={10}
                                domain={[-1.5, 1.5]}
                                ticks={[-1.5, -1, -0.5, 0, 0.5, 1, 1.5]}
                            />
                            <Tooltip 
                                contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '12px', fontSize: '10px' }}
                                labelStyle={{ color: 'var(--text-secondary)' }}
                                labelFormatter={(val) => `${val}m`}
                            />
                            <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px' }} />
                            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                            
                            <Area 
                                name="Total G"
                                type="monotone" 
                                dataKey="totalG" 
                                stroke="#FBBF24" 
                                fillOpacity={1} 
                                fill="url(#colorTotal)" 
                                strokeWidth={1}
                                strokeDasharray="5 5"
                                isAnimationActive={false}
                            />
                            <Area 
                                name="Long G"
                                type="monotone" 
                                dataKey="longG" 
                                stroke="var(--accent-red)" 
                                fillOpacity={1} 
                                fill="url(#colorLong)" 
                                strokeWidth={2}
                                isAnimationActive={false}
                            />
                            <Area 
                                name="Lat G"
                                type="monotone" 
                                dataKey="latG" 
                                stroke="#3B82F6" 
                                fillOpacity={1} 
                                fill="url(#colorLat)" 
                                strokeWidth={2}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
                <div className="mt-2 flex justify-between text-[8px] font-bold uppercase tracking-tighter text-[var(--text-secondary)] px-2">
                    <div className="flex gap-4">
                        <span className="text-[var(--accent-red)]">Red: Long G</span>
                        <span className="text-[#3B82F6]">Blue: Lat G</span>
                        <span className="text-[#FBBF24]">Yellow: Total G</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
