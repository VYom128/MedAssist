/**
 * Clinical note templates for the seed (spec §15.3): realistic outpatient notes for the seeded
 * appointment reasons. Each visit picks a template for its reason and varies the vitals inside
 * the ranges. Prescriptions use formulary drugs; `alternative` replaces a drug when the patient
 * is allergic to it (the seed never prescribes a drug the patient is allergic to, except one
 * acknowledged demo warning). Demo data only – not clinical guidance.
 */

export interface TemplateItem {
  drugName: string;
  genericName: string;
  strength: string;
  form: 'tablet' | 'capsule' | 'syrup' | 'drops' | 'cream' | 'ointment' | 'inhaler' | 'other';
  dose: string;
  route: 'oral' | 'topical' | 'inhalation' | 'ophthalmic' | 'otic' | 'nasal';
  frequency: 'OD' | 'BD' | 'TDS' | 'QID' | 'HS' | 'SOS' | 'STAT' | 'weekly';
  timing?: 'before_food' | 'after_food' | 'with_food' | 'empty_stomach' | 'any';
  durationDays: number;
  instructions?: string;
  /** Used instead when the patient is allergic to this drug (or its class). */
  alternative?: Omit<TemplateItem, 'alternative'>;
}

export interface EncounterTemplate {
  key: string;
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastHistory?: string;
  examination: string;
  /** [min, max] per vital; weight and height come from the patient's age band. */
  vitals: {
    temperatureC: [number, number];
    pulse: [number, number];
    bpSystolic: [number, number];
    bpDiastolic: [number, number];
    respiratoryRate: [number, number];
    spo2: [number, number];
  };
  diagnoses: { description: string; icd10Code: string; type: 'provisional' | 'final' }[];
  assessment: string;
  plan: string;
  adviceToPatient: string;
  generalInstructions?: string;
  items: TemplateItem[];
  followUp?: { afterDays: number; instructions: string };
}

const NORMAL = {
  temperatureC: [36.6, 37.2] as [number, number],
  pulse: [68, 88] as [number, number],
  bpSystolic: [112, 128] as [number, number],
  bpDiastolic: [72, 84] as [number, number],
  respiratoryRate: [14, 18] as [number, number],
  spo2: [97, 99] as [number, number],
};
const FEBRILE = {
  ...NORMAL,
  temperatureC: [37.9, 39.1] as [number, number],
  pulse: [90, 108] as [number, number],
};

const PARACETAMOL: TemplateItem = {
  drugName: 'Paracetamol',
  genericName: 'Paracetamol',
  strength: '650 mg',
  form: 'tablet',
  dose: '1 tablet',
  route: 'oral',
  frequency: 'TDS',
  timing: 'after_food',
  durationDays: 3,
  instructions: 'Only if temperature is above 100 °F; at least 6 hours apart',
};
const CETIRIZINE: TemplateItem = {
  drugName: 'Levocetirizine',
  genericName: 'Levocetirizine',
  strength: '5 mg',
  form: 'tablet',
  dose: '1 tablet',
  route: 'oral',
  frequency: 'HS',
  timing: 'any',
  durationDays: 5,
  instructions: 'May cause drowsiness',
};
const PANTOPRAZOLE: TemplateItem = {
  drugName: 'Pantoprazole',
  genericName: 'Pantoprazole',
  strength: '40 mg',
  form: 'tablet',
  dose: '1 tablet',
  route: 'oral',
  frequency: 'OD',
  timing: 'empty_stomach',
  durationDays: 5,
  instructions: '30 minutes before breakfast',
};
const ACECLOFENAC: TemplateItem = {
  drugName: 'Aceclofenac + Paracetamol',
  genericName: 'Aceclofenac + Paracetamol',
  strength: '100 mg + 325 mg',
  form: 'tablet',
  dose: '1 tablet',
  route: 'oral',
  frequency: 'BD',
  timing: 'after_food',
  durationDays: 5,
  alternative: { ...PARACETAMOL, frequency: 'TDS', durationDays: 5, instructions: 'For pain' },
};

export const ENCOUNTER_TEMPLATES: Record<string, EncounterTemplate> = {
  urti: {
    key: 'urti',
    chiefComplaint: 'Sore throat, runny nose and mild cough for 3 days',
    historyOfPresentIllness:
      'Started with throat irritation, followed by nasal discharge and dry cough. Low-grade fever on day 1. No breathlessness, no ear pain.',
    examination: 'Throat congested, tonsils not enlarged. Chest clear, no added sounds.',
    vitals: { ...NORMAL, temperatureC: [37.2, 37.9] },
    diagnoses: [
      { description: 'Acute upper respiratory tract infection', icd10Code: 'J06.9', type: 'final' },
    ],
    assessment: 'Viral URTI. No features of bacterial infection.',
    plan: 'Symptomatic treatment. No antibiotics needed.',
    adviceToPatient:
      'Warm salt-water gargles, steam inhalation twice a day, plenty of fluids and rest.',
    items: [PARACETAMOL, CETIRIZINE],
  },
  pharyngitis: {
    key: 'pharyngitis',
    chiefComplaint: 'Painful swallowing and fever for 4 days',
    historyOfPresentIllness:
      'Throat pain worse on swallowing, fever up to 101 °F, no cough. No rash.',
    examination: 'Tonsils enlarged with exudate, tender anterior cervical nodes. Chest clear.',
    vitals: FEBRILE,
    diagnoses: [
      { description: 'Acute tonsillopharyngitis', icd10Code: 'J03.90', type: 'provisional' },
    ],
    assessment: 'Likely bacterial tonsillopharyngitis (exudate, tender nodes, no cough).',
    plan: 'Oral antibiotic for 5 days, antipyretic.',
    adviceToPatient: 'Complete the full antibiotic course. Soft diet and warm fluids.',
    items: [
      {
        drugName: 'Amoxicillin',
        genericName: 'Amoxicillin',
        strength: '500 mg',
        form: 'capsule',
        dose: '1 capsule',
        route: 'oral',
        frequency: 'TDS',
        timing: 'after_food',
        durationDays: 5,
        alternative: {
          drugName: 'Azithromycin',
          genericName: 'Azithromycin',
          strength: '500 mg',
          form: 'tablet',
          dose: '1 tablet',
          route: 'oral',
          frequency: 'OD',
          timing: 'before_food',
          durationDays: 3,
        },
      },
      PARACETAMOL,
    ],
    followUp: { afterDays: 5, instructions: 'Review if fever persists beyond 3 days' },
  },
  viral_fever: {
    key: 'viral_fever',
    chiefComplaint: 'Fever with body ache for 3 days',
    historyOfPresentIllness:
      'Intermittent fever up to 102 °F with chills and body ache. No bleeding, no rash, passing urine normally.',
    examination:
      'Mildly dehydrated. No lymphadenopathy. Chest clear, abdomen soft, no organomegaly.',
    vitals: FEBRILE,
    diagnoses: [{ description: 'Acute viral fever', icd10Code: 'B34.9', type: 'provisional' }],
    assessment: 'Likely viral fever. Watch for warning signs of dengue.',
    plan: 'Antipyretic, oral fluids. CBC if fever continues after day 5.',
    adviceToPatient:
      'Drink 3 litres of fluids a day. Come back at once for bleeding, severe abdominal pain or persistent vomiting.',
    items: [
      PARACETAMOL,
      {
        ...PARACETAMOL,
        drugName: 'ORS',
        genericName: 'Oral rehydration salts',
        strength: '21 g sachet',
        form: 'other',
        dose: '1 sachet in 1 litre water',
        frequency: 'SOS',
        durationDays: 3,
        instructions: 'Sip through the day',
      },
    ],
    followUp: { afterDays: 3, instructions: 'Review with CBC if fever continues' },
  },
  child_fever: {
    key: 'child_fever',
    chiefComplaint: 'Fever for 2 days',
    historyOfPresentIllness:
      'Fever up to 101 °F, playful in between, feeding reduced. No convulsions.',
    examination: 'Active, well hydrated. Throat mildly congested. Ears normal. Chest clear.',
    vitals: {
      ...FEBRILE,
      pulse: [100, 120],
      bpSystolic: [95, 105],
      bpDiastolic: [60, 68],
      respiratoryRate: [20, 26],
    },
    diagnoses: [{ description: 'Acute febrile illness', icd10Code: 'R50.9', type: 'provisional' }],
    assessment: 'Likely viral. No focus of bacterial infection.',
    plan: 'Paracetamol syrup by weight, fluids.',
    adviceToPatient:
      'Sponge with tap water, keep giving fluids. Return if the child is drowsy or not drinking.',
    items: [
      {
        ...PARACETAMOL,
        strength: '250 mg/5 ml',
        form: 'syrup',
        dose: '5 ml',
        instructions: 'Only for fever; at least 6 hours apart',
      },
    ],
    followUp: { afterDays: 3, instructions: 'Review if fever continues' },
  },
  hypertension: {
    key: 'hypertension',
    chiefComplaint: 'Blood pressure review',
    historyOfPresentIllness:
      'Known hypertensive on amlodipine. Home readings 130–145/85–92. No headache, chest pain or breathlessness.',
    pastHistory: 'Hypertension for 4 years.',
    examination: 'No pedal oedema. Heart sounds normal. Chest clear.',
    vitals: { ...NORMAL, bpSystolic: [134, 152], bpDiastolic: [86, 96] },
    diagnoses: [{ description: 'Essential hypertension', icd10Code: 'I10', type: 'final' }],
    assessment: 'BP not at target on current dose.',
    plan: 'Add telmisartan. Lipid profile and kidney function at next visit.',
    adviceToPatient: 'Less salt, 30 minutes of walking a day, keep a home BP diary.',
    items: [
      {
        drugName: 'Amlodipine',
        genericName: 'Amlodipine',
        strength: '5 mg',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'OD',
        timing: 'any',
        durationDays: 30,
      },
      {
        drugName: 'Telmisartan',
        genericName: 'Telmisartan',
        strength: '40 mg',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'OD',
        timing: 'any',
        durationDays: 30,
      },
    ],
    followUp: { afterDays: 30, instructions: 'Bring the BP diary' },
  },
  diabetes: {
    key: 'diabetes',
    chiefComplaint: 'Diabetes review',
    historyOfPresentIllness:
      'Type 2 diabetes on metformin. Fasting sugars 130–160 at home. No hypoglycaemia. Occasional tingling in feet.',
    pastHistory: 'Type 2 diabetes for 6 years.',
    examination: 'Foot examination: pulses felt, monofilament sensation intact.',
    vitals: { ...NORMAL, bpSystolic: [124, 138], bpDiastolic: [78, 88] },
    diagnoses: [
      {
        description: 'Type 2 diabetes mellitus without complications',
        icd10Code: 'E11.9',
        type: 'final',
      },
    ],
    assessment: 'Suboptimal control.',
    plan: 'Increase metformin, add glimepiride. HbA1c in 3 months.',
    adviceToPatient: 'Avoid sweets and sugary drinks, walk after meals, check feet daily.',
    items: [
      {
        drugName: 'Metformin',
        genericName: 'Metformin',
        strength: '1000 mg',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'BD',
        timing: 'after_food',
        durationDays: 30,
      },
      {
        drugName: 'Glimepiride',
        genericName: 'Glimepiride',
        strength: '1 mg',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'OD',
        timing: 'before_food',
        durationDays: 30,
        instructions: 'Before breakfast',
      },
    ],
    followUp: { afterDays: 30, instructions: 'Bring the sugar chart' },
  },
  gastritis: {
    key: 'gastritis',
    chiefComplaint: 'Burning pain in upper abdomen for a week',
    historyOfPresentIllness:
      'Epigastric burning, worse after spicy food and at night. Bloating. No vomiting of blood, no black stools.',
    examination: 'Mild epigastric tenderness. No guarding, no organomegaly.',
    vitals: NORMAL,
    diagnoses: [{ description: 'Acute gastritis', icd10Code: 'K29.1', type: 'provisional' }],
    assessment: 'Dyspepsia, likely gastritis. No alarm features.',
    plan: 'PPI for 2 weeks, antacid as needed.',
    adviceToPatient:
      'Small frequent meals, avoid spicy and oily food, no late-night meals, avoid painkillers.',
    items: [
      { ...PANTOPRAZOLE, durationDays: 14 },
      {
        drugName: 'Antacid gel',
        genericName: 'Aluminium hydroxide + Magnesium hydroxide',
        strength: '10 ml',
        form: 'syrup',
        dose: '10 ml',
        route: 'oral',
        frequency: 'SOS',
        timing: 'after_food',
        durationDays: 7,
      },
    ],
  },
  gastroenteritis: {
    key: 'gastroenteritis',
    chiefComplaint: 'Loose motions for 2 days',
    historyOfPresentIllness:
      '5–6 watery stools a day, mild abdominal cramps. No blood in stools. Taking fluids.',
    examination: 'Mild dehydration. Abdomen soft, bowel sounds increased.',
    vitals: { ...NORMAL, pulse: [92, 106] },
    diagnoses: [{ description: 'Acute gastroenteritis', icd10Code: 'A09', type: 'provisional' }],
    assessment: 'Acute watery diarrhoea with mild dehydration.',
    plan: 'ORS, zinc, probiotic.',
    adviceToPatient:
      'ORS after every loose stool. Continue normal diet. Return if blood in stool or not passing urine.',
    items: [
      {
        drugName: 'ORS',
        genericName: 'Oral rehydration salts',
        strength: '21 g sachet',
        form: 'other',
        dose: '1 sachet in 1 litre water',
        route: 'oral',
        frequency: 'SOS',
        durationDays: 3,
      },
      {
        drugName: 'Zinc',
        genericName: 'Zinc sulphate',
        strength: '20 mg',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'OD',
        timing: 'after_food',
        durationDays: 14,
      },
      {
        drugName: 'Probiotic',
        genericName: 'Lactobacillus / Bacillus clausii',
        strength: '2 billion spores',
        form: 'capsule',
        dose: '1 capsule',
        route: 'oral',
        frequency: 'BD',
        durationDays: 5,
      },
    ],
  },
  uti: {
    key: 'uti',
    chiefComplaint: 'Burning while passing urine for 3 days',
    historyOfPresentIllness:
      'Frequency and burning micturition, lower abdominal discomfort. No fever, no flank pain.',
    examination: 'Suprapubic tenderness. No renal angle tenderness.',
    vitals: NORMAL,
    diagnoses: [{ description: 'Acute cystitis', icd10Code: 'N30.0', type: 'provisional' }],
    assessment: 'Uncomplicated lower urinary tract infection.',
    plan: 'Urine routine and culture. Nitrofurantoin for 5 days.',
    adviceToPatient: 'Drink plenty of water. Do not hold urine.',
    items: [
      {
        drugName: 'Nitrofurantoin',
        genericName: 'Nitrofurantoin',
        strength: '100 mg',
        form: 'capsule',
        dose: '1 capsule',
        route: 'oral',
        frequency: 'BD',
        timing: 'after_food',
        durationDays: 5,
      },
      {
        drugName: 'Potassium citrate',
        genericName: 'Potassium citrate + Magnesium citrate',
        strength: '1.1 g/5 ml',
        form: 'syrup',
        dose: '10 ml in water',
        route: 'oral',
        frequency: 'TDS',
        timing: 'after_food',
        durationDays: 5,
      },
    ],
    followUp: { afterDays: 7, instructions: 'With the urine culture report' },
  },
  headache: {
    key: 'headache',
    chiefComplaint: 'Headache since yesterday',
    historyOfPresentIllness:
      'Band-like headache over both temples after a stressful week, no vomiting, no visual symptoms, no weakness.',
    examination: 'Neurological examination normal. Fundi normal. Neck supple.',
    vitals: NORMAL,
    diagnoses: [{ description: 'Tension-type headache', icd10Code: 'G44.2', type: 'provisional' }],
    assessment: 'Tension-type headache. No red flags.',
    plan: 'Simple analgesia, sleep hygiene.',
    adviceToPatient:
      'Regular sleep, breaks from screens, stay hydrated. Return for sudden severe headache or vomiting.',
    items: [
      { ...PARACETAMOL, frequency: 'SOS', instructions: 'For headache; at most 3 tablets a day' },
    ],
  },
  dermatitis: {
    key: 'dermatitis',
    chiefComplaint: 'Itchy rash on forearms for 10 days',
    historyOfPresentIllness:
      'Itchy red patches after starting a new detergent. No fever. Worse at night.',
    examination: 'Erythematous scaly plaques on both forearms, no pustules.',
    vitals: NORMAL,
    diagnoses: [
      { description: 'Allergic contact dermatitis', icd10Code: 'L23.9', type: 'provisional' },
    ],
    assessment: 'Contact dermatitis, likely detergent.',
    plan: 'Topical steroid, oral antihistamine, avoid the trigger.',
    adviceToPatient: 'Stop the new detergent, use gloves, moisturise twice a day.',
    items: [
      {
        drugName: 'Mometasone cream',
        genericName: 'Mometasone',
        strength: '0.1%',
        form: 'cream',
        dose: 'Apply thinly',
        route: 'topical',
        frequency: 'OD',
        durationDays: 10,
        instructions: 'Only on the rash, at night',
      },
      { ...CETIRIZINE, durationDays: 10 },
    ],
    followUp: { afterDays: 14, instructions: 'Review the skin' },
  },
  acne: {
    key: 'acne',
    chiefComplaint: 'Pimples on face for 6 months',
    historyOfPresentIllness:
      'Papules and blackheads on cheeks and forehead, worse before periods. Oily skin.',
    examination: 'Open and closed comedones, few inflammatory papules. No nodules or scars.',
    vitals: NORMAL,
    diagnoses: [
      { description: 'Acne vulgaris, mild to moderate', icd10Code: 'L70.0', type: 'final' },
    ],
    assessment: 'Mild to moderate acne.',
    plan: 'Topical retinoid at night and benzoyl peroxide in the morning.',
    adviceToPatient: 'Gentle face wash twice a day, do not squeeze pimples, oil-free sunscreen.',
    items: [
      {
        drugName: 'Adapalene gel',
        genericName: 'Adapalene',
        strength: '0.1%',
        form: 'cream',
        dose: 'Pea-sized amount',
        route: 'topical',
        frequency: 'HS',
        durationDays: 60,
      },
      {
        drugName: 'Benzoyl peroxide gel',
        genericName: 'Benzoyl peroxide',
        strength: '2.5%',
        form: 'cream',
        dose: 'Apply thinly',
        route: 'topical',
        frequency: 'OD',
        durationDays: 60,
        instructions: 'In the morning',
      },
    ],
    followUp: { afterDays: 42, instructions: 'Review response' },
  },
  back_pain: {
    key: 'back_pain',
    chiefComplaint: 'Lower back pain for 1 week',
    historyOfPresentIllness:
      'Started after lifting a heavy box. Worse on bending. No leg weakness, no bladder symptoms.',
    examination: 'Paraspinal tenderness L4–L5. SLR negative. Power normal in both legs.',
    vitals: NORMAL,
    diagnoses: [
      { description: 'Acute mechanical low back pain', icd10Code: 'M54.5', type: 'final' },
    ],
    assessment: 'Mechanical back strain. No red flags.',
    plan: 'Analgesic, muscle relaxant, physiotherapy exercises.',
    adviceToPatient: 'Stay active, avoid lifting heavy weights, hot fomentation twice a day.',
    items: [
      ACECLOFENAC,
      {
        drugName: 'Thiocolchicoside',
        genericName: 'Thiocolchicoside',
        strength: '4 mg',
        form: 'capsule',
        dose: '1 capsule',
        route: 'oral',
        frequency: 'BD',
        timing: 'after_food',
        durationDays: 5,
      },
      { ...PANTOPRAZOLE },
    ],
    followUp: { afterDays: 14, instructions: 'Review if pain persists' },
  },
  knee_pain: {
    key: 'knee_pain',
    chiefComplaint: 'Pain in both knees on climbing stairs',
    historyOfPresentIllness:
      'Gradual onset over 6 months, morning stiffness less than 15 minutes. No swelling.',
    examination: 'Crepitus in both knees, mild medial joint line tenderness. No effusion.',
    vitals: { ...NORMAL, bpSystolic: [120, 136] },
    diagnoses: [
      {
        description: 'Primary osteoarthritis of both knees',
        icd10Code: 'M17.0',
        type: 'provisional',
      },
    ],
    assessment: 'Early knee osteoarthritis.',
    plan: 'X-ray both knees standing. Analgesic gel, quadriceps exercises, calcium and vitamin D.',
    adviceToPatient:
      'Quadriceps exercises daily, reduce weight, avoid squatting and cross-legged sitting.',
    items: [
      {
        drugName: 'Diclofenac gel',
        genericName: 'Diclofenac',
        strength: '1% gel',
        form: 'cream',
        dose: 'Apply',
        route: 'topical',
        frequency: 'TDS',
        durationDays: 14,
        instructions: 'Massage gently over the knees',
        alternative: {
          drugName: 'Calamine lotion',
          genericName: 'Calamine',
          strength: '8%',
          form: 'other',
          dose: 'Apply',
          route: 'topical',
          frequency: 'TDS',
          durationDays: 14,
        },
      },
      {
        drugName: 'Calcium + Vitamin D3',
        genericName: 'Calcium carbonate + Cholecalciferol',
        strength: '500 mg + 250 IU',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'OD',
        timing: 'after_food',
        durationDays: 60,
      },
    ],
    followUp: { afterDays: 21, instructions: 'With the knee X-ray' },
  },
  sprain: {
    key: 'sprain',
    chiefComplaint: 'Twisted ankle yesterday',
    historyOfPresentIllness:
      'Inversion injury while walking down steps. Able to walk with pain. Swelling on the outer side.',
    examination:
      'Swelling and tenderness over the anterior talofibular ligament. No bony tenderness (Ottawa negative).',
    vitals: NORMAL,
    diagnoses: [{ description: 'Sprain of ankle', icd10Code: 'S93.4', type: 'final' }],
    assessment: 'Grade I lateral ankle sprain. X-ray not needed.',
    plan: 'RICE, crepe bandage, analgesic.',
    adviceToPatient:
      'Rest, ice packs 15 minutes every 3 hours, keep the foot raised, crepe bandage in the day.',
    items: [ACECLOFENAC],
    followUp: { afterDays: 10, instructions: 'Review if still unable to bear weight' },
  },
  allergic_rhinitis: {
    key: 'allergic_rhinitis',
    chiefComplaint: 'Sneezing and blocked nose every morning',
    historyOfPresentIllness:
      'Morning sneezing bouts, watery nasal discharge and itchy eyes for 2 months. Worse with dust.',
    examination: 'Pale, boggy nasal mucosa. Throat normal. Chest clear.',
    vitals: NORMAL,
    diagnoses: [{ description: 'Allergic rhinitis', icd10Code: 'J30.9', type: 'final' }],
    assessment: 'Perennial allergic rhinitis, likely dust mite.',
    plan: 'Nasal steroid spray and antihistamine.',
    adviceToPatient:
      'Wash bedding weekly in hot water, avoid dusting yourself, use a mask outdoors.',
    items: [
      {
        drugName: 'Fluticasone nasal spray',
        genericName: 'Fluticasone',
        strength: '50 mcg/spray',
        form: 'other',
        dose: '2 sprays each nostril',
        route: 'nasal',
        frequency: 'OD',
        durationDays: 30,
      },
      {
        drugName: 'Montelukast + Levocetirizine',
        genericName: 'Montelukast + Levocetirizine',
        strength: '10 mg + 5 mg',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'HS',
        durationDays: 14,
      },
    ],
    followUp: { afterDays: 30, instructions: 'Review symptoms' },
  },
  asthma: {
    key: 'asthma',
    chiefComplaint: 'Asthma review, night cough twice a week',
    historyOfPresentIllness:
      'Known asthmatic. Using reliever 3 times a week, night symptoms twice a week.',
    pastHistory: 'Asthma since childhood.',
    examination: 'Occasional expiratory wheeze. No accessory muscle use.',
    vitals: { ...NORMAL, spo2: [95, 98], respiratoryRate: [16, 20] },
    diagnoses: [{ description: 'Asthma, partly controlled', icd10Code: 'J45.9', type: 'final' }],
    assessment: 'Partly controlled asthma.',
    plan: 'Start preventer inhaler, reliever as needed. Inhaler technique checked.',
    adviceToPatient: 'Rinse mouth after the preventer inhaler. Avoid smoke and dust.',
    items: [
      {
        drugName: 'Budesonide + Formoterol inhaler',
        genericName: 'Budesonide + Formoterol',
        strength: '200 mcg + 6 mcg/puff',
        form: 'inhaler',
        dose: '2 puffs',
        route: 'inhalation',
        frequency: 'BD',
        durationDays: 30,
        instructions: 'Rinse mouth afterwards',
      },
      {
        drugName: 'Salbutamol inhaler',
        genericName: 'Salbutamol',
        strength: '100 mcg/puff',
        form: 'inhaler',
        dose: '2 puffs',
        route: 'inhalation',
        frequency: 'SOS',
        durationDays: 30,
        instructions: 'For breathlessness or wheeze',
      },
    ],
    followUp: { afterDays: 30, instructions: 'Review control and inhaler technique' },
  },
  conjunctivitis: {
    key: 'conjunctivitis',
    chiefComplaint: 'Red, sticky eyes for 2 days',
    historyOfPresentIllness:
      'Redness and discharge in both eyes, started with a cold. Vision normal. No pain.',
    examination: 'Bilateral conjunctival congestion with mucopurulent discharge. Cornea clear.',
    vitals: NORMAL,
    diagnoses: [{ description: 'Acute conjunctivitis', icd10Code: 'H10.3', type: 'provisional' }],
    assessment: 'Acute bacterial conjunctivitis.',
    plan: 'Antibiotic eye drops, lubricant.',
    adviceToPatient: 'Wash hands often, do not share towels, avoid rubbing the eyes.',
    items: [
      {
        drugName: 'Moxifloxacin eye drops',
        genericName: 'Moxifloxacin',
        strength: '0.5%',
        form: 'drops',
        dose: '1 drop in each eye',
        route: 'ophthalmic',
        frequency: 'QID',
        durationDays: 5,
      },
      {
        drugName: 'Carboxymethylcellulose eye drops',
        genericName: 'Carboxymethylcellulose',
        strength: '0.5%',
        form: 'drops',
        dose: '1 drop in each eye',
        route: 'ophthalmic',
        frequency: 'QID',
        durationDays: 7,
      },
    ],
  },
  otitis_media: {
    key: 'otitis_media',
    chiefComplaint: 'Ear pain for 2 days',
    historyOfPresentIllness: 'Right ear pain after a cold, disturbed sleep. No discharge.',
    examination: 'Right tympanic membrane red and bulging. Left normal.',
    vitals: { ...FEBRILE, temperatureC: [37.6, 38.4] },
    diagnoses: [
      { description: 'Acute otitis media, right ear', icd10Code: 'H66.9', type: 'provisional' },
    ],
    assessment: 'Acute otitis media.',
    plan: 'Antibiotic for 5 days, analgesic, nasal decongestant.',
    adviceToPatient: 'Keep the ear dry. Return if discharge or high fever.',
    items: [
      {
        drugName: 'Co-amoxiclav',
        genericName: 'Amoxicillin + Clavulanic acid',
        strength: '625 mg',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'BD',
        timing: 'after_food',
        durationDays: 5,
        alternative: {
          drugName: 'Azithromycin',
          genericName: 'Azithromycin',
          strength: '500 mg',
          form: 'tablet',
          dose: '1 tablet',
          route: 'oral',
          frequency: 'OD',
          timing: 'before_food',
          durationDays: 3,
        },
      },
      PARACETAMOL,
      {
        drugName: 'Xylometazoline nasal drops',
        genericName: 'Xylometazoline',
        strength: '0.1%',
        form: 'drops',
        dose: '2 drops each nostril',
        route: 'nasal',
        frequency: 'TDS',
        durationDays: 5,
      },
    ],
    followUp: { afterDays: 7, instructions: 'Ear check' },
  },
  vitamin_d: {
    key: 'vitamin_d',
    chiefComplaint: 'Tiredness and body aches for 2 months',
    historyOfPresentIllness:
      'Generalised fatigue and aches, mostly indoors all day. Report shows vitamin D 14 ng/ml.',
    examination: 'No pallor. Mild tenderness over shins. Rest normal.',
    vitals: NORMAL,
    diagnoses: [{ description: 'Vitamin D deficiency', icd10Code: 'E55.9', type: 'final' }],
    assessment: 'Vitamin D deficiency.',
    plan: 'Weekly vitamin D3 for 8 weeks, then monthly. Calcium.',
    adviceToPatient: '15–20 minutes of morning sun on arms and face. Dairy in the diet.',
    items: [
      {
        drugName: 'Vitamin D3',
        genericName: 'Cholecalciferol',
        strength: '60000 IU',
        form: 'capsule',
        dose: '1 capsule',
        route: 'oral',
        frequency: 'weekly',
        timing: 'after_food',
        durationDays: 56,
        instructions: 'Once a week with milk',
      },
      {
        drugName: 'Calcium + Vitamin D3',
        genericName: 'Calcium carbonate + Cholecalciferol',
        strength: '500 mg + 250 IU',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'OD',
        timing: 'after_food',
        durationDays: 60,
      },
    ],
    followUp: { afterDays: 60, instructions: 'Repeat vitamin D level' },
  },
  hypothyroidism: {
    key: 'hypothyroidism',
    chiefComplaint: 'Thyroid review',
    historyOfPresentIllness:
      'On levothyroxine 50 mcg. Weight gain and tiredness persist. Recent TSH 7.8.',
    pastHistory: 'Hypothyroidism for 3 years.',
    examination: 'No goitre. Skin dry. Reflexes normal.',
    vitals: { ...NORMAL, pulse: [60, 72] },
    diagnoses: [{ description: 'Hypothyroidism', icd10Code: 'E03.9', type: 'final' }],
    assessment: 'Under-replaced hypothyroidism.',
    plan: 'Increase levothyroxine to 75 mcg. TSH after 6 weeks.',
    adviceToPatient: 'Take the tablet on an empty stomach, 30 minutes before tea or breakfast.',
    items: [
      {
        drugName: 'Levothyroxine',
        genericName: 'Levothyroxine',
        strength: '75 mcg',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'OD',
        timing: 'empty_stomach',
        durationDays: 42,
      },
    ],
    followUp: { afterDays: 42, instructions: 'With the TSH report' },
  },
  anxiety: {
    key: 'anxiety',
    chiefComplaint: 'Follow-up for anxiety',
    historyOfPresentIllness:
      'On escitalopram for 6 weeks. Sleep better, fewer palpitations. Still worries about work.',
    pastHistory: 'Generalised anxiety disorder diagnosed 2 months ago.',
    examination: 'Calm, well groomed, good eye contact. No suicidal thoughts.',
    vitals: NORMAL,
    diagnoses: [{ description: 'Generalised anxiety disorder', icd10Code: 'F41.1', type: 'final' }],
    assessment: 'Improving on treatment.',
    plan: 'Continue escitalopram. Counselling referral.',
    adviceToPatient:
      'Regular exercise, breathing exercises, limit caffeine. Do not stop the medicine suddenly.',
    items: [
      {
        drugName: 'Escitalopram',
        genericName: 'Escitalopram',
        strength: '10 mg',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'OD',
        timing: 'after_food',
        durationDays: 30,
      },
    ],
    followUp: { afterDays: 30, instructions: 'Review mood and sleep' },
  },
  well_child: {
    key: 'well_child',
    chiefComplaint: 'Growth and vaccination review',
    historyOfPresentIllness:
      'Parents want to check growth and the vaccination schedule. Child active and feeding well.',
    examination:
      'Weight and height on the 50th centile. Development appropriate for age. Systemic examination normal.',
    vitals: {
      ...NORMAL,
      pulse: [90, 110],
      bpSystolic: [92, 104],
      bpDiastolic: [58, 66],
      respiratoryRate: [20, 24],
    },
    diagnoses: [
      { description: 'Routine child health examination', icd10Code: 'Z00.1', type: 'final' },
    ],
    assessment: 'Healthy child, growth normal.',
    plan: 'Vaccinations as per schedule. Vitamin D supplement.',
    adviceToPatient: 'Balanced diet with fruit and vegetables, one hour of outdoor play every day.',
    items: [],
  },
};

/** Templates per seeded appointment reason (see data/appointments.ts REASONS). */
export const TEMPLATES_BY_REASON: Record<string, string[]> = {
  'Fever for 3 days': ['viral_fever', 'pharyngitis'],
  'BP review': ['hypertension'],
  'Cough and cold': ['urti', 'allergic_rhinitis', 'asthma', 'conjunctivitis'],
  'Diabetes check-up': ['diabetes'],
  'Headache since yesterday': ['headache'],
  'Stomach ache': ['gastritis', 'uti'],
  'Feeling tired all the time': ['vitamin_d', 'hypothyroidism', 'anxiety'],
  'Routine health check-up': ['hypertension', 'vitamin_d'],
  'Sore throat': ['pharyngitis', 'urti'],
  'Body ache and chills': ['viral_fever'],
  'Child has fever': ['child_fever'],
  'Vaccination query': ['well_child'],
  'Cough for a week': ['urti', 'asthma'],
  'Not eating well': ['well_child'],
  'Ear pain in child': ['otitis_media'],
  'Loose motions': ['gastroenteritis'],
  'Growth check-up': ['well_child'],
  'Rash on arms': ['dermatitis'],
  'Skin rash': ['dermatitis'],
  Acne: ['acne'],
  'Hair fall': ['vitamin_d'],
  'Itching on legs': ['dermatitis'],
  'Dark patches on face': ['acne'],
  'Nail infection': ['dermatitis'],
  'Knee pain': ['knee_pain'],
  'Lower back pain': ['back_pain'],
  'Shoulder stiffness': ['back_pain'],
  'Ankle sprain': ['sprain'],
  'Neck pain': ['back_pain'],
  'Wrist pain after fall': ['sprain'],
  'Ear pain': ['otitis_media'],
  'Blocked nose': ['allergic_rhinitis'],
  'Sore throat for a week': ['pharyngitis', 'urti'],
  'Ringing in ears': ['allergic_rhinitis'],
  'Sinus trouble': ['allergic_rhinitis'],
  'Hoarse voice': ['urti'],
};

/** Follow-up visits (reason "Follow-up visit", …) review a chronic condition of the department. */
export const FOLLOW_UP_TEMPLATES: Record<string, string[]> = {
  GEN: ['hypertension', 'diabetes', 'hypothyroidism', 'anxiety'],
  PED: ['asthma', 'well_child'],
  DER: ['acne', 'dermatitis'],
  ORT: ['knee_pain', 'back_pain'],
  ENT: ['allergic_rhinitis'],
};

/** Reasons for the seeded amendments. */
export const AMENDMENT_REASONS = [
  'Blood pressure reading was entered in the wrong field',
  'Added the examination finding noted after the patient left',
  'Corrected the follow-up interval after discussing with the patient',
];

/** A partly written note for the consultations under way today. */
export const TODAY_DRAFT = {
  chiefComplaint: 'Cough and mild fever for 2 days',
  vitals: { temperatureC: 37.8, pulse: 92, bpSystolic: 124, bpDiastolic: 80, spo2: 98 },
};
