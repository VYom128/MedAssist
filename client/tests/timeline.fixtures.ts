import type { TimelineItem } from '../src/features/timeline/api';

/** A timeline item (server shape, Phase 8). */
export const timelineItem = (over: Partial<TimelineItem> = {}): TimelineItem => ({
  type: 'appointment',
  id: 'a1',
  at: '2026-09-20T05:00:00.000Z',
  title: 'Visit with Dr Anil Mehta',
  subtitle: 'Consultation · General Medicine',
  status: 'completed',
  link: '/doctor/appointments/a1',
  flags: [],
  ...over,
});

/** A timeline page response body's meta. */
export const timelineMeta = (nextCursor: string | null = null, limit = 20) => ({
  limit,
  nextCursor,
});
