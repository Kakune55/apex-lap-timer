export interface TrackPoint {
    lat: number;
    lon: number;
    timeOffset: number;
    distance: number;
    delta?: number;
    speed?: number;
}

export interface Gate {
    lat: number;
    lon: number;
    heading: number;
    width: number;
    name?: string;
}

export interface Lap {
    id: string;
    time: number;
    points: TrackPoint[];
    date: number;
}

export interface Track {
    id: string;
    name: string;
    type: 'circuit' | 'sprint';
    startGate: Gate;
    finishGate: Gate;
    sectors?: Gate[];
    points: TrackPoint[];
    totalDistance: number;
    bestTime: number;
    history?: number[];
    laps?: Lap[];
    autoUpdateRecord?: boolean;
    updatedAt?: number;
}
