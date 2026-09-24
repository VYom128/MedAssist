import { ALLERGY_CLASSES } from '../../src/data/allergyClasses.js';
import { checkAllergies, drugComponents, drugKey } from '../../src/services/allergyCheck.js';

/** Allergy check (spec §8.6): a convenience name match plus the curated class map. */

const check = (drugName: string, substances: string[], genericName?: string) =>
  checkAllergies(
    [{ drugName, genericName }],
    substances.map((substance) => ({ substance })),
  )[0];

describe('drugComponents (normalisation)', () => {
  it('ignores case, spacing, strengths, forms, brackets and salt suffixes', () => {
    expect(drugComponents('  AMOXICILLIN   500mg  Capsules ')).toEqual(['amoxicillin']);
    expect(drugComponents('Diclofenac Sodium 50 mg tab')).toEqual(['diclofenac']);
    expect(drugComponents('Metoprolol succinate ER')).toEqual(['metoprolol']);
    expect(drugComponents('Cetirizine (10 mg)')).toEqual(['cetirizine']);
    expect(drugComponents('Dolo 650')).toEqual(['dolo']);
  });

  it('splits combinations into their drugs', () => {
    expect(drugComponents('Amoxicillin + Clavulanic acid')).toEqual([
      'amoxicillin',
      'clavulanic acid',
    ]);
    expect(drugComponents('Sulfamethoxazole/Trimethoprim')).toEqual([
      'sulfamethoxazole',
      'trimethoprim',
    ]);
    expect(drugComponents('Paracetamol and Caffeine')).toEqual(['paracetamol', 'caffeine']);
  });

  it('drops filler words people write in allergy entries', () => {
    expect(drugComponents('Sulfa drugs')).toEqual(['sulfa']);
    expect(drugComponents('Penicillin group antibiotics')).toEqual(['penicillin']);
    expect(drugComponents('')).toEqual([]);
    expect(drugComponents(null)).toEqual([]);
  });
});

describe('checkAllergies – direct matches', () => {
  it('matches the drug name or generic name, case- and spacing-insensitively', () => {
    expect(check('Ibuprofen 400 mg', ['ibuprofen'])).toEqual({
      substance: 'ibuprofen',
      matchedOn: 'drug',
      drugClass: null,
    });
    expect(check('Brufen', ['  IBUPROFEN '], 'Ibuprofen')).toMatchObject({ matchedOn: 'drug' });
    expect(check('Metronidazole', ['Metronidazole (rash)'])).toMatchObject({ matchedOn: 'drug' });
  });

  it('matches one drug of a combination', () => {
    expect(
      check('Co-amoxiclav 625', ['Clavulanic acid'], 'Amoxicillin + Clavulanic acid'),
    ).toMatchObject({ matchedOn: 'drug', substance: 'Clavulanic acid' });
  });

  it('resolves formulary brand names typed without a generic', () => {
    expect(check('Augmentin 625 Duo', ['Amoxicillin'])).toMatchObject({ matchedOn: 'drug' });
    expect(check('Dolo 650', ['Paracetamol'])).toMatchObject({ matchedOn: 'drug' });
    expect(check('Pan 40', ['pantoprazole'])).toMatchObject({ matchedOn: 'drug' });
  });

  it('prefers a direct match over a class match', () => {
    expect(check('Amoxicillin', ['Penicillin', 'Amoxicillin'])).toMatchObject({
      substance: 'Amoxicillin',
      matchedOn: 'drug',
    });
  });
});

describe('checkAllergies – class map', () => {
  it('the three classes from the phase decisions', () => {
    for (const drug of ['Amoxicillin', 'Ampicillin', 'Co-amoxiclav', 'Cloxacillin']) {
      expect(check(drug, ['Penicillin']), drug).toMatchObject({
        matchedOn: 'class',
        drugClass: 'Penicillins',
        substance: 'Penicillin',
      });
    }
    for (const drug of ['Co-trimoxazole DS', 'Sulfamethoxazole']) {
      expect(check(drug, ['Sulfa drugs']), drug).toMatchObject({ drugClass: 'Sulfonamides' });
    }
    for (const drug of ['Ibuprofen', 'Diclofenac sodium', 'Aspirin 75']) {
      expect(check(drug, ['NSAIDs']), drug).toMatchObject({ drugClass: 'NSAIDs' });
    }
    expect(check('Ecosprin', ['nsaid'], 'Acetylsalicylic acid')).toMatchObject({
      drugClass: 'NSAIDs',
    });
  });

  it('an allergy to one member warns about the rest of its class', () => {
    expect(check('Ampicillin', ['Amoxicillin'])).toMatchObject({
      matchedOn: 'class',
      drugClass: 'Penicillins',
    });
    expect(check('Cefuroxime', ['Cefixime'])).toMatchObject({ drugClass: 'Cephalosporins' });
    expect(check('Clarithromycin', ['Azithromycin'])).toMatchObject({ drugClass: 'Macrolides' });
  });

  it('class members are consistent (every class has aliases and members)', () => {
    for (const c of ALLERGY_CLASSES) {
      expect(c.aliases.length, c.name).toBeGreaterThan(0);
      expect(c.members.length, c.name).toBeGreaterThan(1);
    }
  });
});

describe('checkAllergies – no false positives on similar names', () => {
  const cases: [string, string][] = [
    ['Penicillamine', 'Penicillin'],
    ['Amoxapine', 'Amoxicillin'],
    ['Metformin', 'Metronidazole'],
    ['Cefixime', 'Cef'],
    ['Paracetamol', 'NSAIDs'],
    ['Sulfur ointment', 'Sulfa'],
    ['Asparaginase', 'Aspirin'],
    ['Cetirizine', 'Ceftriaxone'],
    ['Amlodipine', 'Penicillin'],
    ['Prednisolone', 'Prednisone'],
  ];
  for (const [drug, allergy] of cases) {
    it(`${drug} vs an allergy to ${allergy} → no warning`, () => {
      expect(check(drug, [allergy])).toBeNull();
    });
  }

  it('non-drug allergies never match', () => {
    expect(check('Amoxicillin', ['Dust', 'Latex', 'Peanuts', 'Eggs'])).toBeNull();
    expect(checkAllergies([{ drugName: 'Amoxicillin' }], [])).toEqual([null]);
  });
});

describe('drugKey', () => {
  it('is the same for the same drug whatever the strength, form or spacing', () => {
    expect(drugKey({ drugName: 'Amoxicillin 500 mg caps' })).toBe(
      drugKey({ drugName: ' amoxicillin 250mg' }),
    );
    expect(drugKey({ drugName: 'Amoxicillin' })).not.toBe(drugKey({ drugName: 'Ampicillin' }));
  });
});
