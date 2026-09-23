import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import type { ScheduleView } from '../src/features/doctors/api';
import { routes } from '../src/routes/routes';
import { clinicDate } from '../src/utils/dates';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';

const doctor = makeUser('doctor', { id: 'dr1', firstName: 'Anil', lastName: 'Mehta' });
const today = clinicDate();

const SCHEDULE: ScheduleView = {
  current: {
    effectiveFrom: '2026-06-01',
    effectiveTo: null,
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      sessions: weekday === 1 ? [{ start: '09:00', end: '13:00', maxWalkIns: 2 }] : [],
    })),
  },
  upcoming: null,
};

describe('Weekly schedule editor (doctor: own schedule)', () => {
  let puts: unknown[];
  beforeEach(() => {
    puts = [];
    server.use(
      http.get(url('/doctors/dr1/schedule'), () => ok(SCHEDULE)),
      http.put(url('/doctors/dr1/schedule'), async ({ request }) => {
        puts.push(await request.json());
        return ok({
          ...SCHEDULE,
          warnings: [{ weekday: 0, message: 'Sunday is not a clinic working day' }],
          affectedAppointments: [],
        });
      }),
    );
  });

  it('shows an inline error for overlapping sessions and sends the right payload', async () => {
    renderRoutes(routes, '/doctor/schedule', authState(doctor));
    const user = userEvent.setup();
    expect(await screen.findByText('Current schedule')).toBeInTheDocument();
    const monday = screen.getByRole('group', { name: 'Monday' });
    expect(within(monday).getAllByLabelText('Start')[0]).toHaveValue('09:00');
    expect(screen.getByText(/4 hours/)).toBeInTheDocument();

    // Add a second Monday session and make it overlap the morning one.
    await user.click(within(monday).getByRole('button', { name: 'Add Monday session' }));
    const starts = within(monday).getAllByLabelText('Start');
    const ends = within(monday).getAllByLabelText('End');
    expect(starts[1]).toHaveValue('17:00');
    fireEvent.change(starts[1]!, { target: { value: '12:00' } });
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(await within(monday).findByText('Overlaps the 09:00–13:00 session')).toBeInTheDocument();
    expect(puts).toHaveLength(0);

    // Fix it; add a Sunday session (not a working day: the server warns).
    fireEvent.change(starts[1]!, { target: { value: '14:00' } });
    fireEvent.change(ends[1]!, { target: { value: '18:30' } });
    const sunday = screen.getByRole('group', { name: 'Sunday' });
    await user.click(within(sunday).getByRole('button', { name: 'Add Sunday session' }));
    expect(screen.getByText(/12\.5 hours/)).toBeInTheDocument(); // 4 + 4.5 + 4
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      effectiveFrom: today,
      days: [
        { weekday: 0, sessions: [{ start: '09:00', end: '13:00' }] },
        {
          weekday: 1,
          sessions: [
            { start: '09:00', end: '13:00', maxWalkIns: 2 },
            { start: '14:00', end: '18:30' },
          ],
        },
      ],
    });
    expect(await screen.findByText('Sunday is not a clinic working day')).toBeInTheDocument();
  });

  it('checks start < end and 5-minute steps; removing a session works', async () => {
    renderRoutes(routes, '/doctor/schedule', authState(doctor));
    const user = userEvent.setup();
    const monday = await screen.findByRole('group', { name: 'Monday' });
    const [start] = within(monday).getAllByLabelText('Start');
    const [end] = within(monday).getAllByLabelText('End');
    fireEvent.change(start!, { target: { value: '13:03' } });
    fireEvent.change(end!, { target: { value: '09:05' } });
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(await within(monday).findByText('Use 5-minute steps')).toBeInTheDocument();
    expect(within(monday).getByText('End must be after start')).toBeInTheDocument();

    await user.click(within(monday).getByRole('button', { name: 'Remove Monday session 1' }));
    expect(within(monday).queryByLabelText('Start')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(puts[0]).toEqual({ effectiveFrom: today, days: [] }));
  });
});

describe('Leave (doctor: own leave)', () => {
  it('adds a part-day leave converted from clinic time to UTC', async () => {
    let body: unknown;
    server.use(
      http.get(url('/doctors/dr1/schedule'), () => ok(SCHEDULE)),
      http.get(url('/doctors/dr1/leaves'), () =>
        ok([], { meta: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
      ),
      http.post(url('/doctors/dr1/leaves'), async ({ request }) => {
        body = await request.json();
        return ok({ leave: {}, affectedAppointments: [] }, { status: 201 });
      }),
    );
    renderRoutes(routes, '/doctor/schedule', authState(doctor));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Leave' }));
    expect(await screen.findByText('No upcoming leave')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add leave' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add leave' });
    await user.click(within(dialog).getByLabelText('Part of a day'));
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2030-01-10' } });
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '14:00' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '13:00' } });
    await user.click(within(dialog).getByRole('button', { name: 'Add leave' }));
    expect(await within(dialog).findByText('Must be after the start time')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '18:00' } });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'conference');
    await user.click(within(dialog).getByRole('button', { name: 'Add leave' }));
    await waitFor(() =>
      expect(body).toEqual({
        startAt: '2030-01-10T08:30:00.000Z', // 14:00 in India
        endAt: '2030-01-10T12:30:00.000Z',
        type: 'conference',
      }),
    );
  });
});
