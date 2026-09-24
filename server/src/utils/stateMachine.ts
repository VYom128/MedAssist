import { ERROR_CODES, STATE_MACHINES, type StateMachine } from '../config/constants.js';
import { ApiError } from './ApiError.js';

/**
 * State machine checks (spec §5). The transition tables live in `STATE_MACHINES` in
 * config/constants.ts; this helper is here rather than there because it throws an ApiError
 * (which itself imports the constants).
 */

type StatusOf<M extends StateMachine> = keyof (typeof STATE_MACHINES)[M] & string;

/** True if `machine` allows moving from `from` to `to`. */
export function canTransition<M extends StateMachine>(machine: M, from: string, to: string) {
  const table = STATE_MACHINES[machine] as Readonly<Record<string, readonly string[]>>;
  return table[from]?.includes(to) ?? false;
}

/** The 409 INVALID_STATUS_TRANSITION error for `from → to`. */
export function invalidTransition(machine: StateMachine, from: string, to: string) {
  return new ApiError(
    409,
    `This ${machine} is ${from.replace(/_/g, ' ')} and cannot be changed to ${to.replace(/_/g, ' ')}`,
    ERROR_CODES.INVALID_STATUS_TRANSITION,
    { from, to },
  );
}

/** Throws 409 INVALID_STATUS_TRANSITION unless `machine` allows `from → to`. */
export function assertTransition<M extends StateMachine>(
  machine: M,
  from: StatusOf<M> | string,
  to: StatusOf<M>,
): void {
  if (!canTransition(machine, from, to)) throw invalidTransition(machine, from, to);
}
