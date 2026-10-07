import {
  ArrowDown,
  Ban,
  BadgeCheck,
  Beaker,
  CircleAlert,
  FlaskConical,
  Send,
  TestTubeDiagonal,
  Undo2,
  CalendarCheck,
  CirclePause,
  CalendarClock,
  CalendarOff,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  Clock,
  FileCheck2,
  FileClock,
  FilePen,
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
  Layers,
  CircleDollarSign,
  Undo,
  Receipt,
  HandCoins,
  Minus,
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
  /** Appointment flags shown next to the status. */
  appointmentFlag: {
    overbook: { tone: 'warning', label: 'Overbooked', icon: Layers },
  },
  /** Clinical note (Phase 5, spec §5.2). */
  encounter: {
    draft: { tone: 'warning', label: 'Draft', icon: FilePen },
    signed: { tone: 'success', label: 'Signed', icon: FileCheck2 },
    amended: { tone: 'info', label: 'Amended', icon: FileClock },
  },
  /** Prescription (Phase 5, spec §5.3). */
  prescription: {
    draft: { tone: 'warning', label: 'Draft', icon: FilePen },
    issued: { tone: 'success', label: 'Issued', icon: FileCheck2 },
    completed: { tone: 'neutral', label: 'Completed', icon: CircleCheck },
    cancelled: { tone: 'neutral', label: 'Cancelled', icon: Ban },
  },
  /** Lab order (Phase 6, spec §5.4 + draft). */
  labOrder: {
    draft: { tone: 'warning', label: 'Draft', icon: FilePen },
    ordered: { tone: 'info', label: 'Ordered', icon: Send },
    sample_collected: { tone: 'primary', label: 'Sample collected', icon: TestTubeDiagonal },
    sample_rejected: { tone: 'danger', label: 'Sample rejected', icon: Undo2 },
    processing: { tone: 'consult', label: 'Processing', icon: Beaker },
    result_entered: { tone: 'warning', label: 'Awaiting verification', icon: FlaskConical },
    verified: { tone: 'success', label: 'Verified', icon: BadgeCheck },
    released: { tone: 'success', label: 'Released', icon: FileCheck2 },
    cancelled: { tone: 'neutral', label: 'Cancelled', icon: Ban },
  },
  /** One test of a lab order. */
  labItem: {
    pending: { tone: 'neutral', label: 'Pending', icon: CircleDashed },
    result_entered: { tone: 'warning', label: 'Entered', icon: FlaskConical },
    verified: { tone: 'success', label: 'Verified', icon: BadgeCheck },
    cancelled: { tone: 'neutral', label: 'Cancelled', icon: Ban },
  },
  /** A result's flag (spec §8.7); `na` shows nothing. */
  labFlag: {
    normal: { tone: 'success', label: 'Normal', icon: CircleCheck },
    low: { tone: 'warning', label: 'Low', icon: ArrowDown },
    high: { tone: 'warning', label: 'High', icon: ArrowUp },
    critical_low: { tone: 'danger', label: 'Critical low', icon: Siren },
    critical_high: { tone: 'danger', label: 'Critical high', icon: Siren },
    abnormal: { tone: 'warning', label: 'Abnormal', icon: CircleAlert },
    na: { tone: 'neutral', label: '—', icon: Minus },
  },
  /** Lab priority. */
  labPriority: {
    routine: { tone: 'neutral', label: 'Routine', icon: Minus },
    urgent: { tone: 'danger', label: 'Urgent', icon: Siren },
  },
  /** Lab turnaround. */
  labTat: {
    overdue: { tone: 'danger', label: 'Overdue', icon: Clock },
  },
  /** Invoice (Phase 7, spec §5.5). */
  invoice: {
    draft: { tone: 'warning', label: 'Draft', icon: FilePen },
    issued: { tone: 'info', label: 'Unpaid', icon: Receipt },
    partially_paid: { tone: 'warning', label: 'Partly paid', icon: HandCoins },
    paid: { tone: 'success', label: 'Paid', icon: CircleCheck },
    void: { tone: 'neutral', label: 'Void', icon: Ban },
  },
  /** A payment record (refunds are negative payments). */
  payment: {
    payment: { tone: 'success', label: 'Payment', icon: CircleDollarSign },
    refund: { tone: 'warning', label: 'Refund', icon: Undo },
  },
  /** Queue priority and clinical flags. */
  priority: {
    normal: { tone: 'neutral', label: 'Normal', icon: Minus },
    priority: { tone: 'warning', label: 'Priority', icon: ArrowUp },
    emergency: { tone: 'danger', label: 'Emergency', icon: Siren },
    critical: { tone: 'danger', label: 'Critical', icon: TriangleAlert },
  },
} as const satisfies Record<string, Record<string, StatusStyle>>;

export type StatusDomain = keyof typeof STATUS_STYLES;
export type StatusKey<D extends StatusDomain> = keyof (typeof STATUS_STYLES)[D];
