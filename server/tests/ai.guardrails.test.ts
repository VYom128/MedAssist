import { buildTemplateExplanation, whenToTake } from '../src/ai/explanationTemplate.js';
import {
  allowedNumberUnits,
  checkConsistency,
  checkExplanation,
  checkForbidden,
  numberUnits,
  toWesternDigits,
} from '../src/ai/guardrails.js';
import type {
  ExplanationInput,
  ExplanationMedicine,
  ExplanationOutput,
} from '../src/ai/prompts/patientExplanation.v1.js';
import { DRUG_FREQUENCY_CODES, DRUG_TIMINGS } from '../src/config/constants.js';
import { FREQUENCY_PHRASES, TIMING_PHRASES } from '../src/data/abbreviations.js';

/**
 * Patient explanation guardrails (spec §9.3) on fixed outputs: consistency (medicines, numbers
 * and units in English, Hindi and Devanagari digits), forbidden phrases (en + hi), and the
 * deterministic template for every abbreviation in both languages.
 */

const med = (overrides: Partial<ExplanationMedicine> = {}): ExplanationMedicine => ({
  name: 'Amoxicillin',
  genericName: 'Amoxicillin',
  strength: '500 mg',
  form: 'capsule',
  dose: '1 capsule',
  route: 'oral',
  frequency: 'TDS',
  frequencyText: null,
  timing: 'after_food',
  durationDays: 5,
  instructions: 'Finish the full course',
  ...overrides,
});

const input = (language: 'en' | 'hi' = 'en', medicines = [med()]): ExplanationInput => ({
  language,
  readingAge: 12,
  explains: 'prescription',
  medicines,
  generalInstructions: 'Drink plenty of water',
  followUp: null,
});

/** A faithful English answer to `input()`. */
const good = (): ExplanationOutput => ({
  overview: 'Your doctor has given you one medicine.',
  medicines: [
    {
      name: 'Amoxicillin 500 mg',
      whatToDo: 'Take 1 capsule by mouth.',
      whenToTake: 'Three times a day (3 times a day), after eating.',
      howLong: 'For 5 days.',
      tips: ['Finish the full course.'],
    },
  ],
  followUp: '',
  questionsToAskDoctor: ['What if I miss a dose?'],
});

const withMedicine = (patch: Partial<ExplanationOutput['medicines'][number]>) => {
  const o = good();
  o.medicines[0] = { ...o.medicines[0]!, ...patch };
  return o;
};

describe('consistency', () => {
  it('passes a faithful answer', () => {
    expect(checkExplanation(good(), input())).toEqual([]);
  });

  it('blocks an invented drug – as a medicine or only named in the text', () => {
    const extra = good();
    extra.medicines.push({
      name: 'Ibuprofen 400 mg',
      whatToDo: 'Take 1 tablet.',
      whenToTake: '',
      howLong: '',
      tips: [],
    });
    expect(checkConsistency(extra, input())).toContain('medicine_not_prescribed');
    const inText = withMedicine({ tips: ['You can also take paracetamol for fever.'] });
    expect(checkConsistency(inText, input())).toContain('medicine_not_prescribed');
  });

  it('blocks a missing or renamed medicine', () => {
    const none = { ...good(), medicines: [] };
    expect(checkConsistency(none, input())).toEqual(['medicine_missing']);
    expect(checkConsistency(withMedicine({ name: 'Antibiotic' }), input())).toEqual([
      'medicine_not_prescribed',
      'medicine_missing',
    ]);
  });

  it('blocks a changed dose (500 mg → 250 mg) and a changed count of units', () => {
    expect(checkConsistency(withMedicine({ name: 'Amoxicillin 250 mg' }), input())).toEqual([
      'number_mismatch',
    ]);
    expect(checkConsistency(withMedicine({ whatToDo: 'Take 2 capsules.' }), input())).toEqual([
      'number_mismatch',
    ]);
    expect(
      checkConsistency(withMedicine({ whenToTake: 'Four times a day (4 times a day).' }), input()),
    ).toEqual(['number_mismatch']);
  });

  it('blocks a changed duration (5 → 7 days), also in Hindi with Devanagari digits', () => {
    expect(checkConsistency(withMedicine({ howLong: 'For 7 days.' }), input())).toEqual([
      'number_mismatch',
    ]);
    const hi = input('hi');
    const hindi = (howLong: string) => {
      const o = buildTemplateExplanation(hi);
      o.medicines[0] = { ...o.medicines[0]!, howLong };
      return checkConsistency(o, hi);
    };
    expect(hindi('५ दिन तक।')).toEqual([]); // ५ = 5
    expect(hindi('७ दिन तक।')).toEqual(['number_mismatch']); // ७ = 7
    expect(hindi('7 दिनों तक।')).toEqual(['number_mismatch']);
  });

  it('reads Hindi unit words and Devanagari digits as numbers with units', () => {
    expect(toWesternDigits('०१२३४५६७८९')).toBe('0123456789');
    expect(numberUnits('१ गोली, ५ मिलीलीटर, 3 बार, ५ दिन, 2 हफ़्ते, 250 मिलीग्राम')).toEqual([
      '1|tablet',
      '5|ml',
      '3|time',
      '5|day',
      '2|week',
      '250|mg',
    ]);
    expect(numberUnits('Take 5ml twice; 1-tablet; 10 days; call at 9 am')).toEqual([
      '5|ml',
      '1|tablet',
      '10|day',
    ]);
  });

  it('allows what the codes and the doctor’s text imply (times a day, hours, weeks)', () => {
    const allowed = allowedNumberUnits(input('en', [med({ durationDays: 14, frequency: 'BD' })]));
    for (const k of ['500|mg', '1|capsule', '14|day', '2|week', '2|time', '12|hour']) {
      expect(allowed.has(k), k).toBe(true);
    }
    expect(allowed.has('7|day')).toBe(false);
  });
});

describe('forbidden phrases', () => {
  const blocked = (text: string, language: 'en' | 'hi' = 'en') =>
    checkForbidden({ ...good(), overview: text }, input(language));

  it('blocks diagnosis and treatment-change wording in English', () => {
    for (const text of [
      'You have tonsillitis.',
      'You HAVE an infection',
      'This was diagnosed as a throat infection.',
      'You can stop taking it when you feel better.',
      'Increase the dose if the pain is bad.',
      'Take it instead of your other tablets.',
      "You don't need to finish the course.",
      'You don’t need the medicine after 3 days.',
    ]) {
      expect(blocked(text), text).toEqual(['forbidden_phrase']);
    }
    expect(blocked('Take it after eating, three times a day.')).toEqual([]);
  });

  it('blocks diagnosis and treatment-change wording in Hindi (with or without nukta)', () => {
    for (const text of [
      'आपको संक्रमण है।',
      'जाँच से निदान हुआ है।',
      'ठीक लगने पर दवा बंद कर दें।',
      'दर्द हो तो खुराक बढ़ा लें।',
      'इसे दूसरी दवा के बजाय लें।',
      'पूरा कोर्स करने की ज़रूरत नहीं है।',
      'पूरा कोर्स करने की जरूरत नहीं है।',
    ]) {
      expect(blocked(text, 'hi'), text).toEqual(['forbidden_phrase']);
    }
    expect(blocked('इसे खाना खाने के बाद लें।', 'hi')).toEqual([]);
  });

  it('allows a phrase the doctor wrote in the instructions', () => {
    const own = input('en', [med({ instructions: 'Stop taking if a rash appears' })]);
    const o = withMedicine({ tips: ['Stop taking it if a rash appears and call the clinic.'] });
    expect(checkForbidden(o, own)).toEqual([]);
    expect(checkForbidden({ ...o, overview: 'You have an infection.' }, own)).toEqual([
      'forbidden_phrase',
    ]);
  });
});

describe('the template explanation', () => {
  it('turns every frequency code into plain words, in English and Hindi', () => {
    for (const code of DRUG_FREQUENCY_CODES.filter((c) => c !== 'other')) {
      for (const lang of ['en', 'hi'] as const) {
        const phrase = FREQUENCY_PHRASES[code][lang];
        expect(whenToTake(med({ frequency: code, timing: null }), lang).toLowerCase()).toBe(
          `${phrase}${lang === 'hi' ? '।' : '.'}`.toLowerCase(),
        );
      }
    }
    expect(FREQUENCY_PHRASES).toMatchObject({
      OD: { en: 'once a day', hi: 'दिन में एक बार' },
      BD: { en: 'two times a day', hi: 'दिन में दो बार' },
      TDS: { en: 'three times a day', hi: 'दिन में तीन बार' },
      QID: { en: 'four times a day', hi: 'दिन में चार बार' },
      HS: { en: 'at bedtime', hi: 'रात को सोने से पहले' },
      SOS: { en: 'only when needed' },
      STAT: { en: 'right away, one time only' },
    });
  });

  it('turns every timing (before/after/with food, empty stomach) into plain words', () => {
    expect(TIMING_PHRASES).toMatchObject({
      before_food: { en: 'before eating', hi: 'खाना खाने से पहले' },
      after_food: { en: 'after eating', hi: 'खाना खाने के बाद' },
      with_food: { en: 'with food', hi: 'खाने के साथ' },
      empty_stomach: { en: 'on an empty stomach', hi: 'खाली पेट' },
    });
    for (const timing of DRUG_TIMINGS) {
      expect(whenToTake(med({ frequency: 'BD', timing }), 'en')).toBe(
        `Two times a day, ${TIMING_PHRASES[timing].en}.`,
      );
      expect(whenToTake(med({ frequency: 'BD', timing }), 'hi')).toBe(
        `दिन में दो बार, ${TIMING_PHRASES[timing].hi}।`,
      );
    }
    expect(
      whenToTake(med({ frequency: 'other', frequencyText: 'Every other day', timing: null }), 'en'),
    ).toBe('Your doctor wrote: "Every other day".');
  });

  it('builds a complete English and Hindi explanation that passes its own guardrails', () => {
    for (const lang of ['en', 'hi'] as const) {
      const i = input(lang, [
        med(),
        med({
          name: 'Cetirizine',
          genericName: 'Cetirizine',
          strength: '10 mg',
          form: 'tablet',
          dose: '1 tablet',
          frequency: 'HS',
          timing: null,
          durationDays: 3,
          instructions: null,
        }),
      ]);
      const t = buildTemplateExplanation(i);
      expect(checkExplanation(t, i)).toEqual([]);
      expect(t.medicines.map((m) => m.name)).toEqual(['Amoxicillin 500 mg', 'Cetirizine 10 mg']);
    }
    const en = buildTemplateExplanation(input('en'));
    expect(en.medicines[0]).toEqual({
      name: 'Amoxicillin 500 mg',
      whatToDo: 'Take 1 capsule by mouth.',
      whenToTake: 'Three times a day, after eating.',
      howLong: 'For 5 days.',
      tips: ['Your doctor wrote: "Finish the full course"'],
    });
    expect(en.overview).toContain('Your doctor wrote: "Drink plenty of water"');
    const hi = buildTemplateExplanation(input('hi', [med({ form: 'tablet', dose: '1 tablet' })]));
    expect(hi.medicines[0]).toMatchObject({
      whatToDo: '1 गोली मुँह से लें।',
      whenToTake: 'दिन में तीन बार, खाना खाने के बाद।',
      howLong: '5 दिन तक।',
    });
    const syrup = buildTemplateExplanation(input('hi', [med({ form: 'syrup', dose: '5 ml' })]));
    expect(syrup.medicines[0]!.whatToDo).toBe('5 मिलीलीटर मुँह से लें।');
  });

  it('explains a follow-up plan', () => {
    const plan: ExplanationInput = {
      ...input('en', []),
      explains: 'follow_up_plan',
      generalInstructions: null,
      followUp: { afterDays: 7, date: '2026-10-16', instructions: 'Bring your reports' },
    };
    const en = buildTemplateExplanation(plan);
    expect(en.followUp).toBe(
      'Please come back after 7 days (on 2026-10-16). Your doctor wrote: "Bring your reports"',
    );
    expect(checkExplanation(en, plan)).toEqual([]);
    const hi = buildTemplateExplanation({ ...plan, language: 'hi' });
    expect(hi.followUp).toContain('कृपया 7 दिन बाद दोबारा आएँ (2026-10-16 को)।');
    expect(checkExplanation(hi, { ...plan, language: 'hi' })).toEqual([]);
  });
});
