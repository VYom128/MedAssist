import { apiSlice } from '../src/app/apiSlice';
import { attachInvalidation, queueUpdatedTags } from '../src/app/socketInvalidation';
import { actionsFor } from '../src/features/appointments/paths';
import { addDaysToDate, clinicDate, toUtcFromClinic } from '../src/utils/dates';

/** A stand-in socket: records listeners so the test can emit events. */
function fakeSocket() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on(event: string, fn: (payload: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return this;
    },
    off(event: string, fn: (payload: unknown) => void) {
      listeners.get(event)?.delete(fn);
      return this;
    },
    emit(event: string, payload: unknown) {
      listeners.get(event)?.forEach((fn) => fn(payload));
    },
    count: (event: string) => listeners.get(event)?.size ?? 0,
  };
}

describe('socket events → RTK Query invalidation', () => {
  it('queue.updated refreshes that doctor’s queue, the calendars of that date, lists and slots', () => {
    const socket = fakeSocket();
    const dispatch = vi.fn();
    attachInvalidation(socket as never, dispatch);
    socket.emit('queue.updated', { doctorId: 'dr1', date: '2026-10-05' });
    expect(dispatch).toHaveBeenCalledWith(
      apiSlice.util.invalidateTags(queueUpdatedTags({ doctorId: 'dr1', date: '2026-10-05' })),
    );
    expect(queueUpdatedTags({ doctorId: 'dr1', date: '2026-10-05' })).toEqual(
      expect.arrayContaining([
        { type: 'Queue', id: 'dr1:2026-10-05' },
        { type: 'Calendar', id: '2026-10-05' },
        { type: 'AppointmentList', id: 'LIST' },
        { type: 'Slots', id: 'dr1:2026-10-05' },
      ]),
    );
  });

  it('appointment.changed refreshes that appointment; detaching removes the listeners', () => {
    const socket = fakeSocket();
    const dispatch = vi.fn();
    const detach = attachInvalidation(socket as never, dispatch);
    socket.emit('appointment.changed', { appointmentId: 'a1' });
    expect(dispatch).toHaveBeenCalledWith(
      apiSlice.util.invalidateTags([{ type: 'Appointment', id: 'a1' }]),
    );
    detach();
    expect(socket.count('queue.updated')).toBe(0);
    expect(socket.count('appointment.changed')).toBe(0);
  });
});

describe('actionsFor (which buttons an appointment shows)', () => {
  const today = clinicDate();
  const now = new Date(toUtcFromClinic(today, '12:00'));
  const later = toUtcFromClinic(addDaysToDate(today, 1), '10:00');
  const earlier = toUtcFromClinic(today, '11:00'); // started an hour ago, today

  it('reception: check in on the day, no-show once started, undo only on the day', () => {
    expect(actionsFor('receptionist', { status: 'scheduled', startAt: later }, now)).toEqual([
      'reschedule',
      'priority',
      'cancel',
    ]);
    expect(actionsFor('receptionist', { status: 'scheduled', startAt: earlier }, now)).toEqual([
      'check-in',
      'reschedule',
      'priority',
      'cancel',
      'no-show',
    ]);
    expect(actionsFor('receptionist', { status: 'no_show', startAt: earlier }, now)).toEqual([
      'undo-no-show',
    ]);
    expect(actionsFor('receptionist', { status: 'checked_in', startAt: earlier }, now)).toEqual([
      'priority',
      'cancel',
    ]);
    expect(actionsFor('receptionist', { status: 'no_show', startAt: later }, now)).toEqual([]);
  });

  it('admin: view only, no actions', () => {
    for (const status of ['scheduled', 'checked_in', 'completed'] as const) {
      expect(actionsFor('admin', { status, startAt: later }, now)).toEqual([]);
    }
  });

  it('doctor: start when checked in, complete when in consultation, nothing else', () => {
    expect(actionsFor('doctor', { status: 'checked_in', startAt: earlier }, now)).toEqual([
      'start',
    ]);
    expect(actionsFor('doctor', { status: 'in_consultation', startAt: earlier }, now)).toEqual([
      'complete',
    ]);
    expect(actionsFor('doctor', { status: 'scheduled', startAt: later }, now)).toEqual([]);
    expect(actionsFor('patient', { status: 'scheduled', startAt: later }, now)).toEqual([]);
  });

  it('nothing for finished appointments', () => {
    for (const status of ['completed', 'cancelled'] as const) {
      expect(actionsFor('receptionist', { status, startAt: earlier }, now)).toEqual([]);
    }
  });
});
