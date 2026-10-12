import type { ExplanationLanguage } from '../config/constants.js';
import {
  FORM_PHRASES,
  FREQUENCY_PHRASES,
  ROUTE_PHRASES,
  TIMING_PHRASES,
} from '../data/abbreviations.js';
import type {
  ExplanationInput,
  ExplanationMedicine,
  ExplanationOutput,
} from './prompts/patientExplanation.v1.js';

/**
 * The deterministic template explanation (spec §9.3 guardrail 2 fallback): built only from the
 * structured prescription / follow-up plan with the reviewed en + hi phrase dictionary, so the
 * patient still gets help when the model's text is blocked or the AI is unavailable. Numbers
 * stay as written (Western digits); the doctor's free text is quoted, never reworded.
 */

const TEXT = {
  overviewRx: {
    en: (n: number) =>
      n === 1
        ? 'Your doctor prescribed one medicine. Here is how to take it, in simple words.'
        : 'Your doctor prescribed these medicines. Here is how to take each one, in simple words.',
    hi: (n: number) =>
      n === 1
        ? 'आपके डॉक्टर ने एक दवा लिखी है। इसे कैसे लेना है, यह आसान शब्दों में नीचे दिया है।'
        : 'आपके डॉक्टर ने ये दवाएँ लिखी हैं। हर दवा कैसे लेनी है, यह आसान शब्दों में नीचे दिया है।',
  },
  overviewFollowUp: {
    en: 'Your doctor wants to see you again for a follow-up visit.',
    hi: 'आपके डॉक्टर आपको दोबारा जाँच के लिए देखना चाहते हैं।',
  },
  doctorWrote: {
    en: (t: string) => `Your doctor wrote: "${t}"`,
    hi: (t: string) => `डॉक्टर ने लिखा है: "${t}"`,
  },
  take: {
    en: (what: string, how: string, oral: boolean) =>
      `${oral ? 'Take' : 'Use'} ${what}${how ? ` ${how}` : ''}.`,
    hi: (what: string, how: string, oral: boolean) =>
      `${what}${how ? ` ${how}` : ''} ${oral ? 'लें' : 'इस्तेमाल करें'}।`,
  },
  theDose: { en: 'the dose your doctor wrote', hi: 'डॉक्टर की लिखी खुराक' },
  forDays: {
    en: (d: number) => `For ${d} days.`,
    hi: (d: number) => `${d} दिन तक।`,
  },
  askHowLong: {
    en: 'Please ask your doctor or the clinic how long to take it.',
    hi: 'इसे कितने दिन लेना है, कृपया अपने डॉक्टर या क्लिनिक से पूछें।',
  },
  askWhen: {
    en: 'Please ask your doctor or the clinic when to take it.',
    hi: 'इसे कब लेना है, कृपया अपने डॉक्टर या क्लिनिक से पूछें।',
  },
  comeBack: {
    en: (days: number | null, date: string | null) =>
      [
        days ? `Please come back after ${days} days` : 'Please come back for a follow-up visit',
        date ? ` (on ${date})` : '',
        '.',
      ].join(''),
    hi: (days: number | null, date: string | null) =>
      [
        days ? `कृपया ${days} दिन बाद दोबारा आएँ` : 'कृपया दोबारा जाँच के लिए आएँ',
        date ? ` (${date} को)` : '',
        '।',
      ].join(''),
  },
} as const;

/** Dose units translated for Hindi ("1 tablet" → "1 गोली"); anything else stays as written. */
const HI_DOSE_UNITS: [RegExp, string][] = [
  [/\btablets?\b|\btabs?\b/gi, 'गोली'],
  [/\bcapsules?\b|\bcaps?\b/gi, 'कैप्सूल'],
  [/\bml\b|\bmillilit(?:re|er)s?\b/gi, 'मिलीलीटर'],
  [/\bdrops?\b/gi, 'बूँदें'],
  [/\bpuffs?\b/gi, 'पफ'],
  [/\bunits?\b/gi, 'यूनिट'],
];

export function doseIn(dose: string, language: ExplanationLanguage): string {
  if (language === 'en') return dose;
  return HI_DOSE_UNITS.reduce((d, [re, word]) => d.replace(re, word), dose);
}

/** "Amoxicillin 500 mg" – the name the patient sees on the prescription. */
export const medicineLabel = (m: ExplanationMedicine) =>
  m.strength && !m.name.includes(m.strength) ? `${m.name} ${m.strength}` : m.name;

export function whenToTake(m: ExplanationMedicine, language: ExplanationLanguage): string {
  const parts: string[] = [];
  if (m.frequency === 'other' || (!m.frequency && m.frequencyText)) {
    if (m.frequencyText) parts.push(TEXT.doctorWrote[language](m.frequencyText));
  } else if (m.frequency) {
    parts.push(FREQUENCY_PHRASES[m.frequency][language]);
  }
  if (m.timing) parts.push(TIMING_PHRASES[m.timing][language]);
  if (parts.length === 0) return TEXT.askWhen[language];
  const joined = parts.join(', ');
  const sentence = joined.charAt(0).toUpperCase() + joined.slice(1);
  return language === 'hi' ? `${sentence}।` : `${sentence}.`;
}

function medicine(m: ExplanationMedicine, language: ExplanationLanguage) {
  const oral = !m.route || m.route === 'oral';
  const what = m.dose
    ? doseIn(m.dose, language)
    : m.form
      ? `${TEXT.theDose[language]} (${FORM_PHRASES[m.form][language]})`
      : TEXT.theDose[language];
  return {
    name: medicineLabel(m),
    whatToDo: TEXT.take[language](what, m.route ? ROUTE_PHRASES[m.route][language] : '', oral),
    whenToTake: whenToTake(m, language),
    howLong: m.durationDays ? TEXT.forDays[language](m.durationDays) : TEXT.askHowLong[language],
    tips: m.instructions ? [TEXT.doctorWrote[language](m.instructions)] : [],
  };
}

export function buildTemplateExplanation(input: ExplanationInput): ExplanationOutput {
  const lang = input.language;
  const overview =
    input.explains === 'prescription'
      ? TEXT.overviewRx[lang](input.medicines.length)
      : TEXT.overviewFollowUp[lang];
  const extra = input.generalInstructions
    ? ` ${TEXT.doctorWrote[lang](input.generalInstructions)}`
    : '';
  const followUp = input.followUp
    ? [
        TEXT.comeBack[lang](input.followUp.afterDays, input.followUp.date),
        input.followUp.instructions ? TEXT.doctorWrote[lang](input.followUp.instructions) : '',
      ]
        .filter(Boolean)
        .join(' ')
    : '';
  return {
    overview: `${overview}${extra}`,
    medicines: input.medicines.map((m) => medicine(m, lang)),
    followUp,
    questionsToAskDoctor: [],
  };
}
