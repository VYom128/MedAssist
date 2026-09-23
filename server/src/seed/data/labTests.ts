import type { CreateLabTestInput } from '../../modules/labTests/validation.js';

/**
 * Lab test catalogue demo data (spec §15.3): 15 common tests with parameters, units and adult
 * reference ranges (typical Indian lab values; demo only, not clinical guidance). Ranges are
 * sex-specific where labs usually report them so. Critical limits are set on the few values that
 * trigger urgent calls.
 */

type Test = Omit<CreateLabTestInput, 'turnaroundHours'> & { turnaroundHours?: number };
type Range = NonNullable<Test['parameters'][number]['ranges']>[number];

const any = (
  low: number | undefined,
  high: number | undefined,
  extra: Partial<Range> = {},
): Range => ({
  gender: 'any',
  ...(low !== undefined ? { low } : {}),
  ...(high !== undefined ? { high } : {}),
  ...extra,
});
const bySex = (
  male: [number, number],
  female: [number, number],
  extra: Partial<Range> = {},
): Range[] => [
  { gender: 'male', low: male[0], high: male[1], ...extra },
  { gender: 'female', low: female[0], high: female[1], ...extra },
];
const num = (key: string, name: string, unit: string, ranges: Range[]) => ({
  key,
  name,
  ...(unit ? { unit } : {}), // pH and specific gravity have no unit
  valueType: 'number' as const,
  ranges,
});
const option = (key: string, name: string, options: string[]) => ({
  key,
  name,
  valueType: 'option' as const,
  options,
});
const text = (key: string, name: string, unit?: string) => ({
  key,
  name,
  valueType: 'text' as const,
  ...(unit ? { unit } : {}),
});

export const LAB_TESTS: Test[] = [
  {
    code: 'CBC',
    name: 'Complete Blood Count',
    category: 'haematology',
    sampleType: 'blood',
    pricePaise: 35_000,
    turnaroundHours: 6,
    preparation: 'No fasting needed',
    parameters: [
      num('hb', 'Haemoglobin', 'g/dL', [
        { gender: 'male', ageMinYears: 18, low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
        {
          gender: 'female',
          ageMinYears: 18,
          low: 12,
          high: 15.5,
          criticalLow: 7,
          criticalHigh: 20,
        },
        any(11, 16, { ageMaxYears: 17, criticalLow: 7, criticalHigh: 20 }),
      ]),
      num('rbc', 'RBC count', 'million/µL', bySex([4.5, 5.9], [4.1, 5.1])),
      num('pcv', 'Packed cell volume (PCV)', '%', bySex([40, 52], [36, 48])),
      num('mcv', 'Mean corpuscular volume (MCV)', 'fL', [any(80, 100)]),
      num('wbc', 'Total WBC count', '/µL', [
        any(4_000, 11_000, { criticalLow: 2_000, criticalHigh: 30_000 }),
      ]),
      num('platelets', 'Platelet count', '/µL', [
        any(150_000, 450_000, { criticalLow: 20_000, criticalHigh: 1_000_000 }),
      ]),
    ],
  },
  {
    code: 'LFT',
    name: 'Liver Function Test',
    category: 'biochemistry',
    sampleType: 'blood',
    pricePaise: 60_000,
    turnaroundHours: 12,
    preparation: 'Fasting 8 hours preferred',
    parameters: [
      num('bilirubin_total', 'Bilirubin, total', 'mg/dL', [any(0.3, 1.2, { criticalHigh: 15 })]),
      num('bilirubin_direct', 'Bilirubin, direct', 'mg/dL', [any(0, 0.3)]),
      num('ast', 'AST (SGOT)', 'U/L', [any(5, 40)]),
      num('alt', 'ALT (SGPT)', 'U/L', [any(7, 56)]),
      num('alp', 'Alkaline phosphatase', 'U/L', [any(44, 147)]),
      num('total_protein', 'Total protein', 'g/dL', [any(6, 8.3)]),
      num('albumin', 'Albumin', 'g/dL', [any(3.5, 5)]),
    ],
  },
  {
    code: 'KFT',
    name: 'Kidney Function Test',
    category: 'biochemistry',
    sampleType: 'blood',
    pricePaise: 55_000,
    turnaroundHours: 12,
    parameters: [
      num('urea', 'Blood urea', 'mg/dL', [any(15, 40, { criticalHigh: 200 })]),
      num(
        'creatinine',
        'Serum creatinine',
        'mg/dL',
        bySex([0.7, 1.3], [0.6, 1.1], { criticalHigh: 10 }),
      ),
      num('uric_acid', 'Uric acid', 'mg/dL', bySex([3.4, 7], [2.4, 6])),
    ],
  },
  {
    code: 'LIPID',
    name: 'Lipid Profile',
    category: 'biochemistry',
    sampleType: 'blood',
    pricePaise: 60_000,
    turnaroundHours: 12,
    preparation: 'Fasting 10–12 hours (water allowed)',
    parameters: [
      num('cholesterol_total', 'Total cholesterol', 'mg/dL', [
        any(undefined, 200, { text: '< 200 desirable' }),
      ]),
      num('triglycerides', 'Triglycerides', 'mg/dL', [
        any(undefined, 150, { text: '< 150 normal' }),
      ]),
      num('hdl', 'HDL cholesterol', 'mg/dL', [
        { gender: 'male', low: 40, text: '> 40 desirable' },
        { gender: 'female', low: 50, text: '> 50 desirable' },
      ]),
      num('ldl', 'LDL cholesterol', 'mg/dL', [any(undefined, 100, { text: '< 100 optimal' })]),
      num('vldl', 'VLDL cholesterol', 'mg/dL', [any(5, 40)]),
    ],
  },
  {
    code: 'HBA1C',
    name: 'Glycated Haemoglobin (HbA1c)',
    category: 'biochemistry',
    sampleType: 'blood',
    pricePaise: 45_000,
    turnaroundHours: 12,
    preparation: 'No fasting needed',
    parameters: [
      num('hba1c', 'HbA1c', '%', [
        any(4, 5.6, { text: '< 5.7 normal; 5.7–6.4 prediabetes; ≥ 6.5 diabetes' }),
      ]),
    ],
  },
  {
    code: 'FBS',
    name: 'Fasting Blood Sugar',
    category: 'biochemistry',
    sampleType: 'blood',
    pricePaise: 10_000,
    turnaroundHours: 4,
    preparation: 'Fasting 8–10 hours (water allowed)',
    parameters: [
      num('glucose_fasting', 'Glucose, fasting', 'mg/dL', [
        any(70, 100, { criticalLow: 40, criticalHigh: 450 }),
      ]),
    ],
  },
  {
    code: 'TSH',
    name: 'Thyroid Stimulating Hormone',
    category: 'immunology',
    sampleType: 'blood',
    pricePaise: 40_000,
    turnaroundHours: 24,
    parameters: [num('tsh', 'TSH', 'µIU/mL', [any(0.4, 4)])],
  },
  {
    code: 'URINE-RE',
    name: 'Urine Routine Examination',
    category: 'urine',
    sampleType: 'urine',
    pricePaise: 15_000,
    turnaroundHours: 4,
    preparation: 'Early-morning midstream sample in a sterile container',
    parameters: [
      option('colour', 'Colour', ['Pale yellow', 'Yellow', 'Dark yellow', 'Red', 'Other']),
      option('appearance', 'Appearance', ['Clear', 'Slightly turbid', 'Turbid']),
      num('ph', 'pH', '', [any(4.5, 8)]),
      num('specific_gravity', 'Specific gravity', '', [any(1.005, 1.03)]),
      option('protein', 'Protein', ['Nil', 'Trace', '+', '++', '+++']),
      option('glucose', 'Glucose', ['Nil', 'Trace', '+', '++', '+++']),
      text('pus_cells', 'Pus cells', '/hpf'),
      text('rbc', 'RBCs', '/hpf'),
    ],
  },
  {
    code: 'VITD',
    name: 'Vitamin D (25-OH)',
    category: 'immunology',
    sampleType: 'blood',
    pricePaise: 120_000,
    turnaroundHours: 24,
    parameters: [
      num('vitamin_d', '25-OH Vitamin D', 'ng/mL', [
        any(30, 100, {
          criticalLow: 10,
          text: '< 20 deficient; 20–29 insufficient; 30–100 sufficient',
        }),
      ]),
    ],
  },
  {
    code: 'B12',
    name: 'Vitamin B12',
    category: 'immunology',
    sampleType: 'blood',
    pricePaise: 90_000,
    turnaroundHours: 24,
    parameters: [num('vitamin_b12', 'Vitamin B12', 'pg/mL', [any(200, 900)])],
  },
  {
    code: 'CRP',
    name: 'C-Reactive Protein',
    category: 'immunology',
    sampleType: 'blood',
    pricePaise: 40_000,
    turnaroundHours: 6,
    parameters: [num('crp', 'CRP', 'mg/L', [any(0, 6)])],
  },
  {
    code: 'DENGUE-NS1',
    name: 'Dengue NS1 Antigen',
    category: 'immunology',
    sampleType: 'blood',
    pricePaise: 60_000,
    turnaroundHours: 6,
    parameters: [option('ns1', 'NS1 antigen', ['Negative', 'Positive'])],
  },
  {
    code: 'ELECTROLYTES',
    name: 'Serum Electrolytes',
    category: 'biochemistry',
    sampleType: 'blood',
    pricePaise: 50_000,
    turnaroundHours: 6,
    parameters: [
      num('sodium', 'Sodium', 'mmol/L', [any(135, 145, { criticalLow: 120, criticalHigh: 160 })]),
      num('potassium', 'Potassium', 'mmol/L', [
        any(3.5, 5.1, { criticalLow: 2.5, criticalHigh: 6.5 }),
      ]),
      num('chloride', 'Chloride', 'mmol/L', [any(98, 107)]),
    ],
  },
  {
    code: 'BLOOD-GROUP',
    name: 'Blood Group & Rh Typing',
    category: 'haematology',
    sampleType: 'blood',
    pricePaise: 15_000,
    turnaroundHours: 2,
    parameters: [
      option('abo', 'ABO group', ['A', 'B', 'AB', 'O']),
      option('rh', 'Rh factor', ['Positive', 'Negative']),
    ],
  },
  {
    code: 'ESR',
    name: 'Erythrocyte Sedimentation Rate',
    category: 'haematology',
    sampleType: 'blood',
    pricePaise: 15_000,
    turnaroundHours: 4,
    parameters: [num('esr', 'ESR', 'mm/hr', bySex([0, 15], [0, 20]))],
  },
];
