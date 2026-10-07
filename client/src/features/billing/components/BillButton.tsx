import { Receipt } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import { getQueryErrorMessage } from '../../../utils/http';
import { useLazyListInvoicesQuery } from '../api';

/**
 * Reception queue, "Done" column: opens the completed visit's invoice (the draft first, else the
 * latest one). The draft appears when the doctor signs the note.
 */
export default function BillButton({ appointmentId }: { appointmentId: string }) {
  const navigate = useNavigate();
  const [find, { isFetching }] = useLazyListInvoicesQuery();
  const open = async () => {
    try {
      const page = await find({ appointment: appointmentId, limit: 10 }).unwrap();
      const live = page.items.filter((i) => i.status !== 'void');
      const target = live.find((i) => i.status === 'draft') ?? live[0];
      if (target) navigate(`/reception/invoices/${target.id}`);
      else toast('No invoice yet – it is drafted when the doctor signs the note.');
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    }
  };
  return (
    <Button size="sm" variant="secondary" loading={isFetching} onClick={() => void open()}>
      <Receipt className="h-4 w-4" aria-hidden="true" /> Bill
    </Button>
  );
}
