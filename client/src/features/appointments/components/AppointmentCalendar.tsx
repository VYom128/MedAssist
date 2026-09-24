import { format, getDay, parse, startOfWeek } from 'date-fns';
import { enIN } from 'date-fns/locale';
import { useMemo } from 'react';
import { Calendar, dateFnsLocalizer, type SlotInfo } from 'react-big-calendar';
import withDragAndDrop, {
  type EventInteractionArgs,
} from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { STATUS_STYLES } from '../../../components/ui/statusStyles';
import { fromClinicWallDate, toClinicWallDate, wallDateString } from '../../../utils/clinicTime';
import type { CalendarEvent } from '../api';
import '../calendar.css';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales: { 'en-IN': enIN },
});

/** An event on the calendar: times are clinic wall dates (utils/clinicTime). */
export interface CalendarItem {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resourceId: string;
  source: CalendarEvent;
  moving?: boolean;
}
interface Resource {
  id: string;
  title: string;
}

const DnDCalendar = withDragAndDrop<CalendarItem, Resource>(Calendar);

/** Visible hours, as wall times (only the time part is used). */
const MIN = new Date(1970, 0, 1, 7, 0);
const MAX = new Date(1970, 0, 1, 21, 0);

/** Clinic date 'YYYY-MM-DD' → the calendar's wall date for that day. */
const wallDateOf = (date: string) => parse(date, 'yyyy-MM-dd', new Date());

/**
 * Day or week calendar in clinic time (spec §13.4 #1). In day view with no doctor chosen, each
 * doctor is a column. Only scheduled appointments can be dragged. Callbacks get real instants.
 */
export default function AppointmentCalendar({
  view,
  date,
  events,
  doctors,
  showResources,
  moving,
  onNavigate,
  onSelectSlot,
  onSelectEvent,
  onMove,
}: {
  view: 'day' | 'week';
  /** Clinic date shown (day) or inside the week shown. */
  date: string;
  events: CalendarEvent[];
  doctors: { id: string; name: string }[];
  showResources: boolean;
  /** An event being moved (drawn at its new place until the server answers). */
  moving: { id: string; startAt: string; doctorId?: string } | null;
  onNavigate: (date: string) => void;
  onSelectSlot: (slot: { startAt: string; date: string; doctorId?: string }) => void;
  onSelectEvent: (id: string) => void;
  onMove: (event: CalendarEvent, startAt: string, doctorId?: string) => void;
}) {
  const items = useMemo<CalendarItem[]>(
    () =>
      events.map((e) => {
        const isMoving = moving?.id === e.id;
        const startAt = isMoving ? moving.startAt : e.startAt;
        const duration = new Date(e.endAt).getTime() - new Date(e.startAt).getTime();
        return {
          id: e.id,
          title: `${e.appointmentNumber.slice(-6)} · ${e.patientShortName}`,
          start: toClinicWallDate(startAt),
          end: toClinicWallDate(new Date(new Date(startAt).getTime() + duration)),
          resourceId: (isMoving && moving.doctorId) || e.doctorId,
          source: e,
          moving: isMoving,
        };
      }),
    [events, moving],
  );
  const resources = useMemo(() => doctors.map((d) => ({ id: d.id, title: d.name })), [doctors]);

  return (
    <div className="ma-calendar h-[70vh] min-h-[480px]">
      <DnDCalendar
        localizer={localizer}
        culture="en-IN"
        events={items}
        view={view}
        views={['day', 'week']}
        onView={() => undefined}
        date={wallDateOf(date)}
        onNavigate={(d) => onNavigate(wallDateString(d))}
        toolbar={false}
        min={MIN}
        max={MAX}
        step={15}
        timeslots={4}
        getNow={() => toClinicWallDate(new Date())}
        selectable
        popup
        resizable={false}
        {...(showResources
          ? {
              resources,
              resourceIdAccessor: (r: Resource) => r.id,
              resourceTitleAccessor: (r: Resource) => r.title,
            }
          : {})}
        draggableAccessor={(e: CalendarItem) => e.source.status === 'scheduled'}
        eventPropGetter={(e: CalendarItem) => ({
          className: `ma-event-${STATUS_STYLES.appointment[e.source.status].tone}${
            e.moving ? ' ma-event-moving' : ''
          }`,
        })}
        tooltipAccessor={(e: CalendarItem) =>
          `${e.source.appointmentNumber} – ${e.source.patientShortName} (${STATUS_STYLES.appointment[e.source.status].label})`
        }
        onSelectEvent={(e: CalendarItem) => onSelectEvent(e.id)}
        onSelectSlot={(slot: SlotInfo) =>
          onSelectSlot({
            startAt: fromClinicWallDate(slot.start).toISOString(),
            date: wallDateString(slot.start),
            ...(slot.resourceId ? { doctorId: String(slot.resourceId) } : {}),
          })
        }
        onEventDrop={({ event, start, resourceId }: EventInteractionArgs<CalendarItem>) => {
          const startAt = fromClinicWallDate(new Date(start)).toISOString();
          const doctorId = resourceId ? String(resourceId) : undefined;
          if (
            startAt === event.source.startAt &&
            (!doctorId || doctorId === event.source.doctorId)
          ) {
            return;
          }
          onMove(event.source, startAt, doctorId !== event.source.doctorId ? doctorId : undefined);
        }}
      />
    </div>
  );
}
