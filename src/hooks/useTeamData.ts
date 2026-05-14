import { useMemo } from 'react';
import type { Lap, Driver, TelemetryPoint } from '../types/f1';
import {
  aggregateTeamMetrics,
  computePaceMaps,
  computeTeamIdealRanking,
  type TeamMetrics,
  type TeamIdealEntry,
} from '../lib/teamMetrics';

export interface TeamDataResult {
  characteristics: Map<string, TeamMetrics>;
  idealRanking: Map<string, TeamIdealEntry>;
  teamLaps: Map<string, Lap[]>;
  teamKeys: string[];
  isLoading: boolean;
}

export function useTeamData(
  drivers: Driver[],
  laps: Record<string, Lap[]>,
  telemetry: Record<string, TelemetryPoint[]>
): TeamDataResult {
  return useMemo(() => {
    const lapEntries = Object.entries(laps ?? {});
    const telemetryEntries = telemetry ?? {};
    if (lapEntries.length === 0 && Object.keys(telemetryEntries).length === 0) {
      return { characteristics: new Map(), idealRanking: new Map(), teamLaps: new Map(), teamKeys: [], isLoading: true };
    }

    const driversByTeam = new Map<string, Array<{ driverId: string; laps: Lap[] }>>();
    const driverEntries: Array<{ driverId: string; team: string; laps: Lap[] }> = [];

    drivers.forEach(driver => {
      const lapsForDriver = lapEntries
        .filter(([key]) => key.startsWith(`${driver.id}_`))
        .flatMap(([, laps]) => laps);
      const telemetryForDriver = Object.entries(telemetryEntries)
        .filter(([key]) => key.startsWith(`${driver.id}_`))
        .flatMap(([, points]) => points);
      if (lapsForDriver.length === 0 && telemetryForDriver.length === 0) return;
      const arr = driversByTeam.get(driver.team) ?? [];
      arr.push({ driverId: driver.id, laps: lapsForDriver });
      driversByTeam.set(driver.team, arr);
      driverEntries.push({ driverId: driver.id, team: driver.team, laps: lapsForDriver });
    });

    if (driversByTeam.size === 0) {
      return { characteristics: new Map(), idealRanking: new Map(), teamLaps: new Map(), teamKeys: [], isLoading: true };
    }

    const aggregateInputs = Array.from(driversByTeam.entries()).map(([team, drivers]) => ({
      team,
      drivers: drivers.map(d => ({
        ...d,
        telemetry: Object.entries(telemetryEntries)
          .filter(([key]) => key.startsWith(`${d.driverId}_`))
          .flatMap(([, points]) => points)
      }))
    }));
    const characteristics = aggregateTeamMetrics(aggregateInputs);
    computePaceMaps(driverEntries);
    const idealList = computeTeamIdealRanking(driverEntries);
    const idealRanking = new Map<string, TeamIdealEntry>();
    idealList.forEach(e => idealRanking.set(e.team, e));

    const teamLaps = new Map<string, Lap[]>();
    driverEntries.forEach(d => {
      const arr = teamLaps.get(d.team) ?? [];
      arr.push(...d.laps);
      teamLaps.set(d.team, arr);
    });

    return {
      characteristics,
      idealRanking,
      teamLaps,
      teamKeys: [...driversByTeam.keys()],
      isLoading: false,
    };
  }, [drivers, laps, telemetry]);
}
