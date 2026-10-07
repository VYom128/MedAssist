import {
  CalendarDays,
  FileStack,
  FileText,
  FlaskConical,
  MessageSquare,
  Pill,
  Receipt,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { StatusDomain, Tone } from '../../components/ui/statusStyles';
import { formatInClinic } from '../../utils/dates';
import type { TimelineItem, TimelineType } from './api';

/** How each item type looks: icon, tone, label (filter chips) and its status domain. */
export const TYPE_LOOK: Record<
  TimelineType,
  { icon: LucideIcon; tone: Tone; label: string; domain?: StatusDomain }
> = {
  appointment: { icon: CalendarDays, tone: 'info', label: 'Appointments', domain: 'appointment' },
  encounter: { icon: FileText, tone: 'consult', label: 'Visit notes', domain: 'encounter' },
  prescription: { icon: Pill, tone: 'primary', label: 'Prescriptions', domain: 'prescription' },
  lab_order: { icon: FlaskConical, tone: 'info', label: 'Lab', domain: 'labOrder' },
  invoice: { icon: Receipt, tone: 'warning', label: 'Invoices', domain: 'invoice' },
  payment: { icon: Wallet, tone: 'success', label: 'Payments', domain: 'payment' },
  document: { icon: FileStack, tone: 'neutral', label: 'Documents' },
  followup_request: {
    icon: MessageSquare,
    tone: 'primary',
    label: 'Follow-up requests',
    domain: 'followup',
  },
};

/** Flags worth a badge; anything else the server sends is ignored. */
export const FLAG_BADGES: Record<
  string,
  { label: string; tone: 'danger' | 'warning' | 'info' | 'neutral' }
> = {
  critical: { label: 'Critical', tone: 'danger' },
  urgent: { label: 'Urgent', tone: 'warning' },
  amended: { label: 'Amended', tone: 'info' },
  follow_up_planned: { label: 'Follow-up planned', tone: 'info' },
  follow_up: { label: 'Follow-up visit', tone: 'neutral' },
  walk_in: { label: 'Walk-in', tone: 'neutral' },
};

/** Groups items (already newest first) by clinic month: [['October 2026', items], …]. */
export function groupByMonth(items: readonly TimelineItem[]): [string, TimelineItem[]][] {
  const groups: [string, TimelineItem[]][] = [];
  for (const item of items) {
    const month = formatInClinic(item.at, 'MMMM yyyy');
    const last = groups.at(-1);
    if (last && last[0] === month) last[1].push(item);
    else groups.push([month, [item]]);
  }
  return groups;
}
