// Curated F1 circuit profiles. Values are 0-100 scores and reflect the
// general consensus of the F1 paddock based on Pirelli briefings, FIA setup
// guides and historical telemetry. Used as the source of truth in the
// CircuitMapping module; the geometric formula is only a fallback for circuits
// not in this catalog.

export interface CuratedProfile {
  downforceReq: number;
  brakingEnergy: number;
  tireWear: number;
  topSpeedImportance: number;
  lateralG: number;
}

export const CURATED_PROFILES: Record<string, CuratedProfile> = {
  monza:         { downforceReq: 15, brakingEnergy: 65, tireWear: 30, topSpeedImportance: 95, lateralG: 35 },
  monaco:        { downforceReq: 95, brakingEnergy: 80, tireWear: 30, topSpeedImportance: 10, lateralG: 45 },
  spa:           { downforceReq: 45, brakingEnergy: 55, tireWear: 60, topSpeedImportance: 85, lateralG: 75 },
  silverstone:   { downforceReq: 75, brakingEnergy: 60, tireWear: 80, topSpeedImportance: 55, lateralG: 92 },
  suzuka:        { downforceReq: 85, brakingEnergy: 60, tireWear: 80, topSpeedImportance: 50, lateralG: 90 },
  bahrain:       { downforceReq: 55, brakingEnergy: 92, tireWear: 75, topSpeedImportance: 65, lateralG: 55 },
  jeddah:        { downforceReq: 35, brakingEnergy: 70, tireWear: 45, topSpeedImportance: 88, lateralG: 70 },
  albert_park:   { downforceReq: 60, brakingEnergy: 60, tireWear: 50, topSpeedImportance: 60, lateralG: 65 },
  shanghai:      { downforceReq: 55, brakingEnergy: 70, tireWear: 65, topSpeedImportance: 65, lateralG: 65 },
  miami:         { downforceReq: 50, brakingEnergy: 75, tireWear: 55, topSpeedImportance: 70, lateralG: 60 },
  imola:         { downforceReq: 70, brakingEnergy: 60, tireWear: 55, topSpeedImportance: 50, lateralG: 78 },
  catalunya:     { downforceReq: 78, brakingEnergy: 55, tireWear: 80, topSpeedImportance: 50, lateralG: 88 },
  villeneuve:    { downforceReq: 30, brakingEnergy: 88, tireWear: 50, topSpeedImportance: 80, lateralG: 45 },
  red_bull_ring: { downforceReq: 45, brakingEnergy: 75, tireWear: 55, topSpeedImportance: 75, lateralG: 60 },
  hungaroring:   { downforceReq: 92, brakingEnergy: 55, tireWear: 60, topSpeedImportance: 25, lateralG: 70 },
  zandvoort:     { downforceReq: 80, brakingEnergy: 60, tireWear: 65, topSpeedImportance: 35, lateralG: 88 },
  baku:          { downforceReq: 25, brakingEnergy: 80, tireWear: 40, topSpeedImportance: 92, lateralG: 40 },
  marina_bay:    { downforceReq: 90, brakingEnergy: 78, tireWear: 50, topSpeedImportance: 30, lateralG: 60 },
  americas:      { downforceReq: 65, brakingEnergy: 65, tireWear: 70, topSpeedImportance: 60, lateralG: 80 },
  rodriguez:     { downforceReq: 35, brakingEnergy: 60, tireWear: 50, topSpeedImportance: 78, lateralG: 55 },
  interlagos:    { downforceReq: 60, brakingEnergy: 70, tireWear: 65, topSpeedImportance: 65, lateralG: 70 },
  lusail:        { downforceReq: 80, brakingEnergy: 50, tireWear: 92, topSpeedImportance: 50, lateralG: 90 },
  vegas:         { downforceReq: 25, brakingEnergy: 80, tireWear: 35, topSpeedImportance: 92, lateralG: 35 },
  yas_marina:    { downforceReq: 60, brakingEnergy: 70, tireWear: 50, topSpeedImportance: 55, lateralG: 60 }
};
