// Tipos para el Sistema Analítico de F1

export interface Corner {
  id: string;
  name: string;
  distance: number;
  angle: number;
  apexSpeed: number;
  class: 'Low' | 'Medium' | 'High';
  x: number;
  y: number;
}

export interface Circuit {
  id: string;
  name: string;
  length: number;
  corners: Corner[];
  pirelliData: {
    abrasion: number;
    grip: number;
    lateralStress: number;
    longitudinalStress: number;
  };
  weather: {
    trackTemp: number;
    ambientTemp: number;
    humidity: number;
    rainProbability: number;
  };
  profile: {
    downforceReq: number;
    brakingEnergy: number;
    tireWear: number;
    topSpeedImportance: number;
    lateralG: number;
  };
  profileSource?: 'curated' | 'derived';
}

export interface TelemetryPoint {
  time: number;
  distance: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  drs: boolean;
}

export interface Lap {
  number: number;
  time: number;
  fuelCorrectedTime: number;
  isCleanAir: boolean;
  tireCompound: 'Soft' | 'Medium' | 'Hard';
  tireAge: number;
  drsActive: boolean;
  gapToLeader?: number;
  sector1?: number;
  sector2?: number;
  sector3?: number;
}

export interface Driver {
  id: string;
  name: string;
  team: string;
  number: number;
  color: string;
}

export interface Team {
  id: string;
  name: string;
  basePace: number;
  variance: number;
  characteristics: {
    traction: number;
    downforce: number;
    drag: number;
    tireManagement: number;
    braking?: number;
  };
}

export interface MLInsight {
  team: string;
  machineImpact: number;
  driverImpact: number;
  shapValues: {
    feature: string;
    value: number;
  }[];
}

export interface SimulationResult {
  team: string;
  winProbability: number;
  poleProbability: number;
  expectedPace: number;
}

export interface DegradationCurve {
  tireAge: number[];
  pace: number[];
  compound: string;
}
