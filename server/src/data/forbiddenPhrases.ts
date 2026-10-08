import type { ExplanationLanguage } from '../config/constants.js';

/**
 * Phrases a patient explanation must never contain (spec §9.3 guardrail 2): diagnosing, telling
 * the patient what illness they have, or changing, stopping, skipping or replacing a medicine.
 * English is matched case-insensitively at a word start ("diagnos" also catches "diagnosis",
 * "diagnosed"); Hindi is matched after removing the nukta (ज़ = ज) and with ँ/ं treated alike.
 * A hit blocks the model's text; after one regeneration the patient gets the template.
 *
 * One config file for both languages. The Hindi list is a draft for clinical review.
 */
export const FORBIDDEN_PHRASES: Record<ExplanationLanguage, readonly string[]> = {
  en: [
    'you have',
    "you've got",
    'you are suffering',
    'suffering from',
    'diagnos',
    'stop taking',
    'stop the medicine',
    'stop this medicine',
    'increase the dose',
    'decrease the dose',
    'reduce the dose',
    'change the dose',
    'adjust the dose',
    'double the dose',
    'take extra',
    'take more',
    'take less',
    'instead of',
    "you don't need",
    'you do not need',
    'no need to take',
    'not necessary to take',
    'skip',
  ],
  hi: [
    'आपको यह बीमारी',
    'आपको बीमारी है',
    'आपको रोग है',
    'आपको संक्रमण है',
    'आप पीड़ित हैं',
    'से पीड़ित',
    'निदान',
    'डायग्नोसिस',
    'दवा बंद',
    'लेना बंद',
    'बंद कर दें',
    'खुराक बढ़ा',
    'खुराक कम',
    'डोज़ बढ़ा',
    'डोज़ कम',
    'दोगुनी खुराक',
    'डबल डोज़',
    'के बजाय',
    'की जगह',
    'ज़रूरत नहीं',
    'छोड़ दें',
    'छोड़ सकते',
    'खुराक छोड़',
  ],
};
