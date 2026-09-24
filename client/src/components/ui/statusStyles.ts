import {
  Ban,
  CalendarCheck,
  CirclePause,
  CalendarClock,
  CalendarOff,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  Clock,
  Link2,
  Lock,
  Mail,
  Presentation,
  ShieldX,
  Siren,
  Stethoscope,
  TriangleAlert,
  UserCheck,
  UserX,
  ArrowUp,
  type LucideIcon,
} from 'lucide-react';
import type { LeaveType } from '../../constants/catalog';

/** Colour families from index.css (50 background, 500 dot, 700 text). */
export type Tone = 'primary' | 'info' | 'success' | 'warning' | 'consult' | 'danger' | 'neutral';

export const TONE_CLASSES: Record<Tone, { pill: string; dot: string; chip: string }> = {
  primary: {
    pill: 'bg-primary-50 text-primary-700 ring-primary-100',
    dot: 'bg-primary-500',
    chip: 'bg-primary-50 text-primary-600',
  },
  info: {
    pill: 'bg-info-50 text-info-700 ring-info-100',
    dot: 'bg-info-500',
    chip: 'bg-info-50 text-info-700',
  },
  success: {
    pill: 'bg-success-50 text-success-700 ring-success-100',
    dot: 'bg-success-500',
    chip: 'bg-success-50 text-success-700',
  },
  warning: {
    pill: 'bg-warning-50 text-warning-700 ring-warning-100',
    dot: 'bg-warning-500',
    chip: 'bg-warning-50 text-warning-700',
  },
  consult: {
    pill: 'bg-consult-50 text-consult-700 ring-consult-100',
    dot: 'bg-consult-500',
    chip: 'bg-consult-50 text-consult-700',
  },
  danger: {
    pill: 'bg-danger-50 text-danger-700 ring-danger-100',
    dot: 'bg-danger-500',
    chip: 'bg-danger-50 text-danger-700',
  },
  neutral: {
    pill: 'bg-neutral-50 text-neutral-700 ring-neutral-100',
    dot: 'bg-neutral-500',
    chip: 'bg-neutral-50 text-neutral-700',
  },
};

export interface StatusStyle {
  tone: Tone;
  label: string;
  icon: LucideIcon;
}

/**
 * The one status → look map for the whole app (spec §13.3). Every status pill reads from here,
 * and every entry has an icon and a label, so a status is never shown by colour alone.
 * Keys are the values the API returns. Appointment, queue and priority entries are defined ahead
 * of Phase 4 so those screens pick up the same look.
 */
export const STATUS_STYLES = {
  /** Master data: departments, services, doctors, lab tests. */
  record: {
    active: { tone: 'success', label: 'Active', icon: CircleCheck },
    inactive: { tone: 'neutral', label: 'Inactive', icon: CircleMinus },
  },
  /** Staff and patient user accounts. */
  account: {
    active: { tone: 'success', label: 'Active', icon: CircleCheck },
    inactive: { tone: 'neutral', label: 'Inactive', icon: CircleMinus },
    locked: { tone: 'warning', label: 'Locked', icon: Lock },
  },
  /** Patient portal access (features/patients/portal.ts PortalState). */
  portal: {
    none: { tone: 'neutral', label: 'No portal', icon: CircleDashed },
    invited: { tone: 'info', label: 'Portal invited', icon: Mail },
    linked: { tone: 'success', label: 'Portal active', icon: Link2 },
    pending: { tone: 'warning', label: 'Portal: ID check pending', icon: Clock },
  },
  /** Audit log outcome. */
  auditOutcome: {
    success: { tone: 'success', label: 'success', icon: CircleCheck },
    denied: { tone: 'danger', label: 'denied', icon: ShieldX },
    failure: { tone: 'warning', label: 'failure', icon: TriangleAlert },
  },
  /** Whether a doctor takes new bookings. */
  booking: {
    accepting: { tone: 'info', label: 'Accepting', icon: CalendarCheck },
    paused: { tone: 'warning', label: 'Paused', icon: CirclePause },
  },
  /** Doctor leave type, plus a cancelled leave. */
  leave: {
    leave: { tone: 'info', label: 'Leave', icon: CalendarOff },
    conference: { tone: 'info', label: 'Conference', icon: Presentation },
    emergency: { tone: 'danger', label: 'Emergency', icon: TriangleAlert },
    other: { tone: 'info', label: 'Other', icon: CalendarOff },
    cancelled: { tone: 'neutral', label: 'Cancelled', icon: Ban },
  } satisfies Record<LeaveType | 'cancelled', StatusStyle>,
  /** Appointment lifecycle (Phase 4, spec §4.5–4.6). */
  appointment: {
    scheduled: { tone: 'info', label: 'Scheduled', icon: CalendarClock },
    checked_in: { tone: 'warning', label: 'Checked in', icon: UserCheck },
    in_consultation: { tone: 'consult', label: 'In consultation', icon: Stethoscope },
    completed: { tone: 'success', label: 'Completed', icon: CircleCheck },
    cancelled: { tone: 'neutral', label: 'Cancelled', icon: Ban },
    no_show: { tone: 'danger', label: 'No-show', icon: UserX },
  },
  /** Queue priority and clinical flags. */
  priority: {
    priority: { tone: 'warning', label: 'Priority', icon: ArrowUp },
    emergency: { tone: 'danger', label: 'Emergency', icon: Siren },
    critical: { tone: 'danger', label: 'Critical', icon: TriangleAlert },
  },
} as const satisfies Record<string, Record<string, StatusStyle>>;

export type StatusDomain = keyof typeof STATUS_STYLES;
export type StatusKey<D extends StatusDomain> = keyof (typeof STATUS_STYLES)[D];
