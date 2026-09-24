import { skipToken } from '@reduxjs/toolkit/query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Switch from '../../../components/ui/Switch';
import {
  DRUG_ROUTE_LABELS,
  DRUG_TIMING_LABELS,
  GENDER_LABELS,
  type DrugRoute,
} from '../../../constants/catalog';
import { ROLES } from '../../../constants/roles';
import PrintLayout from '../../../layouts/PrintLayout';
import { formatDate } from '../../../utils/dates';
import { formatPhone } from '../../../utils/phone';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetEncounterQuery } from '../../encounters/api';
import { formatDiagnosis, formatFollowUp } from '../../encounters/fields';
import { useGetPrintSheetQuery } from '../api';

/**
 * /print/prescriptions/:id (spec §12.3) – the printable prescription for the doctor, reception
 * (completed visits) and the patient (own): clinic header, doctor with qualifications and
 * registration number, patient, date, Rx table (frequency and timing in words), instructions,
 * follow-up, signature line and number. The diagnosis line is OFF by default and only the
 * doctor can turn it on (spec §20 open decision 3).
 */
export default function PrintPrescriptionPage() {
  const { id = '' } = useParams();
  const user = useAppSelector(selectCurrentUser);
  const isDoctor = user?.role === ROLES.DOCTOR;
  const [withDiagnosis, setWithDiagnosis] = useState(false);
  const { data, isLoading, isError, error, refetch } = useGetPrintSheetQuery(id);
  const note = useGetEncounterQuery(
    isDoctor && withDiagnosis && data ? data.encounterId : skipToken,
  );

  const a = data?.clinic.address;
  const address = a
    ? [a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(', ')
    : '';
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

  return (
    <PrintLayout
      title="Prescription"
      controls={
        isDoctor && data ? (
          <Switch label="Show diagnosis" checked={withDiagnosis} onChange={setWithDiagnosis} />
        ) : undefined
      }
    >
      {isLoading && <ListSkeleton label="Loading prescription…" rows={4} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <div className="space-y-5">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-3">
            <div>
              <p className="text-xl font-bold">{data.clinic.name}</p>
              {address && <p>{address}</p>}
              <p>
                {[data.clinic.phone && formatPhone(data.clinic.phone), data.clinic.email]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="text-xs">
                {[
                  data.clinic.registrationNumber && `Reg. no. ${data.clinic.registrationNumber}`,
                  data.clinic.gstin && `GSTIN ${data.clinic.gstin}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold">Dr {data.doctor.name}</p>
              {data.doctor.qualifications.length > 0 && (
                <p>{data.doctor.qualifications.join(', ')}</p>
              )}
              {data.doctor.specialization && <p>{data.doctor.specialization}</p>}
              {data.doctor.registrationNumber && (
                <p className="text-xs">Reg. no. {data.doctor.registrationNumber}</p>
              )}
            </div>
          </header>

          <section aria-label="Patient" className="grid gap-1 sm:grid-cols-2">
            <p>
              <span className="font-semibold">Patient: </span>
              {data.patient?.fullName}
            </p>
            <p className="sm:text-right">
              <span className="font-semibold">Date: </span>
              {data.issuedAt ? formatDate(data.issuedAt) : ''}
            </p>
            <p>
              <span className="font-semibold">Age / sex: </span>
              {data.patient ? `${data.patient.age} y · ${GENDER_LABELS[data.patient.gender]}` : ''}
            </p>
            <p className="sm:text-right">
              <span className="font-semibold">MRN: </span>
              {data.patient?.mrn}
            </p>
          </section>

          {isDoctor && withDiagnosis && note.data && note.data.diagnoses.length > 0 && (
            <p>
              <span className="font-semibold">Diagnosis: </span>
              {note.data.diagnoses.map((d) => formatDiagnosis(d)).join('; ')}
            </p>
          )}

          <section aria-label="Prescribed drugs">
            <p className="text-2xl font-bold" aria-hidden="true">
              ℞
            </p>
            <table className="mt-2 w-full border-collapse text-left">
              <caption className="sr-only">Prescribed drugs</caption>
              <thead>
                <tr className="border-b border-ink">
                  <th scope="col" className="py-1 pr-2">
                    #
                  </th>
                  <th scope="col" className="py-1 pr-2">
                    Drug
                  </th>
                  <th scope="col" className="py-1 pr-2">
                    Dose
                  </th>
                  <th scope="col" className="py-1 pr-2">
                    How often
                  </th>
                  <th scope="col" className="py-1 pr-2">
                    When
                  </th>
                  <th scope="col" className="py-1">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, i) => (
                  <tr key={i} className="border-b border-line align-top">
                    <td className="py-1.5 pr-2">{i + 1}</td>
                    <td className="py-1.5 pr-2">
                      <span className="font-semibold">
                        {item.drugName}
                        {item.strength ? ` ${item.strength}` : ''}
                      </span>
                      {item.genericName && item.genericName !== item.drugName && (
                        <span className="block text-xs">{item.genericName}</span>
                      )}
                      {item.instructions && (
                        <span className="block text-xs">{item.instructions}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {item.dose}
                      {item.route
                        ? ` (${DRUG_ROUTE_LABELS[item.route as DrugRoute] ?? item.route})`
                        : ''}
                    </td>
                    <td className="py-1.5 pr-2">{item.frequencyLabel}</td>
                    <td className="py-1.5 pr-2">
                      {item.timing ? DRUG_TIMING_LABELS[item.timing] : ''}
                    </td>
                    <td className="py-1.5">
                      {item.durationDays ? days(item.durationDays) : ''}
                      {item.quantity ? ` · ${item.quantity}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {data.generalInstructions && (
            <p>
              <span className="font-semibold">Instructions: </span>
              {data.generalInstructions}
            </p>
          )}
          {data.followUp.required && <p>{formatFollowUp(data.followUp)}</p>}

          <footer className="flex items-end justify-between gap-4 pt-12">
            <p className="text-xs">
              {data.prescriptionNumber}
              {data.status === 'completed' ? ' · completed' : ''}
            </p>
            <p className="border-t border-ink pt-1 text-center">
              Dr {data.doctor.name}
              <span className="block text-xs">Signature</span>
            </p>
          </footer>
        </div>
      )}
    </PrintLayout>
  );
}
