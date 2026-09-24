import { APPOINTMENT_STATUSES, ERROR_CODES } from '../../src/config/constants.js';
import { ApiError } from '../../src/utils/ApiError.js';
import { assertTransition, canTransition } from '../../src/utils/stateMachine.js';

/** Appointment state machine (spec §5.1): every pair of statuses is checked. */
const ALLOWED = new Set([
  'scheduled→scheduled', // reschedule
  'scheduled→checked_in',
  'scheduled→cancelled',
  'scheduled→no_show',
  'checked_in→in_consultation',
  'checked_in→cancelled',
  'in_consultation→completed',
  'no_show→scheduled', // undo, same day
]);

describe('appointment state machine', () => {
  for (const from of APPOINTMENT_STATUSES) {
    for (const to of APPOINTMENT_STATUSES) {
      const allowed = ALLOWED.has(`${from}→${to}`);
      it(`${from} → ${to}: ${allowed ? 'allowed' : '409'}`, () => {
        expect(canTransition('appointment', from, to)).toBe(allowed);
        if (allowed) {
          expect(() => assertTransition('appointment', from, to)).not.toThrow();
        } else {
          try {
            assertTransition('appointment', from, to);
            expect.unreachable();
          } catch (err) {
            expect(err).toBeInstanceOf(ApiError);
            expect(err).toMatchObject({
              statusCode: 409,
              code: ERROR_CODES.INVALID_STATUS_TRANSITION,
              details: { from, to },
            });
          }
        }
      });
    }
  }

  it('an unknown status cannot move anywhere', () => {
    expect(canTransition('appointment', 'lost', 'scheduled')).toBe(false);
  });
});
