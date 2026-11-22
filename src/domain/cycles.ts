/**
 * Multi-cycle machines: when the owner turns on Multi-cycle, staff pick one of these cycles before
 * a machine runs. Each machine sends its own number of pulses and counts down its own minutes
 * per cycle; the pulse length and gap stay the machine's.
 */
export const CYCLES = ['DELICATES', 'LIGHT', 'MEDIUM', 'HEAVY'] as const;
export type Cycle = (typeof CYCLES)[number];

export const CYCLE_LABELS: Record<Cycle, string> = {
  DELICATES: 'Delicates',
  LIGHT: 'Light',
  MEDIUM: 'Medium',
  HEAVY: 'Heavy',
};

/** Owner overrides and test starts have no cycle to pick, so they run this one. */
export const DEFAULT_CYCLE: Cycle = 'MEDIUM';

export interface CycleSettings {
  delicatesPulses: number;
  delicatesMinutes: number;
  lightPulses: number;
  lightMinutes: number;
  mediumPulses: number;
  mediumMinutes: number;
  heavyPulses: number;
  heavyMinutes: number;
}

export function isCycle(value: string): value is Cycle {
  return CYCLES.some((cycle) => cycle === value);
}

export function cyclePulses(settings: CycleSettings, cycle: Cycle): number {
  if (cycle === 'DELICATES') return settings.delicatesPulses;
  if (cycle === 'LIGHT') return settings.lightPulses;
  if (cycle === 'MEDIUM') return settings.mediumPulses;
  return settings.heavyPulses;
}

export function cycleMinutes(settings: CycleSettings, cycle: Cycle): number {
  if (cycle === 'DELICATES') return settings.delicatesMinutes;
  if (cycle === 'LIGHT') return settings.lightMinutes;
  if (cycle === 'MEDIUM') return settings.mediumMinutes;
  return settings.heavyMinutes;
}

/** Every cycle with the same pulses and minutes, for a machine set up before Multi-cycle. */
export function sameForEveryCycle(pulses: number, minutes: number): CycleSettings {
  return {
    delicatesPulses: pulses,
    delicatesMinutes: minutes,
    lightPulses: pulses,
    lightMinutes: minutes,
    mediumPulses: pulses,
    mediumMinutes: minutes,
    heavyPulses: pulses,
    heavyMinutes: minutes,
  };
}
