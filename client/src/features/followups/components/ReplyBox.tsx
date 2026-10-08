import { Lock, Send } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Switch from '../../../components/ui/Switch';
import Textarea from '../../../components/ui/Textarea';
import { getQueryErrorMessage } from '../../../utils/http';
import { usePostFollowupMessageMutation, type Followup } from '../api';

const MAX = 2000;

/**
 * Writing in a request's thread. Staff can switch to an internal note (never shown to the
 * patient); public replies are off once the request is finished (`publicDisabled` explains why).
 */
export default function ReplyBox({
  request,
  canInternal,
  publicDisabled,
}: {
  request: Followup;
  canInternal: boolean;
  /** Why public replies are not possible now (null when they are). */
  publicDisabled: string | null;
}) {
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [post, posting] = usePostFollowupMessageMutation();
  const blocked = !internal && publicDisabled !== null;
  if (blocked && !canInternal) {
    return (
      <p className="rounded-control bg-surface-muted p-3 text-sm text-muted">{publicDisabled}</p>
    );
  }

  const send = async () => {
    setError(null);
    const body = text.trim();
    if (!body) {
      setError('Write a message first.');
      return;
    }
    try {
      await post({ id: request.id, text: body, visibility: internal ? 'staff' : 'all' }).unwrap();
      setText('');
      toast.success(internal ? 'Internal note added' : 'Message sent');
    } catch (err) {
      setError(getQueryErrorMessage(err));
    }
  };

  return (
    <form
      className={`space-y-3 rounded-card border p-4 ${internal ? 'border-dashed border-warning-500 bg-warning-50' : 'border-line bg-surface'}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {canInternal && (
        <Switch
          checked={internal}
          onChange={setInternal}
          label="Internal note"
          description="Only staff see it – never the patient."
        />
      )}
      {blocked ? (
        <p className="text-sm text-muted">{publicDisabled}</p>
      ) : (
        <>
          <Textarea
            label={internal ? 'Internal note' : 'Your message'}
            autoGrow
            maxLength={MAX}
            value={text}
            hint={`${text.length}/${MAX}`}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex justify-end">
            <Button
              type="submit"
              variant={internal ? 'secondary' : 'primary'}
              loading={posting.isLoading}
            >
              {internal ? (
                <>
                  <Lock className="h-4 w-4" aria-hidden="true" /> Add internal note
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" aria-hidden="true" /> Send
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
