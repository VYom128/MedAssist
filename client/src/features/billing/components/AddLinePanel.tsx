import { Plus } from 'lucide-react';
import { useState } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import MoneyInput from '../../../components/ui/MoneyInput';
import Select from '../../../components/ui/Select';
import Tabs from '../../../components/ui/Tabs';
import { BILLING_RULES } from '../../../constants/catalog';
import { formatINR } from '../../../utils/money';
import { useListLabTestsQuery } from '../../labTests/api';
import { useListServicesQuery } from '../../services/api';
import { newRow, type EditRow } from '../useInvoiceDraft';

type Source = 'service' | 'lab' | 'other';

/**
 * Adds a line: a consultation or procedure service (name, price, tax from the catalogue), a lab
 * test from the catalogue (clinic tax rate), or a custom "Other" line.
 */
export default function AddLinePanel({
  defaultTaxRateBps,
  onAdd,
}: {
  defaultTaxRateBps: number;
  onAdd: (row: EditRow) => void;
}) {
  const [source, setSource] = useState<Source>('service');
  const [serviceId, setServiceId] = useState('');
  const [labTestId, setLabTestId] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | undefined>();
  const services = useListServicesQuery(
    { limit: 100, isActive: true },
    { skip: source !== 'service' },
  );
  const tests = useListLabTestsQuery({ limit: 100 }, { skip: source !== 'lab' });
  const billable = (services.data?.items ?? []).filter(
    (s) => s.isActive !== false && (s.type === 'consultation' || s.type === 'procedure'),
  );
  const labTests = (tests.data?.items ?? []).filter((t) => t.isActive !== false);

  const add = () => {
    setError(undefined);
    if (source === 'service') {
      const s = billable.find((x) => x.id === serviceId);
      if (!s) return setError('Choose a service');
      onAdd(
        newRow({
          kind: s.type === 'consultation' ? 'consultation' : 'procedure',
          serviceId: s.id,
          description: s.name,
          unitPricePaise: s.pricePaise,
          taxRateBps: s.taxRateBps ?? defaultTaxRateBps,
        }),
      );
      setServiceId('');
    } else if (source === 'lab') {
      const t = labTests.find((x) => x.id === labTestId);
      if (!t) return setError('Choose a lab test');
      onAdd(
        newRow({
          kind: 'lab_test',
          labTestId: t.id,
          description: t.name,
          unitPricePaise: t.pricePaise,
          taxRateBps: defaultTaxRateBps,
        }),
      );
      setLabTestId('');
    } else {
      if (!description.trim()) return setError('Describe the line');
      if (price === null || Number.isNaN(price)) return setError('Enter a price');
      onAdd(
        newRow({
          kind: 'other',
          description: description.trim(),
          unitPricePaise: price,
          taxRateBps: defaultTaxRateBps,
        }),
      );
      setDescription('');
      setPrice(null);
    }
    return undefined;
  };

  return (
    <div className="rounded-card border border-dashed border-line-strong p-4">
      <Tabs
        label="Add a line from"
        variant="pills"
        tabs={[
          { id: 'service', label: 'Service' },
          { id: 'lab', label: 'Lab test' },
          { id: 'other', label: 'Other' },
        ]}
        value={source}
        onChange={(id) => {
          setSource(id as Source);
          setError(undefined);
        }}
      >
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          {source === 'service' && (
            <Select
              label="Service"
              className="sm:flex-1"
              placeholder={services.isLoading ? 'Loading services…' : 'Choose a service'}
              options={billable.map((s) => ({
                value: s.id,
                label: `${s.name} – ${formatINR(s.pricePaise)}`,
              }))}
              value={serviceId}
              error={error}
              onChange={(e) => setServiceId(e.target.value)}
            />
          )}
          {source === 'lab' && (
            <Select
              label="Lab test"
              className="sm:flex-1"
              placeholder={tests.isLoading ? 'Loading tests…' : 'Choose a lab test'}
              options={labTests.map((t) => ({
                value: t.id,
                label: `${t.name} (${t.code}) – ${formatINR(t.pricePaise)}`,
              }))}
              value={labTestId}
              error={error}
              onChange={(e) => setLabTestId(e.target.value)}
            />
          )}
          {source === 'other' && (
            <>
              <Input
                label="Description"
                className="sm:flex-1"
                value={description}
                maxLength={BILLING_RULES.descriptionMax}
                error={error}
                onChange={(e) => setDescription(e.target.value)}
              />
              <MoneyInput label="Price" value={price} onChange={setPrice} className="sm:w-40" />
            </>
          )}
          <Button variant="secondary" onClick={add} className={error ? 'sm:mb-6' : ''}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add line
          </Button>
        </div>
      </Tabs>
    </div>
  );
}
