import type { QueueBoard } from './api';

const token = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

/**
 * Only the fields the board may show, re-read defensively: whatever else the API might send
 * (a patient name by mistake) is never rendered (spec §4.6 step 6).
 */
export function boardTiles(board: QueueBoard | undefined) {
  return (board?.doctors ?? []).map((d) => ({
    doctorName: typeof d.doctorName === 'string' ? d.doctorName : '',
    roomNumber: typeof d.roomNumber === 'string' ? d.roomNumber : null,
    nowServing: token(d.nowServing),
    next: (Array.isArray(d.next) ? d.next : [])
      .map(token)
      .filter((t): t is number => t !== null)
      .slice(0, 5),
  }));
}
