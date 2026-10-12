import type { ExplanationLanguage } from '../../constants/catalog';

/**
 * Headings of the explanation panel in the explanation's own language, so a Hindi explanation
 * reads as Hindi throughout. The controls around it stay in the app's language.
 */
export const EXPLANATION_HEADINGS: Record<
  ExplanationLanguage,
  {
    medicines: string;
    whatToDo: string;
    whenToTake: string;
    howLong: string;
    tips: string;
    followUp: string;
    contact: string;
    questions: string;
  }
> = {
  en: {
    medicines: 'Your medicines',
    whatToDo: 'What to do',
    whenToTake: 'When',
    howLong: 'How long',
    tips: 'Tips',
    followUp: 'Follow-up',
    contact: 'When to contact the clinic',
    questions: 'Questions to ask your doctor',
  },
  hi: {
    medicines: 'आपकी दवाइयाँ',
    whatToDo: 'क्या करें',
    whenToTake: 'कब लें',
    howLong: 'कितने दिन',
    tips: 'सुझाव',
    followUp: 'दोबारा दिखाना',
    contact: 'क्लिनिक से कब संपर्क करें',
    questions: 'डॉक्टर से पूछने के सवाल',
  },
};

/** Language names in their own script (the switch). */
export const LANGUAGE_NATIVE: Record<ExplanationLanguage, string> = {
  en: 'English',
  hi: 'हिन्दी',
};
