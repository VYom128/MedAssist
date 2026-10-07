import type { Followup } from '../src/features/followups/api';

/** A follow-up request of patient p1 (server shape, Phase 8). */
export const followup = (over: Partial<Followup> = {}): Followup => ({
  id: 'f1',
  requestNumber: 'FUR-2026-000001',
  type: 'new_or_worse_symptoms',
  status: 'open',
  patient: { id: 'p1', mrn: 'MRN-000001', fullName: 'Priya Sharma' },
  assignedDoctor: { id: 'dr1', name: 'Anil Mehta' },
  relatedAppointmentId: 'a1',
  resultingAppointmentId: null,
  preferredDate: null,
  messageCount: 0,
  lastMessageAt: null,
  createdAt: '2026-09-20T05:00:00.000Z',
  updatedAt: '2026-09-20T05:00:00.000Z',
  message: 'The cough is worse at night.',
  attachments: [],
  messages: [],
  closedReason: null,
  statusHistory: [{ status: 'open', at: '2026-09-20T05:00:00.000Z' }],
  ...over,
});

export const listMeta = (n: number) => ({ page: 1, limit: 20, total: n, totalPages: 1 });
