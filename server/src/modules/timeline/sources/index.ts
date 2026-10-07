import type { TimelineSource } from '../types.js';
import { appointmentSource } from './appointments.js';
import { documentSource } from './documents.js';
import { encounterSource } from './encounters.js';
import { followupSource } from './followups.js';
import { invoiceSource } from './invoices.js';
import { labOrderSource } from './labOrders.js';
import { paymentSource } from './payments.js';
import { prescriptionSource } from './prescriptions.js';

/**
 * The timeline sources (spec §8.8). Each says which roles may see it; the service asks only
 * those, so items are filtered before merging. Add a source here (Phase 9: AI summaries).
 */
export const TIMELINE_SOURCES: readonly TimelineSource[] = [
  appointmentSource,
  encounterSource,
  prescriptionSource,
  labOrderSource,
  invoiceSource,
  paymentSource,
  documentSource,
  followupSource,
];
