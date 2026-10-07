import type { Role } from '../../constants/roles';
import type { TimelineType } from './api';

/**
 * The filter chips each role is offered (spec §8.8 and the Phase 8 visibility decision). Only a
 * convenience: the server decides what each role gets.
 */
export const TIMELINE_FILTERS: Partial<Record<Role, readonly TimelineType[]>> = {
  doctor: ['appointment', 'encounter', 'prescription', 'lab_order', 'document', 'followup_request'],
  receptionist: ['appointment', 'invoice', 'payment', 'document', 'followup_request'],
  patient: [
    'appointment',
    'encounter',
    'prescription',
    'lab_order',
    'invoice',
    'payment',
    'document',
    'followup_request',
  ],
};
