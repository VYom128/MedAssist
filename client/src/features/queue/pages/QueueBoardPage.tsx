import { MonitorX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiSlice } from '../../../app/apiSlice';
import { useAppDispatch } from '../../../app/hooks';
import { formatInClinic } from '../../../utils/dates';
import { isApiQueryError } from '../../../utils/http';
import { useGetPublicSettingsQuery } from '../../settings/api';
import { useGetQueueBoardQuery } from '../api';
import { boardTiles } from '../board';
import { useKioskSocket } from '../useKioskSocket';

const POLL_MS = 15_000;

function Screen({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-8 text-center text-white">
      <div>
        <MonitorX className="mx-auto h-12 w-12" aria-hidden="true" />
        <h1 className="mt-4 text-3xl font-bold">{title}</h1>
        <p className="mt-2 text-lg opacity-80">{message}</p>
      </div>
    </main>
  );
}

/**
 * /queue-board?key=… – the waiting-room screen (spec §4.6, §7.9): per doctor the room, the token
 * with the doctor now and the next tokens, plus the clinic time. Public (kiosk key, no login),
 * full screen, high contrast. Live over Socket.IO with the kiosk key; polls every 15 s while the
 * socket is not connected. Never shows patient names.
 */
export default function QueueBoardPage() {
  const [params] = useSearchParams();
  const key = params.get('key') ?? '';
  const dispatch = useAppDispatch();
  const { data: clinic } = useGetPublicSettingsQuery();
  const connected = useKioskSocket(key, () =>
    dispatch(apiSlice.util.invalidateTags(['QueueBoard'])),
  );
  const { data, error, isLoading } = useGetQueueBoardQuery(key, {
    skip: !key,
    pollingInterval: connected ? 0 : POLL_MS,
  });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (!key) {
    return (
      <Screen
        title="Queue board"
        message="This screen needs its kiosk link. Please ask the clinic staff."
      />
    );
  }
  if (isApiQueryError(error) && (error.status === 401 || error.status === 404)) {
    return (
      <Screen
        title="Queue board unavailable"
        message={
          error.status === 401 ? 'The kiosk key is not valid.' : 'The queue board is not set up.'
        }
      />
    );
  }

  const tiles = boardTiles(data);
  return (
    <main className="min-h-screen bg-ink p-6 text-white lg:p-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-lg opacity-80">{clinic?.name ?? 'MedAssist'}</p>
          <h1 className="text-4xl font-bold lg:text-5xl">Now serving</h1>
        </div>
        <p className="tabular text-4xl font-bold lg:text-5xl" aria-label="Clinic time">
          {formatInClinic(now, 'h:mm a')}
        </p>
      </header>

      {error && (
        <p role="status" className="mt-4 text-lg opacity-80">
          Reconnecting…
        </p>
      )}
      {isLoading && <p className="mt-10 text-2xl opacity-80">Loading…</p>}
      {data && tiles.length === 0 && (
        <p className="mt-10 text-2xl opacity-80">No queues yet today.</p>
      )}
      <ul className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <li
            key={`${t.doctorName}-${t.roomNumber}`}
            className="rounded-card bg-surface p-6 text-ink shadow-card"
          >
            <p className="text-2xl font-bold">{t.doctorName}</p>
            {t.roomNumber && <p className="text-xl text-body">Room {t.roomNumber}</p>}
            <div className="mt-4 flex items-end gap-6">
              <div>
                <p className="text-sm font-semibold tracking-wide text-muted uppercase">Now</p>
                <p
                  className="tabular text-7xl leading-none font-bold text-primary-700"
                  aria-label={`Now serving token ${t.nowServing ?? 'none'}`}
                >
                  {t.nowServing ?? '–'}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-wide text-muted uppercase">Next</p>
                <p
                  className="tabular text-3xl font-bold"
                  aria-label={`Next tokens ${t.next.join(', ') || 'none'}`}
                >
                  {t.next.length > 0 ? t.next.join('  ') : '–'}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
