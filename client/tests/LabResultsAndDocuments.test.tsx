import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosRequestConfig } from 'axios';
import { http } from 'msw';
import { attachInvalidation } from '../src/app/socketInvalidation';
import type { LabOrderListItem } from '../src/features/labs/api';
import { routes } from '../src/routes/routes';
import { http as httpClient } from '../src/utils/http';
import { authState, makeUser, renderRoutes } from './helpers';
import { labItem, labOrder, worklistItem } from './labs.fixtures';
import { fail, ok, server, url } from './msw/server';

/** Doctor results review and critical alerts, patient reports, documents (Phase 6). */

const doctor = makeUser('doctor', { id: 'dr1', firstName: 'Anil', lastName: 'Mehta' });
const patient = makeUser('patient', { id: 'pu1', patientId: 'p1', patientLinkStatus: 'linked' });
const meta = (total: number) => ({ page: 1, limit: 100, total, totalPages: total ? 1 : 0 });

/** Socket events delivered by hand (sockets are off in tests). */
function fakeSocket(dispatch: Parameters<typeof attachInvalidation>[1]) {
  const handlers = new Map<string, (p: unknown) => void>();
  attachInvalidation(
    {
      on: (e: string, h: (p: unknown) => void) => handlers.set(e, h),
      off: () => undefined,
    } as never,
    dispatch,
  );
  return (event: string, payload: unknown) => act(() => handlers.get(event)!(payload));
}

const critical = (over: Partial<LabOrderListItem> = {}) =>
  worklistItem({
    id: 'lo7',
    orderNumber: 'LAB-2026-000077',
    status: 'processing',
    hasCritical: true,
    flags: { low: 0, high: 0, abnormal: 0, critical: 1 },
    patient: { id: 'p1', mrn: 'MRN-000001', fullName: 'Priya Sharma' },
    ...over,
  });

describe('doctor: results to review and the critical alert', () => {
  it('lists critical first, then released, then unverified, with a flag summary', async () => {
    server.use(
      http.get(url('/lab-orders'), () =>
        ok(
          [
            worklistItem({
              id: 'a',
              orderNumber: 'LAB-A',
              status: 'result_entered',
              flags: { low: 1, high: 0, abnormal: 0, critical: 0 },
            }),
            worklistItem({
              id: 'b',
              orderNumber: 'LAB-B',
              status: 'released',
              releasedAt: '2026-09-25T09:00:00Z',
              flags: { low: 0, high: 2, abnormal: 0, critical: 0 },
            }),
            critical({ id: 'c', orderNumber: 'LAB-C', status: 'released' }),
          ],
          { meta: meta(3) },
        ),
      ),
    );
    renderRoutes(routes, '/doctor/lab-results', authState(doctor));
    const table = await screen.findByRole(
      'table',
      { name: 'Lab results to review' },
      { timeout: 5000 },
    );
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('link')[0]!.textContent)).toEqual([
      'LAB-C',
      'LAB-B',
      'LAB-A',
    ]);
    expect(rows[0]).toHaveTextContent('1 critical');
    expect(rows[1]).toHaveTextContent('2 high');
    expect(rows[2]).toHaveTextContent('1 low');
    expect(within(rows[2]!).getByText('Unverified')).toBeInTheDocument();
    // The sidebar badge counts them.
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('a lab.critical event brings up the red banner; acknowledging clears it', async () => {
    let toReview: LabOrderListItem[] = [];
    const acks: string[] = [];
    server.use(
      http.get(url('/lab-orders'), () => ok(toReview, { meta: meta(toReview.length) })),
      http.get(url('/lab-orders/lo7'), () =>
        ok(
          labOrder({
            id: 'lo7',
            orderNumber: 'LAB-2026-000077',
            status: 'processing',
            hasCritical: true,
            reviewedByDoctorAt: null,
            items: [
              labItem({
                resultsAvailable: true,
                unverified: true,
                results: [
                  {
                    parameterKey: 'hb',
                    name: 'Haemoglobin',
                    unit: 'g/dL',
                    value: 4.2,
                    referenceText: '12–15.5 g/dL',
                    flag: 'critical_low',
                  },
                ],
              }),
            ],
          }),
        ),
      ),
      http.post(url('/lab-orders/lo7/acknowledge'), () => {
        acks.push('lo7');
        toReview = [];
        return ok(labOrder({ id: 'lo7', reviewedByDoctorAt: '2026-09-25T10:00:00Z' }));
      }),
    );
    const { store } = renderRoutes(routes, '/doctor/lab-results', authState(doctor));
    expect(await screen.findByText('All caught up', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: 'Critical lab result' })).not.toBeInTheDocument();

    const emit = fakeSocket(store.dispatch);
    toReview = [critical()];
    emit('lab.critical', { orderId: 'lo7' });
    const banner = await screen.findByRole('alert', { name: 'Critical lab result' });
    expect(banner).toHaveTextContent('Priya Sharma (LAB-2026-000077)');

    const user = userEvent.setup();
    await user.click(within(banner).getByRole('link', { name: 'Review now' }));
    expect(await screen.findByText('Critical low')).toBeInTheDocument();
    expect(screen.getByText('Some results are not verified yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(acks).toEqual(['lo7']));
    await waitFor(() =>
      expect(screen.queryByRole('alert', { name: 'Critical lab result' })).not.toBeInTheDocument(),
    );
  });

  it('shows the banner on load for an unacknowledged critical value', async () => {
    server.use(http.get(url('/lab-orders'), () => ok([critical()], { meta: meta(1) })));
    renderRoutes(routes, '/doctor/lab-results', authState(doctor));
    expect(
      await screen.findByRole('alert', { name: 'Critical lab result' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});

describe('patient: lab reports', () => {
  it('lists released reports with a Corrected badge (the list only ever asks for own released ones)', async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get(url('/lab-orders'), ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return ok(
          [
            worklistItem({
              id: 'lo1',
              status: 'released',
              releasedAt: '2026-09-25T09:00:00Z',
              corrected: true,
              reportAvailable: true,
            }),
          ],
          { meta: meta(1) },
        );
      }),
    );
    renderRoutes(routes, '/patient/lab-reports', authState(patient));
    const table = await screen.findByRole('table', { name: 'Lab reports' }, { timeout: 5000 });
    expect(table).toHaveTextContent('Complete Blood Count');
    expect(table).toHaveTextContent('Dr Anil Mehta');
    expect(within(table).getByText('Corrected')).toBeInTheDocument();
    // No status filter is sent: the server only returns the patient's released orders.
    expect(requests.every((p) => !p.get('status'))).toBe(true);
  });

  it('shows High/Low with text and icon, criticals in calm words, a reminder and the PDF', async () => {
    server.use(
      http.get(url('/lab-orders/lo1'), () =>
        ok({
          id: 'lo1',
          orderNumber: 'LAB-2026-000012',
          orderedAt: '2026-09-24T04:00:00Z',
          releasedAt: '2026-09-25T09:00:00Z',
          orderedBy: { id: 'dr1', name: 'Anil Mehta' },
          sampleCollectedAt: '2026-09-24T05:00:00Z',
          reportAvailable: true,
          items: [
            {
              id: 'i1',
              testId: 't1',
              code: 'CBC',
              name: 'Complete Blood Count',
              resultVersion: 1,
              correctedAt: null,
              results: [
                {
                  parameterKey: 'hb',
                  name: 'Haemoglobin',
                  unit: 'g/dL',
                  value: 11.1,
                  referenceText: '12–15.5 g/dL',
                  flag: 'low',
                },
                {
                  parameterKey: 'wbc',
                  name: 'WBC',
                  unit: '/µL',
                  value: 12500,
                  referenceText: '4000–11000 /µL',
                  flag: 'high',
                },
                {
                  parameterKey: 'plt',
                  name: 'Platelets',
                  unit: '/µL',
                  value: 15000,
                  referenceText: '150000–450000 /µL',
                  flag: 'critical_low',
                },
                {
                  parameterKey: 'mcv',
                  name: 'MCV',
                  unit: 'fL',
                  value: 88,
                  referenceText: '80–100 fL',
                  flag: 'normal',
                },
              ],
            },
          ],
        }),
      ),
    );
    renderRoutes(routes, '/patient/lab-reports/lo1', authState(patient));
    const table = await screen.findByRole(
      'table',
      { name: 'Complete Blood Count results' },
      { timeout: 5000 },
    );
    const row = (name: string) => within(table).getByRole('rowheader', { name }).closest('tr')!;
    expect(row('Haemoglobin')).toHaveTextContent('Low');
    expect(row('WBC')).toHaveTextContent('High');
    expect(row('Platelets')).toHaveTextContent(
      'Outside reference range – your doctor has been informed',
    );
    expect(row('Platelets')).not.toHaveTextContent('Critical');
    // Each flag pill has an icon and text, not colour alone.
    expect(within(row('Haemoglobin')).getByText('Low').querySelector('svg')).toBeTruthy();
    expect(row('Haemoglobin')).toHaveTextContent('12–15.5 g/dL');
    expect(screen.getByText('Please discuss your results with your doctor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
  });

  it('an unreleased (or someone else’s) report is simply not found', async () => {
    server.use(
      http.get(url('/lab-orders/lo2'), () => fail(404, 'NOT_FOUND', 'Lab order not found')),
    );
    renderRoutes(routes, '/patient/lab-reports/lo2', authState(patient));
    expect(
      await screen.findByText('Lab order not found', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('patient: documents and FileUpload', () => {
  function serveDocuments() {
    server.use(
      http.get(url('/documents'), () =>
        ok(
          [
            {
              id: 'd1',
              patientId: 'p1',
              category: 'lab_report',
              mimeType: 'application/pdf',
              sizeBytes: 20480,
              visibleToPatient: true,
              isGenerated: true,
              uploadedAt: '2026-09-25T09:00:00Z',
              canDelete: false,
              title: 'Lab report LAB-2026-000012',
              originalName: 'lab-report-LAB-2026-000012.pdf',
              uploadedBy: null,
            },
          ],
          { meta: meta(1) },
        ),
      ),
    );
  }

  it('lists own documents; generated ones cannot be deleted', async () => {
    serveDocuments();
    renderRoutes(routes, '/patient/documents', authState(patient));
    const table = await screen.findByRole('table', { name: 'Documents' }, { timeout: 5000 });
    expect(table).toHaveTextContent('Lab report LAB-2026-000012');
    expect(within(table).getByRole('button', { name: /Download/ })).toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('refuses a too-large file before uploading, and shows the server’s 415 message', async () => {
    serveDocuments();
    // MSW cannot read jsdom's File inside FormData, so the upload request is answered at the
    // HTTP client: with the server's 415 (the bytes are not a PDF).
    const sent: FormData[] = [];
    const original = httpClient.request.bind(httpClient);
    const spy = vi.spyOn(httpClient, 'request').mockImplementation(((
      config: AxiosRequestConfig,
    ) => {
      if (config.url === '/documents' && config.method === 'POST') {
        sent.push(config.data as FormData);
        const response = {
          status: 415,
          statusText: 'Unsupported Media Type',
          headers: {},
          config,
          data: {
            success: false,
            message: 'Only PDF, JPG and PNG files can be uploaded',
            error: { code: 'UNSUPPORTED_FILE_TYPE' },
          },
        };
        return Promise.reject(
          new AxiosError('415', 'ERR_BAD_REQUEST', config as never, null, response as never),
        );
      }
      return original(config);
    }) as typeof httpClient.request);
    renderRoutes(routes, '/patient/documents', authState(patient));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Upload' }, { timeout: 5000 }));
    const form = screen.getByRole('form', { name: 'Upload a document' });
    // Patients may upload referrals and other papers only.
    expect(
      within(within(form).getByLabelText('Category'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Referral', 'Other']);
    const input = within(form).getByLabelText('File');

    const big = new File(['x'], 'scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await user.upload(input, big);
    expect(await within(form).findByRole('alert')).toHaveTextContent('Files can be at most 10 MB.');

    const exe = new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' });
    // A browser's file dialog filters by `accept`; a drop or 'All files' does not.
    await userEvent.setup({ applyAccept: false }).upload(input, exe);
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'Only PDF, JPG and PNG files can be uploaded.',
    );
    expect(sent).toHaveLength(0);

    // Passes the client check (name and type) – the server looks at the bytes and refuses.
    await user.type(within(form).getByLabelText('Title'), 'Referral letter');
    await user.upload(
      input,
      new File(['not really a pdf'], 'letter.pdf', { type: 'application/pdf' }),
    );
    await user.click(within(form).getByRole('button', { name: 'Upload' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Only PDF, JPG and PNG files can be uploaded',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.get('category')).toBe('referral');
    expect(sent[0]!.get('title')).toBe('Referral letter');
    expect(sent[0]!.get('patientId')).toBe('p1');
    spy.mockRestore();
  });
});

describe('reception: lab orders on the patient page', () => {
  it('status and prices only – never results', async () => {
    const reception = makeUser('receptionist', { id: 'r1' });
    const { receptionView } = await import('./patients.fixtures');
    server.use(
      http.get(url('/patients/p1'), () => ok(receptionView())),
      http.get(url('/lab-orders'), () =>
        ok(
          [
            {
              id: 'lo1',
              orderNumber: 'LAB-2026-000012',
              status: 'released',
              priority: 'routine',
              orderedAt: '2026-09-24T04:00:00Z',
              releasedAt: '2026-09-25T09:00:00Z',
              cancelledAt: null,
              orderedBy: { id: 'dr1', name: 'Anil Mehta' },
              appointmentId: 'a1',
              patient: { id: 'p1', mrn: 'MRN-000001', fullName: 'Priya Sharma' },
              tests: [
                {
                  id: 'i1',
                  testId: 't1',
                  code: 'CBC',
                  name: 'Complete Blood Count',
                  pricePaise: 35000,
                  cancelled: false,
                },
              ],
            },
          ],
          { meta: meta(1) },
        ),
      ),
    );
    renderRoutes(routes, '/reception/patients/p1?tab=lab', authState(reception));
    const table = await screen.findByRole('table', { name: 'Lab orders' }, { timeout: 5000 });
    expect(table).toHaveTextContent('LAB-2026-000012');
    expect(table).toHaveTextContent('CBC (₹350.00)');
    expect(table).toHaveTextContent('Released');
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
  });
});
