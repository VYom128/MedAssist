import { ALLERGY_CLASSES } from '../data/allergyClasses.js';
import { FORMULARY } from '../data/formulary.js';

/**
 * Prescription allergy check (spec §4.7, §8.6): a convenience NAME match between prescribed
 * drugs and the patient's recorded allergy substances, plus a small curated drug-class map
 * (data/allergyClasses.ts). It is not clinical decision support and not a drug-interaction
 * engine: it cannot know every brand, class or cross-reaction, and says so wherever it shows.
 *
 * Matching is on whole normalised names, never substrings, so "Penicillamine" does not match a
 * penicillin allergy and "Amoxapine" does not match amoxicillin.
 */

export interface AllergyMatch {
  /** The recorded allergy substance, as written on the patient's record. */
  substance: string;
  /** 'drug': the drug itself; 'class': a drug of the same class as the allergy. */
  matchedOn: 'drug' | 'class';
  /** The class name for class matches ("Penicillins"). */
  drugClass: string | null;
}

/** Dosage forms and release words that are not part of a drug's name. */
const FORM_WORDS = new Set([
  'tablet',
  'tablets',
  'tab',
  'tabs',
  'capsule',
  'capsules',
  'cap',
  'caps',
  'syrup',
  'suspension',
  'susp',
  'drops',
  'drop',
  'eye',
  'ear',
  'nasal',
  'cream',
  'ointment',
  'gel',
  'lotion',
  'injection',
  'inj',
  'inhaler',
  'spray',
  'solution',
  'sachet',
  'sr',
  'er',
  'mr',
  'xr',
  'cr',
  'ds',
  'forte',
  'oral',
]);

/** Salt names written after the active ingredient ("diclofenac sodium"). */
const SALT_WORDS = new Set([
  'sodium',
  'potassium',
  'hydrochloride',
  'hcl',
  'sulphate',
  'sulfate',
  'trihydrate',
  'dihydrate',
  'monohydrate',
  'succinate',
  'tartrate',
  'maleate',
  'besylate',
  'besilate',
  'mesylate',
  'fumarate',
]);

/** Words people add to allergy entries ("penicillin group", "sulfa drugs"). */
const ALLERGY_FILLER_WORDS = new Set([
  'drug',
  'drugs',
  'antibiotic',
  'antibiotics',
  'group',
  'class',
  'family',
  'allergy',
  'allergic',
  'medicines',
  'medicine',
]);

/** "Amoxicillin + Clavulanic acid", "Sulfamethoxazole/Trimethoprim" → one entry per drug. */
const COMPONENT_SEPARATOR = /\s*(?:\+|\/|&|,|;|\band\b|\bwith\b)\s*/;

/** Lower case, no brackets, strengths, numbers, punctuation, form or salt words. */
function normaliseComponent(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|µg|g|gm|ml|iu|units?|%)(?=\s|$)/g, ' ')
    .replace(/\d+(\.\d+)?%?/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FORM_WORDS.has(w) && !ALLERGY_FILLER_WORDS.has(w));
  while (words.length > 1 && SALT_WORDS.has(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

/** The normalised drug names in `raw` (one per component of a combination). */
export function drugComponents(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const withoutBrackets = raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  return withoutBrackets
    .toLowerCase()
    .split(COMPONENT_SEPARATOR)
    .map(normaliseComponent)
    .filter(Boolean);
}

/** Formulary names (brands included) → their generic name, for drugs typed without one. */
const FORMULARY_GENERIC = new Map(
  FORMULARY.map((d) => [drugComponents(d.name).join(' + '), d.genericName]),
);

/**
 * The generic name of a formulary drug typed by its name or brand, with extra words after it
 * ("Augmentin 625 Duo" → Augmentin → Amoxicillin + Clavulanic acid).
 */
function formularyGeneric(drugName: string): string | undefined {
  const key = drugComponents(drugName).join(' + ');
  const exact = FORMULARY_GENERIC.get(key);
  if (exact || key.includes('+')) return exact;
  const words = key.split(' ');
  for (let n = words.length - 1; n >= 1; n -= 1) {
    const hit = FORMULARY_GENERIC.get(words.slice(0, n).join(' '));
    if (hit) return hit;
  }
  return undefined;
}

interface PreparedClass {
  name: string;
  triggers: Set<string>;
  members: Set<string>;
}
const CLASSES: PreparedClass[] = ALLERGY_CLASSES.map((c) => ({
  name: c.name,
  triggers: new Set([...c.aliases, ...c.members].flatMap(drugComponents)),
  members: new Set(c.members.flatMap(drugComponents)),
}));

/** Every normalised name an item could be known by (drug name, generic, formulary generic). */
function namesOf(item: { drugName: string; genericName?: string | null }): Set<string> {
  const names = new Set([...drugComponents(item.drugName), ...drugComponents(item.genericName)]);
  for (const n of drugComponents(formularyGeneric(item.drugName))) names.add(n);
  return names;
}

/**
 * For each item, the first recorded allergy it matches (the drug itself first, then its class),
 * or null. Pure: no database access.
 */
export function checkAllergies(
  items: readonly { drugName: string; genericName?: string | null }[],
  allergies: readonly { substance: string }[],
): (AllergyMatch | null)[] {
  const prepared = allergies.map((a) => {
    const names = drugComponents(a.substance);
    return {
      substance: a.substance,
      names: new Set(names),
      classes: CLASSES.filter((c) => names.some((n) => c.triggers.has(n))),
    };
  });

  return items.map((item) => {
    const names = namesOf(item);
    for (const a of prepared) {
      if ([...a.names].some((n) => names.has(n))) {
        return { substance: a.substance, matchedOn: 'drug', drugClass: null };
      }
    }
    for (const a of prepared) {
      const cls = a.classes.find((c) => [...names].some((n) => c.members.has(n)));
      if (cls) return { substance: a.substance, matchedOn: 'class', drugClass: cls.name };
    }
    return null;
  });
}

/** A stable key for "the same drug" (acknowledgements survive re-saves of an unchanged drug). */
export function drugKey(item: { drugName: string; genericName?: string | null }): string {
  return [...namesOf(item)].sort().join('|') || item.drugName.trim().toLowerCase();
}
