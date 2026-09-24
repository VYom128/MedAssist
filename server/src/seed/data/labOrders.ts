import type { LabOrderStatus } from '../../config/constants.js';

/**
 * Lab order demo data (spec §15.3). Tests that suit each diagnosis (by ICD-10 prefix of the
 * note's primary diagnosis), why they were ordered, and the spread of statuses. Demo only.
 */
export const TESTS_BY_DIAGNOSIS: { prefix: string; tests: string[]; notes: string }[] = [
  {
    prefix: 'R50',
    tests: ['CBC', 'DENGUE-NS1'],
    notes: 'Fever for several days – rule out dengue',
  },
  { prefix: 'B34', tests: ['CBC', 'CRP'], notes: 'Viral fever – check counts' },
  { prefix: 'J06', tests: ['CBC', 'CRP'], notes: 'Persistent fever with URTI symptoms' },
  { prefix: 'J03', tests: ['CBC', 'CRP'], notes: 'Tonsillopharyngitis – bacterial vs viral' },
  { prefix: 'E11', tests: ['HBA1C', 'FBS'], notes: 'Diabetes review' },
  { prefix: 'I10', tests: ['LIPID', 'KFT'], notes: 'Hypertension – baseline risk profile' },
  { prefix: 'E03', tests: ['TSH'], notes: 'Hypothyroidism – dose review' },
  { prefix: 'N30', tests: ['URINE-RE'], notes: 'Dysuria and frequency' },
  { prefix: 'E55', tests: ['VITD'], notes: 'Follow-up of vitamin D deficiency' },
  {
    prefix: 'A09',
    tests: ['CBC', 'ELECTROLYTES'],
    notes: 'Diarrhoea with vomiting – check electrolytes',
  },
  { prefix: 'M17', tests: ['ESR', 'CRP'], notes: 'Knee pain – inflammatory markers' },
  { prefix: 'J45', tests: ['CBC'], notes: 'Asthma review' },
];

/**
 * How many orders end in each status (~80). The open ones come from the most recent notes, the
 * released ones from older notes.
 */
export const LAB_ORDER_SPREAD: [LabOrderStatus, number][] = [
  ['ordered', 3],
  ['sample_rejected', 2],
  ['sample_collected', 5],
  ['processing', 5],
  ['result_entered', 5],
  ['verified', 5],
  ['released', 55],
];

/** Share of numeric results outside the reference range. */
export const ABNORMAL_SHARE = 0.15;
/** Positions (in the order list) with one critical value: two released, one awaiting verification. */
export const CRITICAL_AT_STATUS: LabOrderStatus[] = ['released', 'released', 'result_entered'];
/** Share of released orders the doctor has already acknowledged. */
export const ACKNOWLEDGED_SHARE = 0.6;
/** Orders (by status) where one of several tests is cancelled before results. */
export const ITEM_CANCEL_AT_STATUS: LabOrderStatus[] = ['ordered', 'processing', 'released'];
export const ITEM_CANCEL_REASONS = [
  'Reagent unavailable',
  'Sample volume insufficient',
  'Duplicate test',
];
export const REJECTION_REASONS = ['Haemolysed sample', 'Clotted sample'];

/** Values for free-text parameters. */
export const TEXT_VALUES: Record<string, string> = {
  pus_cells: '2-3',
  rbc: 'Nil',
};
