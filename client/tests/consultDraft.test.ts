import reducer, {
  applyChanges,
  discarded,
  edited,
  hasChanges,
  mergeChanges,
  opened,
  saveFailed,
  saveStarted,
  saveSucceeded,
  type ConsultDraftState,
} from '../src/features/encounters/consultDraftSlice';
import { signCheck, splitSendable } from '../src/features/encounters/fields';
import { encounter, prescription, signableNote } from './encounters.fixtures';

const run = (state: ConsultDraftState, ...actions: Parameters<typeof reducer>[1][]) =>
  actions.reduce(reducer, state);

describe('consultDraft slice (memory only)', () => {
  const start = run({}, opened({ id: 'e1', revision: 3 }));

  it('merges edits; vitals field by field', () => {
    const s = run(
      start,
      edited({ id: 'e1', changes: { vitals: { pulse: 80 }, plan: 'Rest' } }),
      edited({ id: 'e1', changes: { vitals: { weightKg: 70 }, plan: 'Rest and fluids' } }),
    );
    expect(s.e1!.edits).toEqual({ vitals: { pulse: 80, weightKg: 70 }, plan: 'Rest and fluids' });
    expect(mergeChanges({ vitals: { pulse: 1 } }, {})).toEqual({ vitals: { pulse: 1 } });
  });

  it('keeps edits typed while a save is in flight, and takes the new revision', () => {
    let s = run(start, edited({ id: 'e1', changes: { plan: 'A' } }));
    s = run(s, saveStarted({ id: 'e1', sent: s.e1!.edits }));
    expect(s.e1).toMatchObject({ status: 'saving', edits: {}, inFlight: { plan: 'A' } });
    s = run(s, edited({ id: 'e1', changes: { assessment: 'B' } }));
    s = run(s, saveSucceeded({ id: 'e1', revision: 4, savedAt: '2026-10-01T05:00:00Z' }));
    expect(s.e1).toMatchObject({ revision: 4, inFlight: null, edits: { assessment: 'B' } });
  });

  it('a failed save puts the sent changes back under newer edits', () => {
    let s = run(start, edited({ id: 'e1', changes: { plan: 'A', assessment: 'x' } }));
    s = run(s, saveStarted({ id: 'e1', sent: s.e1!.edits }));
    s = run(s, edited({ id: 'e1', changes: { plan: 'A2' } }));
    s = run(s, saveFailed({ id: 'e1', status: 'offline' }));
    expect(s.e1).toMatchObject({
      status: 'offline',
      retries: 1,
      edits: { plan: 'A2', assessment: 'x' },
      inFlight: null,
    });
    s = run(s, saveFailed({ id: 'e1', status: 'conflict', message: 'changed' }));
    s = run(s, opened({ id: 'e1', revision: 9 }));
    expect(s.e1!.revision).toBe(3); // pending edits: keep the revision they were based on
    s = run(s, discarded({ id: 'e1', revision: 9 }));
    expect(s.e1).toMatchObject({ revision: 9, edits: {}, status: 'idle' });
  });

  it('the view overlays in-flight and local edits on the server note', () => {
    const view = applyChanges(encounter({ plan: 'Server' }), {
      revision: 0,
      edits: { vitals: { pulse: 90 } },
      inFlight: { plan: 'Sent' },
      status: 'saving',
      savedAt: null,
      message: null,
      retries: 0,
    });
    expect(view.plan).toBe('Sent');
    expect(view.vitals.pulse).toBe(90);
    expect(hasChanges({ vitals: {} })).toBe(false);
  });
});

describe('fields helpers', () => {
  it('holds back half-typed diagnoses and an inconsistent follow-up', () => {
    const { send, hold } = splitSendable({
      plan: 'x',
      diagnoses: [{ description: '', icd10Code: null, type: 'provisional', isPrimary: true }],
      followUp: { required: true, afterDays: 3, date: '2099-01-01', instructions: null },
    });
    expect(send).toEqual({ plan: 'x' });
    expect(Object.keys(hold).sort()).toEqual(['diagnoses', 'followUp']);
  });

  it('signCheck: problems block, empty vitals only warn', () => {
    expect(signCheck(encounter(), null)).toEqual({
      problems: [
        { field: 'chiefComplaint', message: 'Chief complaint is required' },
        { field: 'diagnoses', message: 'Add at least one diagnosis' },
      ],
      warnings: ['No vitals were recorded for this visit.'],
    });
    const rx = prescription({
      items: [{ ...prescription().items[0]!, dose: null }],
      allergyWarnings: [
        {
          itemIndex: 0,
          drugName: 'Amoxicillin',
          substance: 'Penicillin',
          matchedOn: 'class',
          drugClass: 'Penicillins',
          acknowledged: false,
        },
      ],
    });
    const check = signCheck(signableNote(), rx);
    expect(check.warnings).toEqual([]);
    expect(check.problems.map((p) => p.field)).toEqual([
      'prescription.items.0.dose',
      'prescription.items.0',
    ]);
  });
});
