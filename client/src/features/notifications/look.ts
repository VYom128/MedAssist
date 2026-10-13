import {
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarOff,
  CalendarX,
  Clock,
  FlaskConical,
  HandCoins,
  KeyRound,
  MessageSquare,
  Pill,
  ReceiptIndianRupee,
  Siren,
  TestTubes,
  UserCheck,
  UserPlus,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import type { Tone } from '../../components/ui/statusStyles';
import { NOTIFICATION_TYPE_LABELS, type NotificationType } from '../../constants/notifications';
import { formatDateTime } from '../../utils/dates';

/** Icon and tone per notification type (bell, list and toasts). Unknown types get a bell. */
const LOOK: Record<NotificationType, { icon: LucideIcon; tone: Tone }> = {
  'appointment.booked': { icon: CalendarCheck, tone: 'info' },
  'appointment.rescheduled': { icon: CalendarClock, tone: 'info' },
  'appointment.cancelled': { icon: CalendarX, tone: 'neutral' },
  'appointment.no_show': { icon: UserX, tone: 'warning' },
  'appointment.reminder': { icon: Clock, tone: 'info' },
  'appointment.checked_in': { icon: UserCheck, tone: 'success' },
  'queue.your_turn': { icon: UserCheck, tone: 'consult' },
  'doctor.leave_affects_appointments': { icon: CalendarOff, tone: 'warning' },
  'prescription.issued': { icon: Pill, tone: 'primary' },
  'lab.sample_rejected': { icon: FlaskConical, tone: 'warning' },
  'lab.critical_value': { icon: Siren, tone: 'danger' },
  'lab.result_released': { icon: TestTubes, tone: 'info' },
  'lab.result_revised': { icon: TestTubes, tone: 'warning' },
  'lab.tat_overdue': { icon: Clock, tone: 'warning' },
  'invoice.issued': { icon: ReceiptIndianRupee, tone: 'primary' },
  'payment.received': { icon: HandCoins, tone: 'success' },
  'followup.reminder': { icon: CalendarClock, tone: 'info' },
  'followup.request_new': { icon: MessageSquare, tone: 'primary' },
  'followup.request_reply': { icon: MessageSquare, tone: 'primary' },
  'followup.request_updated': { icon: MessageSquare, tone: 'neutral' },
  'account.created': { icon: UserPlus, tone: 'neutral' },
  'account.password_reset': { icon: KeyRound, tone: 'neutral' },
};

export const notificationLook = (type: string) =>
  LOOK[type as NotificationType] ?? { icon: Bell, tone: 'neutral' as Tone };

export const notificationTypeLabel = (type: string) =>
  NOTIFICATION_TYPE_LABELS[type as NotificationType] ?? 'Notification';

/**
 * "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the clinic date and time.
 * `now` is passed in so a list renders consistently.
 */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return formatDateTime(iso);
}
