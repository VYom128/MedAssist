import { FORMULARY, type FormularyDrug } from '../../data/formulary.js';

const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Pre-lower-cased names, built once. */
const INDEX = FORMULARY.map((drug) => ({
  drug,
  name: key(drug.name),
  generic: key(drug.genericName),
}));

/**
 * GET /formulary?q= – drugs whose name or generic name starts with `q` (case-insensitive),
 * name matches first, then alphabetical. Plain string comparison: no regex from user input.
 */
export function searchFormulary(q: string, limit: number): FormularyDrug[] {
  const needle = key(q);
  if (!needle) return [];
  return INDEX.filter((e) => e.name.startsWith(needle) || e.generic.startsWith(needle))
    .sort((a, b) => {
      const rank = (e: (typeof INDEX)[number]) => (e.name.startsWith(needle) ? 0 : 1);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map((e) => e.drug);
}
