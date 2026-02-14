import type { DateTime } from 'luxon';
import { Interval } from 'luxon';
import type { Reservation } from './interval-utils';

export type Shift = { dayOfWeek: number; startHour: number; endHour: number };

function luxonDowToSpecDayOfWeek(d: DateTime): number {
  // Luxon weekday: Mon=1..Sun=7
  // Spec dayOfWeek: Sun=0..Sat=6
  return d.weekday % 7; // Sunday=0, Monday=1, ...
}

/**
 * Returns all shift windows for a given day (UTC). Supports multiple shifts per day.
 */
export function shiftWindowsForDay(dayStartUtc: DateTime, shifts: Shift[]): Interval[] {
  const dow = luxonDowToSpecDayOfWeek(dayStartUtc);
  const todays = shifts.filter((s) => s.dayOfWeek === dow);

  return todays.map((s) => {
    const start = dayStartUtc.set({ hour: s.startHour, minute: 0, second: 0, millisecond: 0 });
    const end = dayStartUtc.set({ hour: s.endHour, minute: 0, second: 0, millisecond: 0 });

    if (end <= start) {
      // @upgrade implement overnight shifts (cross-midnight)
      throw new Error(`Overnight shift not supported yet: ${JSON.stringify(s)}`);
    }
    return Interval.fromDateTimes(start, end);
  });
}

/**
 * Snap a timestamp forward to the next instant that lies within some shift window.
 */
export function snapToNextShiftTime(t: DateTime, shifts: Shift[]): DateTime {
  let cursor = t;
  for (let i = 0; i < 14; i++) {
    const day = cursor.startOf('day');
    const windows = shiftWindowsForDay(day, shifts);
    if (windows.length === 0) {
      cursor = day.plus({ days: 1 });
      continue;
    }

    const sorted = [...windows].sort((a, b) => {
      const aStart = a.start;
      const bStart = b.start;
      if (!aStart || !bStart) return 0;
      return aStart.toMillis() - bStart.toMillis();
    });

    for (const w of sorted) {
      const wStart = w.start;
      const wEnd = w.end;
      if (!wStart || !wEnd) continue;

      if (cursor < wStart) return wStart;
      if (cursor >= wStart && cursor < wEnd) return cursor;
    }

    cursor = day.plus({ days: 1 });
  }
  throw new Error('No shift time found in next 14 days (check shift configuration).');
}

function subtractIntervals(base: Interval, blocks: Interval[]): Interval[] {
  let parts: Interval[] = [base];
  for (const b of blocks) {
    const next: Interval[] = [];
    for (const p of parts) {
      if (!p.overlaps(b)) {
        next.push(p);
        continue;
      }
      const pStart = p.start;
      const pEnd = p.end;
      const bStart = b.start;
      const bEnd = b.end;

      if (!pStart || !pEnd || !bStart || !bEnd) continue;

      const left = Interval.fromDateTimes(pStart, bStart);
      const right = Interval.fromDateTimes(bEnd, pEnd);
      if (left.isValid && left.length('minutes') > 0) next.push(left);
      if (right.isValid && right.length('minutes') > 0) next.push(right);
    }
    parts = next;
    if (parts.length === 0) break;
  }
  return parts.sort((a, b) => {
    const aStart = a.start;
    const bStart = b.start;
    if (!aStart || !bStart) return 0;
    return aStart.toMillis() - bStart.toMillis();
  });
}

/**
 * Calculate end date by consuming working minutes within shift windows.
 *
 * IMPORTANT model:
 * - DurationMinutes is "working" time.
 * - Outside shift windows -> time elapses but no work is performed.
 * - We DO NOT allow scheduling overlap with maintenance/reservations elsewhere (handled by overlap checks in reflow).
 */
export function calculateEndDateWithShifts(params: {
  start: DateTime;
  durationMinutes: number;
  shifts: Shift[];
}): DateTime {
  if (params.durationMinutes <= 0) return params.start;

  let remaining = params.durationMinutes;
  let cursor = snapToNextShiftTime(params.start, params.shifts);

  for (let dayGuard = 0; dayGuard < 60; dayGuard++) {
    const day = cursor.startOf('day');
    const windows = shiftWindowsForDay(day, params.shifts).sort((a, b) => {
      const aStart = a.start;
      const bStart = b.start;
      if (!aStart || !bStart) return 0;
      return aStart.toMillis() - bStart.toMillis();
    });

    if (windows.length === 0) {
      cursor = day.plus({ days: 1 });
      cursor = snapToNextShiftTime(cursor, params.shifts);
      continue;
    }

    for (const w of windows) {
      const wEnd = w.end;
      const wStart = w.start;
      if (!wEnd || !wStart) continue;

      if (cursor >= wEnd) continue;
      const workStart = cursor > wStart ? cursor : wStart;
      const workInt = Interval.fromDateTimes(workStart, wEnd);
      const minutes = Math.floor(workInt.length('minutes'));
      if (minutes <= 0) continue;

      if (remaining <= minutes) return workStart.plus({ minutes: remaining });

      remaining -= minutes;
      cursor = wEnd;
    }

    cursor = day.plus({ days: 1 });
    cursor = snapToNextShiftTime(cursor, params.shifts);
  }

  throw new Error('Unable to schedule within 60 days (check shifts).');
}

/**
 * Like calculateEndDateWithShifts, but also prevents work occurring inside maintenance windows
 * by subtracting them from the shift windows when consuming minutes.
 *
 * This still returns a single start/end range (wall-clock), but ensures "working minutes"
 * are never consumed within maintenance intervals.
 */
export function calculateEndDateWithShiftsAndMaintenance(params: {
  start: DateTime;
  durationMinutes: number;
  shifts: Shift[];
  maintenanceBlocks: Reservation[]; // merged
}): DateTime {
  if (params.durationMinutes <= 0) return params.start;

  let remaining = params.durationMinutes;
  let cursor = snapToNextShiftTime(params.start, params.shifts);

  for (let dayGuard = 0; dayGuard < 90; dayGuard++) {
    const day = cursor.startOf('day');
    const windows = shiftWindowsForDay(day, params.shifts).sort((a, b) => {
      const aStart = a.start;
      const bStart = b.start;
      if (!aStart || !bStart) return 0;
      return aStart.toMillis() - bStart.toMillis();
    });

    if (windows.length === 0) {
      cursor = day.plus({ days: 1 });
      cursor = snapToNextShiftTime(cursor, params.shifts);
      continue;
    }

    for (const w of windows) {
      const wEnd = w.end;
      const wStart = w.start;
      if (!wEnd || !wStart) continue;

      if (cursor >= wEnd) continue;

      const workStart = cursor > wStart ? cursor : wStart;
      const base = Interval.fromDateTimes(workStart, wEnd);

      const blocksToday = params.maintenanceBlocks
        .map((r) => Interval.fromDateTimes(r.start, r.end))
        .filter((b) => b.overlaps(base))
        .sort((a, bb) => {
          const aStart = a.start;
          const bbStart = bb.start;
          if (!aStart || !bbStart) return 0;
          return aStart.toMillis() - bbStart.toMillis();
        });

      const usableParts = subtractIntervals(base, blocksToday);

      for (const p of usableParts) {
        const minutes = Math.floor(p.length('minutes'));
        if (minutes <= 0) continue;

        const pStart = p.start;
        if (!pStart) continue;

        if (remaining <= minutes) return pStart.plus({ minutes: remaining });

        remaining -= minutes;
      }

      cursor = wEnd;
    }

    cursor = day.plus({ days: 1 });
    cursor = snapToNextShiftTime(cursor, params.shifts);
  }

  throw new Error('Unable to schedule within 90 days (likely impossible due to maintenance + shifts).');
}
