import type { LabItem, LabOrder, LabOrderListItem } from '../src/features/labs/api';
import type { LabTest } from '../src/features/labTests/api';

/** A catalogue test with a numeric (hb, sex-specific ranges) and an option parameter. */
export function labTest(over: Partial<LabTest> = {}): LabTest {
  return {
    id: 't1',
    code: 'CBC',
    name: 'Complete Blood Count',
    category: 'haematology',
    sampleType: 'blood',
    pricePaise: 35_000,
    preparation: 'No fasting needed',
    turnaroundHours: 6,
    parameters: [
      {
        key: 'hb',
        name: 'Haemoglobin',
        unit: 'g/dL',
        valueType: 'number',
        options: [],
        ranges: [
          { gender: 'male', ageMinYears: 18, low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
          {
            gender: 'female',
            ageMinYears: 18,
            low: 12,
            high: 15.5,
            criticalLow: 7,
            criticalHigh: 20,
          },
        ],
      },
      {
        key: 'smear',
        name: 'Malaria smear',
        unit: null,
        valueType: 'option',
        options: ['Negative', 'Positive'],
        abnormalOptions: ['Positive'],
        ranges: [],
      },
    ],
    ...over,
  };
}

export function labItem(over: Partial<LabItem> = {}): LabItem {
  return {
    id: 'i1',
    testId: 't1',
    code: 'CBC',
    name: 'Complete Blood Count',
    status: 'pending',
    results: [],
    remarks: null,
    resultVersion: 1,
    previousResults: [],
    cancellation: null,
    sampleType: 'blood',
    turnaroundHours: 6,
    pendingRevision: null,
    enteredBy: null,
    enteredAt: null,
    verifiedBy: null,
    verifiedAt: null,
    ...over,
  };
}

/** The lab view of order lo1 (patient Priya Sharma, 38 y, female). */
export function labOrder(over: Partial<LabOrder> = {}): LabOrder {
  return {
    id: 'lo1',
    orderNumber: 'LAB-2026-000012',
    status: 'ordered',
    priority: 'routine',
    orderedAt: '2026-09-25T04:00:00.000Z',
    createdAt: '2026-09-25T04:00:00.000Z',
    orderedBy: { id: 'dr1', name: 'Anil Mehta' },
    encounterId: 'e1',
    appointmentId: 'a1',
    patient: {
      id: 'p1',
      mrn: 'MRN-000001',
      fullName: 'Priya Sharma',
      age: 38,
      gender: 'female',
      allergies: [{ substance: 'Latex', reaction: null, severity: 'moderate' }],
    },
    clinicalNotes: 'Fatigue for a month – anaemia?',
    sample: null,
    items: [labItem()],
    hasCritical: false,
    releasedAt: null,
    reportAvailable: false,
    cancellation: null,
    statusHistory: [{ status: 'ordered', at: '2026-09-25T04:00:00.000Z', by: 'dr1', note: null }],
    revision: 1,
    requireDualVerification: true,
    tatBreachedAt: null,
    releasedBy: null,
    ...over,
  };
}

export const collectedSample = {
  sampleId: 'S26-000042',
  type: 'blood',
  collectedAt: '2026-09-25T05:00:00.000Z',
  collectedBy: { id: 'lab1', name: 'Lakshmi Nair' },
  patientAgeYears: 38,
  rejection: null,
};

export function worklistItem(over: Partial<LabOrderListItem> = {}): LabOrderListItem {
  return {
    id: 'lo1',
    orderNumber: 'LAB-2026-000012',
    status: 'ordered',
    priority: 'routine',
    orderedAt: '2026-09-25T04:00:00.000Z',
    createdAt: '2026-09-25T04:00:00.000Z',
    orderedBy: { id: 'dr1', name: 'Anil Mehta' },
    encounterId: 'e1',
    appointmentId: 'a1',
    patient: { id: 'p1', mrn: 'MRN-000001', fullName: 'Priya Sharma', age: 38, gender: 'female' },
    tests: [{ id: 'i1', code: 'CBC', name: 'Complete Blood Count', status: 'pending' }],
    hasCritical: false,
    sampleId: null,
    tatBreachedAt: null,
    ...over,
  };
}
