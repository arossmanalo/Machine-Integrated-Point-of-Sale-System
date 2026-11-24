import type { MachineType } from './machinePolicy';

/**
 * Multi-cycle washers: when the owner turns on Multi-cycle, staff pick one of a washer's cycles
 * before it runs. Each cycle sends its own number of pulses and counts down its own minutes; the
 * pulse length and gap stay the washer's. Every washer starts with these four; the owner can add
 * more and switch any of them off.
 */
export const DEFAULT_CYCLE_NAMES = ['Delicates', 'Light', 'Medium', 'Heavy'] as const;

export const CYCLE_NAME_MAX_LENGTH = 30;

/**
 * Whether this machine asks for a cycle. Dryers never do (they offer top-ups instead), and a
 * washer with every cycle switched off starts with its own pulses and run time.
 */
export function needsCyclePick(multiCycle: boolean, type: MachineType, enabledCycles: number): boolean {
  return multiCycle && type === 'WASHER' && enabledCycles > 0;
}

export function cycleNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the cycle a name, such as "Quick wash".';
  if (trimmed.length > CYCLE_NAME_MAX_LENGTH) return `Keep the cycle name under ${CYCLE_NAME_MAX_LENGTH} characters.`;
  return null;
}
