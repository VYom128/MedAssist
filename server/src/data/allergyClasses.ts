/**
 * A small curated map of drug classes for the prescription allergy check (spec §8.6). When a
 * recorded allergy names a class (an alias such as "penicillin" or "sulfa") or one of its
 * members (an amoxicillin allergy is a penicillin allergy), every member of the class gets a
 * warning. This is a convenience list for common outpatient drugs – not a drug-allergy
 * database, and deliberately not exhaustive. Names are matched after `normaliseDrugName`.
 */
export interface AllergyClass {
  /** Shown in the warning ("Penicillins"). */
  name: string;
  /** What patients and staff write for the class. */
  aliases: readonly string[];
  /** Generic names (and common combination/brand names) in the class. */
  members: readonly string[];
}

export const ALLERGY_CLASSES: readonly AllergyClass[] = Object.freeze([
  {
    name: 'Penicillins',
    aliases: ['penicillin', 'penicillins', 'pcn'],
    members: [
      'penicillin',
      'penicillin v',
      'phenoxymethylpenicillin',
      'benzathine penicillin',
      'benzylpenicillin',
      'amoxicillin',
      'amoxycillin',
      'ampicillin',
      'cloxacillin',
      'dicloxacillin',
      'flucloxacillin',
      'piperacillin',
      'co-amoxiclav',
      'augmentin',
    ],
  },
  {
    name: 'Cephalosporins',
    aliases: ['cephalosporin', 'cephalosporins'],
    members: [
      'cephalexin',
      'cefalexin',
      'cefadroxil',
      'cefuroxime',
      'cefixime',
      'cefpodoxime',
      'cefdinir',
      'cefotaxime',
      'ceftriaxone',
      'ceftazidime',
    ],
  },
  {
    name: 'Sulfonamides',
    aliases: ['sulfa', 'sulpha', 'sulfonamide', 'sulfonamides', 'sulphonamide', 'sulphonamides'],
    members: [
      'sulfamethoxazole',
      'sulphamethoxazole',
      'co-trimoxazole',
      'sulfadiazine',
      'sulfasalazine',
    ],
  },
  {
    name: 'NSAIDs',
    aliases: [
      'nsaid',
      'nsaids',
      'non-steroidal anti-inflammatory',
      'non-steroidal anti-inflammatories',
    ],
    members: [
      'ibuprofen',
      'diclofenac',
      'aceclofenac',
      'aspirin',
      'acetylsalicylic acid',
      'naproxen',
      'mefenamic acid',
      'etoricoxib',
      'celecoxib',
      'ketorolac',
      'piroxicam',
      'indomethacin',
      'nimesulide',
    ],
  },
  {
    name: 'Macrolides',
    aliases: ['macrolide', 'macrolides'],
    members: ['azithromycin', 'clarithromycin', 'erythromycin', 'roxithromycin'],
  },
  {
    name: 'Fluoroquinolones',
    aliases: ['quinolone', 'quinolones', 'fluoroquinolone', 'fluoroquinolones'],
    members: ['ciprofloxacin', 'ofloxacin', 'levofloxacin', 'moxifloxacin', 'norfloxacin'],
  },
  {
    name: 'Tetracyclines',
    aliases: ['tetracycline', 'tetracyclines'],
    members: ['tetracycline', 'doxycycline', 'minocycline'],
  },
  {
    name: 'Opioids',
    aliases: ['opioid', 'opioids', 'opiate', 'opiates'],
    members: ['tramadol', 'codeine', 'morphine', 'tapentadol', 'fentanyl'],
  },
  {
    name: 'ACE inhibitors',
    aliases: ['ace inhibitor', 'ace inhibitors'],
    members: ['enalapril', 'ramipril', 'lisinopril', 'perindopril', 'captopril'],
  },
  {
    name: 'Azole antifungals',
    aliases: ['azole', 'azoles', 'azole antifungals'],
    members: ['fluconazole', 'ketoconazole', 'itraconazole', 'clotrimazole', 'miconazole'],
  },
]);
