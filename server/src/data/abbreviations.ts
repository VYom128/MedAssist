import type {
  DrugForm,
  DrugFrequency,
  DrugRoute,
  DrugTiming,
  ExplanationLanguage,
} from '../config/constants.js';

/**
 * Plain-language phrases for prescription codes (spec §9.3 "convert abbreviations"), in English
 * and Hindi. Used by the template explanation (the guardrail fallback) and given to the model as
 * the approved wording. `timesPerDay` is the count an abbreviation implies (BD → 2), so "2 times
 * a day" for BD is consistent with the prescription. Clinic-reviewed wording; changing it is a
 * reviewed code change.
 */
type Phrase = Record<ExplanationLanguage, string>;

export const FREQUENCY_PHRASES: Record<DrugFrequency, Phrase & { timesPerDay?: number }> = {
  OD: { en: 'once a day', hi: 'दिन में एक बार', timesPerDay: 1 },
  BD: { en: 'two times a day', hi: 'दिन में दो बार', timesPerDay: 2 },
  TDS: { en: 'three times a day', hi: 'दिन में तीन बार', timesPerDay: 3 },
  QID: { en: 'four times a day', hi: 'दिन में चार बार', timesPerDay: 4 },
  HS: { en: 'at bedtime', hi: 'रात को सोने से पहले', timesPerDay: 1 },
  SOS: { en: 'only when needed', hi: 'केवल ज़रूरत होने पर' },
  STAT: { en: 'right away, one time only', hi: 'तुरंत, केवल एक बार', timesPerDay: 1 },
  weekly: { en: 'once a week', hi: 'हफ़्ते में एक बार' },
  other: { en: 'as your doctor wrote', hi: 'जैसा डॉक्टर ने लिखा है' },
};

/** Timing codes (spec §6.16) – before/after/with food, empty stomach. */
export const TIMING_PHRASES: Record<DrugTiming, Phrase> = {
  before_food: { en: 'before eating', hi: 'खाना खाने से पहले' },
  after_food: { en: 'after eating', hi: 'खाना खाने के बाद' },
  with_food: { en: 'with food', hi: 'खाने के साथ' },
  empty_stomach: { en: 'on an empty stomach', hi: 'खाली पेट' },
  any: { en: 'at any time of the day', hi: 'दिन में किसी भी समय' },
};

export const ROUTE_PHRASES: Record<DrugRoute, Phrase> = {
  oral: { en: 'by mouth', hi: 'मुँह से' },
  topical: { en: 'on the skin', hi: 'त्वचा पर' },
  iv: { en: 'into a vein (given at the clinic)', hi: 'नस में (क्लिनिक में दिया जाएगा)' },
  im: { en: 'as an injection into a muscle', hi: 'मांसपेशी में इंजेक्शन से' },
  sc: { en: 'as an injection under the skin', hi: 'त्वचा के नीचे इंजेक्शन से' },
  inhalation: { en: 'by breathing it in', hi: 'सांस से अंदर लेकर' },
  ophthalmic: { en: 'in the eye', hi: 'आँख में' },
  otic: { en: 'in the ear', hi: 'कान में' },
  nasal: { en: 'in the nose', hi: 'नाक में' },
  other: { en: 'as your doctor showed you', hi: 'जैसा डॉक्टर ने बताया है' },
};

export const FORM_PHRASES: Record<DrugForm, Phrase> = {
  tablet: { en: 'tablet', hi: 'गोली' },
  capsule: { en: 'capsule', hi: 'कैप्सूल' },
  syrup: { en: 'syrup', hi: 'सिरप' },
  injection: { en: 'injection', hi: 'इंजेक्शन' },
  drops: { en: 'drops', hi: 'बूँदें' },
  cream: { en: 'cream', hi: 'क्रीम' },
  ointment: { en: 'ointment', hi: 'मरहम' },
  inhaler: { en: 'inhaler', hi: 'इनहेलर' },
  other: { en: 'medicine', hi: 'दवा' },
};

/**
 * Units the consistency check compares, each with the words that mean it in English and Hindi.
 * The canonical key is what numbers are compared by ("5 ml" = "5 मिलीलीटर").
 */
export const UNIT_WORDS: Record<string, readonly string[]> = {
  mg: ['mg', 'milligram', 'milligrams', 'मिलीग्राम', 'एमजी'],
  mcg: ['mcg', 'µg', 'microgram', 'micrograms', 'माइक्रोग्राम'],
  g: ['g', 'gm', 'gram', 'grams', 'ग्राम'],
  ml: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters', 'मिलीलीटर', 'मिली', 'एमएल'],
  tablet: ['tablet', 'tablets', 'tab', 'tabs', 'गोली', 'गोलियां', 'गोलियाँ', 'टैबलेट'],
  capsule: ['capsule', 'capsules', 'cap', 'caps', 'कैप्सूल'],
  drop: ['drop', 'drops', 'बूंद', 'बूंदें', 'बूँद', 'बूँदें', 'ड्रॉप', 'ड्रॉप्स'],
  puff: ['puff', 'puffs', 'पफ'],
  unit: ['unit', 'units', 'यूनिट'],
  day: ['day', 'days', 'दिन', 'दिनों'],
  week: ['week', 'weeks', 'हफ्ता', 'हफ्ते', 'हफ़्ते', 'हफ़्ता', 'सप्ताह'],
  month: ['month', 'months', 'महीना', 'महीने'],
  time: ['time', 'times', 'बार'],
  hour: ['hour', 'hours', 'घंटे', 'घंटा', 'घंटों'],
};
