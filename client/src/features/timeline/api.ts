import { apiSlice } from '../../app/apiSlice';
import type { ApiSuccess } from '../../utils/http';

/** Server shapes from server/src/modules/timeline (spec §8.8, Phase 8). */

export const TIMELINE_TYPES = [
  'appointment',
  'encounter',
  'prescription',
  'lab_order',
  'invoice',
  'payment',
  'document',
  'followup_request',
] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

/**
 * One timeline entry. Titles and subtitles come from the server, already filtered for the
 * viewer's role (reception gets no clinical items or text) – the client only shows them.
 */
export interface TimelineItem {
  type: TimelineType;
  id: string;
  at: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  /** The client page for this item and role, or null. */
  link: string | null;
  flags: string[];
}

export interface TimelinePage {
  items: TimelineItem[];
  /** Opaque: send back as `before` for the next page; null on the last page. */
  nextCursor: string | null;
}

export interface TimelineArgs {
  /** A patient id (doctor, reception) or 'me' (the patient's own timeline). */
  patientId: string;
  types?: TimelineType[];
  /** Clinic dates 'YYYY-MM-DD' (inclusive). */
  from?: string;
  to?: string;
  limit?: number;
}

/** Tag of one patient's timeline ('me' for the patient's own). */
export const timelineTag = (patientId: string) => ({ type: 'Timeline' as const, id: patientId });

/**
 * The timeline as an infinite query: each page is fetched with the previous page's cursor and
 * RTK Query keeps the pages together under one cache entry per patient + filters, so "Load more"
 * appends. Changing a filter is a new entry (fetched from the first page).
 */
export const timelineApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getTimeline: build.infiniteQuery<TimelinePage, TimelineArgs, string | null>({
      infiniteQueryOptions: {
        initialPageParam: null,
        getNextPageParam: (last) => last.nextCursor,
      },
      query: ({ queryArg: { patientId, types, from, to, limit = 20 }, pageParam }) => ({
        url: patientId === 'me' ? '/patients/me/timeline' : `/patients/${patientId}/timeline`,
        params: {
          limit,
          ...(pageParam ? { before: pageParam } : {}),
          ...(types && types.length > 0 ? { types: types.join(',') } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      }),
      transformResponse: (res: ApiSuccess<TimelineItem[]>) => ({
        items: res.data,
        nextCursor: (res.meta?.nextCursor as string | null | undefined) ?? null,
      }),
      providesTags: (_r, _e, { patientId }) => [timelineTag(patientId), 'Timeline'],
    }),
  }),
});

export const { useGetTimelineInfiniteQuery } = timelineApi;

/** The items of all loaded pages, newest first, each once (a page boundary never repeats one). */
export function flattenPages(pages: readonly TimelinePage[] | undefined): TimelineItem[] {
  const seen = new Set<string>();
  const items: TimelineItem[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}
