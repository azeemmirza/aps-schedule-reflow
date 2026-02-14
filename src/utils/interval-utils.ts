import type { DateTime } from 'luxon';
import { Interval } from 'luxon';

export type ReservationKind = 'maintenanceWindow' | 'fixedMaintenanceWO' | 'scheduledWO';

export type Reservation = {
  start: DateTime;
  end: DateTime;
  kind: ReservationKind;
  refId?: string;
  meta?: Record<string, unknown>;
};

export function asInterval(start: DateTime, end: DateTime): Interval {
  if (end <= start) throw new Error(`Invalid interval: end <= start (${start.toISO()} - ${end.toISO()})`);
  return Interval.fromDateTimes(start, end);
}

export function overlaps(a: Reservation, b: Reservation): boolean {
  return asInterval(a.start, a.end).overlaps(asInterval(b.start, b.end));
}

export function sortReservations(rs: Reservation[]): Reservation[] {
  return [...rs].sort((x, y) => x.start.toMillis() - y.start.toMillis());
}

/**
 * Merge reservations into a simplified blocked list.
 * For overlap checks, we can merge everything because all are "unavailable".
 */
export function mergeReservations(rs: Reservation[]): Reservation[] {
  const sorted = sortReservations(rs);
  const out: Reservation[] = [];

  for (const r of sorted) {
    const last = out[out.length - 1];
    if (!last) {
      out.push({ ...r });
      continue;
    }
    if (r.start <= last.end) {
      last.end = r.end > last.end ? r.end : last.end;
      continue;
    }
    out.push({ ...r });
  }

  return out;
}

/**
 * Find the first reservation that overlaps interval [start, end).
 * Assumes rs are merged + sorted.
 */
export function firstOverlap(
  rs: Reservation[],
  start: DateTime,
  end: DateTime,
): Reservation | undefined {
  const target = asInterval(start, end);
  for (const r of rs) {
    const ri = asInterval(r.start, r.end);
    if (ri.overlaps(target)) return r;
    // small optimization: if reservation starts after end, no future overlaps
    if (r.start >= end) return undefined;
  }
  return undefined;
}
