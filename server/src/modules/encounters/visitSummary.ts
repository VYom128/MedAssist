import { AUDIT_ACTIONS, ROLES } from '../../config/constants.js';
import { FREQUENCY_PHRASES, TIMING_PHRASES } from '../../data/abbreviations.js';
import { assertCanReadEncounter } from '../../policies/encounterAccess.js';
import * as audit from '../../services/audit.service.js';
import {
  clinicHeader,
  createPdf,
  detailsGrid,
  heading,
  paragraph,
  rule,
  table,
} from '../../services/pdf.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { ageOn, clinicToday, formatClinicDateTime } from '../../utils/dates.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { DoctorProfile } from '../doctors/model.js';
import { Patient } from '../patients/model.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { Prescription } from '../prescriptions/model.js';
import { getSettings } from '../settings/service.js';
import { patientViewExtras } from './patient.service.js';
import { toPatientSafeView } from './serializer.js';
import { loadEncounter, resourceOf } from './service.js';

/**
 * GET /encounters/:id/visit-summary.pdf (spec §12.3, Phase 10): a patient handout of a signed
 * (or amended) visit – made on demand, never stored. It is built from the patient-safe view
 * only (Phase 8: vitals, shared diagnoses, advice, follow-up – never history, examination,
 * assessment or plan), the visit's issued prescription and the approved AI summary only when the
 * doctor shared it with the patient. Readers: the patient (own) and doctors who may read the
 * note; drafts never (patients 404 by the policy, doctors 422). Audited as a download.
 */

const UNITS: [string, string][] = [
  ['bpSystolic', ''],
  ['pulse', ' /min'],
  ['temperatureC', ' °C'],
  ['respiratoryRate', ' /min'],
  ['spo2', ' %'],
  ['weightKg', ' kg'],
  ['heightCm', ' cm'],
  ['bmi', ''],
];
const VITAL_LABELS: Record<string, string> = {
  bpSystolic: 'Blood pressure',
  pulse: 'Pulse',
  temperatureC: 'Temperature',
  respiratoryRate: 'Respiratory rate',
  spo2: 'SpO2',
  weightKg: 'Weight',
  heightCm: 'Height',
  bmi: 'BMI',
};

interface RxItem {
  drugName: string;
  strength?: string | null;
  dose?: string | null;
  frequency?: keyof typeof FREQUENCY_PHRASES | null;
  frequencyText?: string | null;
  timing?: keyof typeof TIMING_PHRASES | null;
  durationDays?: number | null;
  instructions?: string | null;
}

export async function visitSummaryPdf(user: AuthUser, id: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user); // 403 while the link is pending
  const e = await loadEncounter(id);
  await assertCanReadEncounter(user, e, meta);
  if (e.status === 'draft') {
    throw ApiError.unprocessable('Sign the note before printing the visit summary');
  }
  const settings = await getSettings();
  const { timezone } = settings;
  const view = toPatientSafeView(e, await patientViewExtras(e));
  const [patient, profile, rx] = await Promise.all([
    Patient.findById(e.patient._id).select('mrn firstName lastName dateOfBirth gender').lean(),
    DoctorProfile.findOne({ user: e.doctor._id })
      .select('registrationNumber qualifications')
      .lean(),
    view.prescriptionId
      ? Prescription.findById(view.prescriptionId).select('prescriptionNumber items').lean()
      : null,
  ]);

  const pdf = createPdf({
    title: `Visit summary ${e.encounterNumber ?? ''}`.trim(),
    subject: 'Visit summary',
    unicode: true,
  });
  await clinicHeader(pdf, 'VISIT SUMMARY');
  const age = patient?.dateOfBirth
    ? `${ageOn(patient.dateOfBirth, clinicToday(timezone))} y`
    : null;
  detailsGrid(pdf, [
    ['Patient', patient ? `${patient.firstName} ${patient.lastName}` : null],
    ['MRN', patient?.mrn],
    ['Age / sex', [age, patient?.gender].filter(Boolean).join(' / ') || null],
    ['Visit', formatClinicDateTime(view.visitAt, timezone)],
    [
      'Doctor',
      `Dr ${view.doctor.name}${profile?.qualifications?.length ? `, ${profile.qualifications.join(', ')}` : ''}`,
    ],
    ['Registration no.', profile?.registrationNumber ?? null],
    ['Department', view.department?.name ?? null],
    ['Note', `${e.encounterNumber ?? ''}${view.amended ? ' (updated after the visit)' : ''}`],
  ]);
  rule(pdf);

  const vitals = UNITS.flatMap(([key, unit]) => {
    const v = (view.vitals as Record<string, number | null>)[key];
    if (v === null || v === undefined) return [];
    if (key === 'bpSystolic') {
      const dia = view.vitals.bpDiastolic;
      return [[VITAL_LABELS[key]!, `${v}${dia ? `/${dia}` : ''} mmHg`] as [string, string]];
    }
    return [[VITAL_LABELS[key]!, `${v}${unit}`] as [string, string]];
  });
  if (vitals.length) {
    heading(pdf, 'Vitals');
    detailsGrid(pdf, vitals);
  }
  if (view.diagnosisShared && view.diagnoses?.length) {
    heading(pdf, 'Diagnosis');
    for (const d of view.diagnoses as { description: string; type?: string | null }[]) {
      paragraph(pdf, `${d.description}${d.type ? ` (${d.type})` : ''}`);
    }
  }
  if (view.aiSummary) {
    heading(pdf, 'Visit summary (AI-assisted, reviewed by your doctor)');
    paragraph(pdf, view.aiSummary.text);
    paragraph(
      pdf,
      `Reviewed by ${view.aiSummary.reviewedBy ?? 'your doctor'}` +
        (view.aiSummary.reviewedAt
          ? ` on ${formatClinicDateTime(new Date(view.aiSummary.reviewedAt), timezone)}`
          : ''),
      { muted: true, italic: true },
    );
  }
  if (view.adviceToPatient) {
    heading(pdf, 'Advice');
    paragraph(pdf, view.adviceToPatient);
  }
  const items = (rx?.items ?? []) as RxItem[];
  if (items.length) {
    heading(pdf, `Prescription${rx?.prescriptionNumber ? ` ${rx.prescriptionNumber}` : ''}`);
    table(
      pdf,
      [
        { header: 'Medicine', width: 3 },
        { header: 'Dose', width: 1.5 },
        { header: 'When', width: 3 },
        { header: 'Days', width: 1, align: 'right' },
        { header: 'Instructions', width: 3 },
      ],
      items.map((i) => [
        {
          text: `${i.drugName}${i.strength && !i.drugName.includes(i.strength) ? ` ${i.strength}` : ''}`,
          bold: true,
        },
        i.dose ?? '',
        [
          i.frequency && i.frequency !== 'other'
            ? FREQUENCY_PHRASES[i.frequency].en
            : (i.frequencyText ?? ''),
          i.timing ? TIMING_PHRASES[i.timing].en : '',
        ]
          .filter(Boolean)
          .join(', '),
        i.durationDays ? String(i.durationDays) : '',
        i.instructions ?? '',
      ]),
    );
  }
  if (view.followUp.required) {
    heading(pdf, 'Follow-up');
    paragraph(
      pdf,
      [
        view.followUp.afterDays
          ? `Come back after ${view.followUp.afterDays} days`
          : 'Come back for a follow-up visit',
        view.followUp.date ? ` (around ${view.followUp.date})` : '',
        '.',
      ].join(''),
    );
    if (view.followUp.instructions) paragraph(pdf, view.followUp.instructions);
  }
  pdf.doc.moveDown(1);
  paragraph(pdf, 'This summary is for your records. Follow the advice your doctor gave you.', {
    muted: true,
    italic: true,
  });
  const buffer = await pdf.finish();

  await audit.record({
    action: AUDIT_ACTIONS.VISIT_SUMMARY_DOWNLOAD,
    actor: actorOf(user),
    resource: resourceOf(e),
    patient: e.patient._id,
    request: meta,
    metadata: {
      aiSummaryIncluded: Boolean(view.aiSummary),
      prescriptionIncluded: items.length > 0,
    },
  });
  return { buffer, fileName: `visit-summary-${e.encounterNumber ?? e._id.toString()}.pdf` };
}
