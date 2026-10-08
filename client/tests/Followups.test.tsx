import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { routes } from '../src/routes/routes';
import { addDaysToDate, formatCalendarDate } from '../src/utils/dates';
import { at, DEPARTMENTS, DOCTORS, SERVICES, TOMORROW } from './appointments.fixtures';
import { followup, listMeta } from './followups.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { fail, ok, server, url } from './msw/server';

/** Follow-up requests in the client (Phase 8): patient, reception and doctor. */

const patient = makeUser('patient', { patientId: 'p1', patientLinkStatus: 'linked' });
const reception = makeUser('receptionist', { id: 'r1', firstName: 'Riya' });

const STAFF_NOTE = {
  id: 'm1',
  from: { id: 'r1', name: 'Riya Rao', role: 'receptionist' },
  text: 'Internal: called the patient, no fever',
  visibility: 'staff' as const,
  at: '2026-09-20T06:00:00.000Z',
};
const REPLY = {
  id: 'm2',
  from: { id: 'dr1', name: 'Anil Mehta', role: 'doctor' },
  text: 'Please come in tomorrow.',
  visibility: 'all' as const,
  at: '2026-09-20T07:00:00.000Z',
};
const PATIENT_REPLY = {
  id: 'm3',
  from: { id: 'u1', name: 'Priya Sharma', role: 'patient' },
  text: 'Thank you, I will.',
  visibility: 'all' as const,
  at: '2026-09-20T08:00:00.000Z',
};

describe('New follow-up request (patient)', () => {
  it('always shows the emergency banner and explains the request limit', async () => {
    let body: unknown;
    server.use(
      http.get(url('/appointments'), () =>
        ok(
          [
            {
              id: 'a1',
              startAt: '2026-09-10T04:00:00.000Z',
              doctor: { id: 'dr1', name: 'Anil Mehta' },
            },
          ],
          {
            meta: listMeta(1),
          },
        ),
      ),
      http.post(url('/follow-up-requests'), async ({ request }) => {
        body = await request.json();
        return fail(
          422,
          'FOLLOWUP_LIMIT_REACHED',
          'You already have 3 open requests. Please wait for a reply, or close one first.',
          { limit: 3, kind: 'open' },
        );
      }),
    );
    renderRoutes(routes, '/patient/follow-ups/new', authState(patient));
    const user = userEvent.setup();
    expect(
      await screen.findByRole('note', { name: 'Not for emergencies' }, { timeout: 5000 }),
    ).toHaveTextContent(
      'This is not for emergencies. If this is an emergency, call your local emergency number.',
    );
    // Validation first: a type and a message are needed.
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Choose what this is about')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /New or worse symptoms/ }));
    await user.selectOptions(screen.getByLabelText(/Related visit/), 'a1');
    await user.type(screen.getByLabelText('Your message'), 'The cough is worse at night.');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText('You have reached the limit for now')).toBeInTheDocument();
    expect(screen.getByText(/You already have 3 open requests/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See my open requests' })).toHaveAttribute(
      'href',
      '/patient/follow-ups',
    );
    expect(body).toEqual({
      type: 'new_or_worse_symptoms',
      message: 'The cough is worse at night.',
      relatedAppointmentId: 'a1',
    });
    // Still on the form, banner still there.
    expect(screen.getByRole('note', { name: 'Not for emergencies' })).toBeInTheDocument();
  });
});

describe('Request thread', () => {
  it('the patient never sees internal notes, even if a response carried one', async () => {
    server.use(
      http.get(url('/follow-up-requests/f1'), () =>
        ok(followup({ status: 'open', messages: [STAFF_NOTE, REPLY, PATIENT_REPLY] })),
      ),
    );
    renderRoutes(routes, '/patient/follow-ups/f1', authState(patient));
    const thread = await screen.findByRole('list', { name: 'Messages' }, { timeout: 5000 });
    const items = within(thread).getAllByRole('listitem');
    expect(items).toHaveLength(3); // the request, the doctor's reply and the patient's reply
    expect(screen.queryByText(/called the patient/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Internal/)).not.toBeInTheDocument();
    expect(within(items[1]!).getByText('Please come in tomorrow.')).toBeInTheDocument();
    // The patient's own messages are "You".
    expect(within(items[0]!).getByText('You')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as resolved' })).toBeInTheDocument();
  });

  it('closed: the reply box is off for the patient', async () => {
    server.use(
      http.get(url('/follow-up-requests/f1'), () =>
        ok(followup({ status: 'closed', closedReason: 'Answered by phone' })),
      ),
    );
    renderRoutes(routes, '/patient/follow-ups/f1', authState(patient));
    expect(
      await screen.findByText(/This request is closed/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Your message')).not.toBeInTheDocument();
    expect(screen.getByText('Answered by phone')).toBeInTheDocument();
  });

  it('staff see internal notes clearly marked, and can write one', async () => {
    let posted: unknown;
    server.use(
      http.get(url('/follow-up-requests'), () =>
        ok([followup({ messages: [] })], { meta: listMeta(1) }),
      ),
      http.get(url('/follow-up-requests/f1'), () =>
        ok(followup({ messages: [STAFF_NOTE, REPLY] })),
      ),
      http.get(url('/doctors'), () => ok(DOCTORS, { meta: listMeta(2) })),
      http.post(url('/follow-up-requests/f1/messages'), async ({ request }) => {
        posted = await request.json();
        return ok(followup({ messages: [STAFF_NOTE, REPLY] }), { status: 201 });
      }),
    );
    renderRoutes(routes, '/reception/follow-ups/f1', authState(reception));
    const user = userEvent.setup();
    const thread = await screen.findByRole('list', { name: 'Messages' }, { timeout: 5000 });
    const note = within(thread).getByText(STAFF_NOTE.text).closest('li')!;
    expect(within(note).getByText(/Internal – not visible to patient/)).toBeInTheDocument();
    // The public reply has no such label.
    const reply = within(thread).getByText(REPLY.text).closest('li')!;
    expect(within(reply).queryByText(/Internal/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Internal note' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Internal note' }),
      'Checked the old report',
    );
    await user.click(screen.getByRole('button', { name: 'Add internal note' }));
    await waitFor(() =>
      expect(posted).toEqual({ text: 'Checked the old report', visibility: 'staff' }),
    );
  });
});

describe('Reception inbox', () => {
  function inboxHandlers(onSchedule: () => Response) {
    const scheduled: unknown[] = [];
    server.use(
      http.get(url('/follow-up-requests'), ({ request }) => {
        const status = new URL(request.url).searchParams.get('status');
        const items = status === 'open' ? [followup()] : [];
        return ok(items, { meta: listMeta(items.length) });
      }),
      http.get(url('/follow-up-requests/f1'), () => ok(followup())),
      http.post(url('/follow-up-requests/f1/schedule'), async ({ request }) => {
        scheduled.push(await request.json());
        return onSchedule();
      }),
      http.get(url('/doctors'), () => ok(DOCTORS, { meta: listMeta(2) })),
      http.get(url('/doctors/dr1'), () => ok(DOCTORS[0])),
      http.get(url('/departments'), () => ok(DEPARTMENTS, { meta: listMeta(2) })),
      http.get(url('/services'), () => ok(SERVICES, { meta: listMeta(SERVICES.length) })),
      http.get(url('/doctors/dr1/availability'), ({ request }) => {
        const from = new URL(request.url).searchParams.get('from')!;
        return ok({
          timezone: 'Asia/Kolkata',
          slotMinutes: 15,
          serviceMinutes: 15,
          days: Array.from({ length: 7 }, (_, i) => ({
            date: addDaysToDate(from, i),
            freeSlots: 2,
          })),
        });
      }),
      http.get(url('/doctors/dr1/slots'), () =>
        ok({
          date: TOMORROW,
          timezone: 'Asia/Kolkata',
          slotMinutes: 15,
          serviceMinutes: 15,
          slots: [{ startAt: at(TOMORROW, '10:00'), endAt: at(TOMORROW, '10:15'), label: '10:00' }],
        }),
      ),
    );
    return scheduled;
  }

  it('shows status tabs with counts and the open request beside the list', async () => {
    inboxHandlers(() => fail(500, 'INTERNAL_ERROR'));
    renderRoutes(routes, '/reception/follow-ups', authState(reception));
    expect(await screen.findByRole('tab', { name: 'Open (1)' }, { timeout: 5000 })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Closed (0)' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Follow-up requests' });
    await userEvent.setup().click(within(list).getByRole('link', { name: /Priya Sharma/ }));
    expect(await screen.findByRole('list', { name: 'Messages' })).toBeInTheDocument();
    for (const action of ['Mark in review', 'Assign doctor', 'Schedule', 'Close', 'Reject']) {
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Timeline' })).toHaveAttribute(
      'href',
      '/reception/patients/p1?tab=timeline',
    );
  });

  it('a 409 SLOT_UNAVAILABLE from booking is shown in the dialog and the request stays open', async () => {
    const scheduled = inboxHandlers(() =>
      fail(409, 'SLOT_UNAVAILABLE', 'That time was just taken'),
    );
    renderRoutes(routes, '/reception/follow-ups/f1', authState(reception));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Schedule' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: /Book a follow-up/ });
    await user.click(
      await within(dialog).findByRole('radio', { name: `${formatCalendarDate(TOMORROW)}: 2 free` }),
    );
    await user.click(await within(dialog).findByRole('radio', { name: '10:00 AM' }));
    await user.click(within(dialog).getByRole('button', { name: 'Book appointment' }));

    expect(await within(dialog).findByText('Not booked')).toBeInTheDocument();
    expect(
      within(dialog).getByText('That time was just taken. Please pick another time.'),
    ).toBeInTheDocument();
    expect(scheduled).toEqual([{ startAt: at(TOMORROW, '10:00'), serviceId: 'svc1' }]);
    // The dialog stays open and the request is still open.
    expect(screen.getByRole('dialog', { name: /Book a follow-up/ })).toBeInTheDocument();
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
  });
});
