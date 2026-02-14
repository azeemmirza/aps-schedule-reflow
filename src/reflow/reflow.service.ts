import { DateTime } from 'luxon';
import type { ReflowInput, ReflowResult, WorkCenterDoc, WorkOrderDoc, Change } from '../types';
import { topoSortOrThrow } from './dag';
import type { Reservation } from '../utils/interval';
import { mergeReservations, firstOverlap } from '../utils/interval';
import { calculateEndDateWithShiftsAndMaintenance, snapToNextShiftTime } from '../utils/date';
import { formatReason } from '../utils/format-reason';
import { Logger } from '../utils/logger';
import { validateReflowInput } from '../utils/validation';

type Scheduled = { start: DateTime; end: DateTime };

/**
 * Core reflow engine that reschedules work xorders while respecting constraints.
 *
 * Implements a greedy, earliest-feasible scheduling algorithm that:
 * 1. Validates inputs (custom runtime validator)
 * 2. Builds a dependency DAG and topologically sorts
 * 3. Per work center, reserves time for maintenance windows and immovable work orders
 * 4. Schedules each work order in topo order, finding the earliest feasible window
 * 5. Respects shift boundaries (working minutes only) and maintenance blocks
 *
 * @example
 * ```typescript
 * const service = new ReflowService(new Logger('info'));
 * const result = service.reflow(input);
 * console.log(`Updated ${result.changes.length} work orders`);
 * ```
 */
export class ReflowService {
  /**
   * @param logger - Optional logger for debugging
   */
  constructor(private readonly logger: Logger = new Logger('debug')) {}

  /**
   * Reflow work orders under disruptions while respecting all constraints.
   *
   * Produces an updated schedule that respects dependencies, work center conflicts,
   * shift boundaries, and maintenance windows. Maintenance work orders are immovable.
   *
   * @param input - Reflow input containing work orders, work centers, and optionally manufacturing orders
   * @returns Updated work orders, change records, and explanation of the reflow strategy
   * @throws Error if input validation fails, circular dependency detected, or scheduling is impossible
   *
   * @example
   * ```typescript
   * const result = service.reflow({
   *   workOrders: [...],
   *   workCenters: [...],
   * });
   *
   * result.changes.forEach(change => {
   *   console.log(`${change.workOrderNumber}: ${change.deltaMinutesStart} min delay`);
   * });
   * ```
   */
  reflow(input: ReflowInput): ReflowResult {
    this.logger.info('Reflow started', {
      workOrders: input.workOrders.length,
      workCenters: input.workCenters.length,
      manufacturingOrders: input.manufacturingOrders?.length ?? 0,
    });

    // Runtime validation (production hygiene)
    validateReflowInput(input);
    this.logger.debug('Input validation passed');

    const workOrders: WorkOrderDoc[] = input.workOrders.map((w) => structuredClone(w));
    const wcById = new Map<string, WorkCenterDoc>(input.workCenters.map((wc) => [wc.docId, wc]));
    const woById = new Map<string, WorkOrderDoc>(workOrders.map((wo) => [wo.docId, wo]));

    // Dependency edges: parent -> child
    const nodes = workOrders.map((w) => w.docId);
    const edges: Array<[string, string]> = [];
    for (const w of workOrders) {
      for (const p of w.data.dependsOnWorkOrderIds ?? []) edges.push([p, w.docId]);
    }

    this.logger.debug('Dependency graph', { nodes: nodes.length, edges: edges.length });
    const topo = topoSortOrThrow(nodes, edges);
    this.logger.debug('Topological sort completed');

    // Per work center: merged reservations (maintenance windows + fixed maintenance WOs + scheduled WOs)
    const reservationsByWc = new Map<string, Reservation[]>();
    for (const wc of input.workCenters) {
      const rs: Reservation[] = [];

      // maintenance windows
      for (const mw of wc.data.maintenanceWindows) {
        rs.push({
          start: DateTime.fromISO(mw.startDate, { zone: 'utc' }),
          end: DateTime.fromISO(mw.endDate, { zone: 'utc' }),
          kind: 'maintenanceWindow',
          meta: { reason: mw.reason },
        });
      }

      // immovable maintenance WOs reserve time too
      for (const wo of workOrders) {
        if (wo.data.workCenterId !== wc.docId) continue;
        if (!wo.data.isMaintenance) continue;

        rs.push({
          start: DateTime.fromISO(wo.data.startDate, { zone: 'utc' }),
          end: DateTime.fromISO(wo.data.endDate, { zone: 'utc' }),
          kind: 'fixedMaintenanceWO',
          refId: wo.docId,
          meta: { workOrderNumber: wo.data.workOrderNumber },
        });
      }

      reservationsByWc.set(wc.docId, mergeReservations(rs));
      this.logger.debug(`Work center ${wc.data.name} initialized`, {
        maintenanceWindows: wc.data.maintenanceWindows.length,
        fixedMaintenanceWOs: rs.filter((r) => r.kind === 'fixedMaintenanceWO').length,
        mergedReservations: reservationsByWc.get(wc.docId)?.length ?? 0,
      });
    }

    // Scheduled map for dependency readiness
    const scheduled = new Map<string, Scheduled>();

    // Seed fixed maintenance schedules
    for (const wo of workOrders) {
      if (!wo.data.isMaintenance) continue;
      scheduled.set(wo.docId, {
        start: DateTime.fromISO(wo.data.startDate, { zone: 'utc' }),
        end: DateTime.fromISO(wo.data.endDate, { zone: 'utc' }),
      });
    }

    const changes: Change[] = [];
    const explanation: string[] = [];

    for (const woId of topo) {
      const wo = woById.get(woId);
      if (!wo) continue;

      if (wo.data.isMaintenance) {
        // immovable
        this.logger.debug(`Skipping immovable maintenance work order`, { woNumber: wo.data.workOrderNumber });
        continue;
      }

      const wc = wcById.get(wo.data.workCenterId);
      if (!wc) throw new Error(`Work center not found: ${wo.data.workCenterId}`);

      const originalStart = DateTime.fromISO(wo.data.startDate, { zone: 'utc' });
      const originalEnd = DateTime.fromISO(wo.data.endDate, { zone: 'utc' });

      this.logger.debug(`Processing work order`, {
        woNumber: wo.data.workOrderNumber,
        workCenter: wc.data.name,
        originalStart: originalStart.toISO(),
        durationMinutes: wo.data.durationMinutes,
        dependencies: wo.data.dependsOnWorkOrderIds?.length ?? 0,
      });

      // earliest start is max(originalStart, parentsEnd)
      const reasons: string[] = [];
      let earliest = originalStart;

      for (const parentId of wo.data.dependsOnWorkOrderIds ?? []) {
        const p = scheduled.get(parentId);
        if (!p) throw new Error(`Dependency schedule missing: parent ${parentId} for ${wo.data.workOrderNumber}`);
        if (p.end > earliest) {
          earliest = p.end;
          const parentWo = woById.get(parentId);
          this.logger.debug(`Dependency constraint applied`, {
            child: wo.data.workOrderNumber,
            parent: parentWo?.data.workOrderNumber,
            parentEndsAt: p.end.toISO(),
          });
        }
      }

      if (earliest > originalStart) {
        reasons.push(`Dependency ready at ${earliest.toISO()}`);
      }

      // find feasible window for this WO on WC under reservations
      const feasible = this.findFeasibleStart({
        wc,
        wo,
        earliest,
        reservations: reservationsByWc.get(wc.docId) ?? [],
      });
      this.logger.debug(`Feasible start found`, { woNumber: wo.data.workOrderNumber, feasibleStart: feasible.toISO() });

      const end = calculateEndDateWithShiftsAndMaintenance({
        start: feasible,
        durationMinutes: wo.data.durationMinutes,
        shifts: wc.data.shifts,
        maintenanceBlocks: reservationsByWc.get(wc.docId) ?? [],
      });
      this.logger.debug(`End time calculated`, { woNumber: wo.data.workOrderNumber, endTime: end.toISO() });

      // Strict model: interval [start,end) must not overlap reservations
      // If it does (future window), we retry by pushing start to overlap end.
      const final = this.resolveOverlapsByPushing({
        wc,
        wo,
        start: feasible,
        end,
        reservations: reservationsByWc.get(wc.docId) ?? [],
      });
      this.logger.debug(`Overlaps resolved`, {
        woNumber: wo.data.workOrderNumber,
        finalStart: final.start.toISO(),
        finalEnd: final.end.toISO(),
      });

      // reserve scheduled interval
      const newRes: Reservation = {
        start: final.start,
        end: final.end,
        kind: 'scheduledWO',
        refId: wo.docId,
        meta: { workOrderNumber: wo.data.workOrderNumber },
      };

      reservationsByWc.set(wc.docId, mergeReservations([...(reservationsByWc.get(wc.docId) ?? []), newRes]));
      scheduled.set(wo.docId, { start: final.start, end: final.end });

      // write back
      wo.data.startDate = final.start.toUTC().toISO()!;
      wo.data.endDate = final.end.toUTC().toISO()!;

      // compute deltas
      const deltaStart = Math.round((final.start.toMillis() - originalStart.toMillis()) / 60000);
      const deltaEnd = Math.round((final.end.toMillis() - originalEnd.toMillis()) / 60000);

      const reason = formatReason(reasons);

      if (deltaStart !== 0 || deltaEnd !== 0) {
        changes.push({
          workOrderId: wo.docId,
          workOrderNumber: wo.data.workOrderNumber,
          workCenterId: wo.data.workCenterId,
          originalStart: originalStart.toISO()!,
          originalEnd: originalEnd.toISO()!,
          newStart: final.start.toISO()!,
          newEnd: final.end.toISO()!,
          deltaMinutesStart: deltaStart,
          deltaMinutesEnd: deltaEnd,
          reason: reason.length ? reason : ['Reflow adjustment'],
        });
        this.logger.info(`Work order rescheduled`, {
          woNumber: wo.data.workOrderNumber,
          workCenter: wc.data.name,
          deltaMinutesStart: deltaStart,
          deltaMinutesEnd: deltaEnd,
          reason: reason.join('; '),
        });
      }
    }

    explanation.push(
      `Reflow complete. Updated ${changes.length} work orders.`,
      'Strategy: topo-sort dependencies + earliest-feasible scheduling per work center with shift + maintenance calendars.',
    );

    this.logger.info('Reflow completed', {
      totalChanges: changes.length,
      totalWorkOrders: workOrders.length,
      totalDelay: changes.reduce((sum, c) => sum + c.deltaMinutesStart, 0),
    });

    return { updatedWorkOrders: workOrders, changes, explanation };
  }

  /**
   * Find the earliest feasible start time for a work order on its work center.
   *
   * Snaps to the next shift window and iterates forward until finding a slot that
   * doesn't overlap with maintenance windows or existing reservations.
   *
   * @param params - Search parameters including work center, work order, earliest time, and existing reservations
   * @returns The earliest DateTime that avoids all reservations and respects shift windows
   * @throws Error if no feasible start is found within 500 iterations (guard exceeded)
   *
   * @internal
   */
  private findFeasibleStart(params: {
    wc: WorkCenterDoc;
    wo: WorkOrderDoc;
    earliest: DateTime;
    reservations: Reservation[];
  }): DateTime {
    // start must be within shift time
    let cursor = snapToNextShiftTime(params.earliest, params.wc.data.shifts);
    this.logger.debug(`Feasible start search initiated`, {
      woNumber: params.wo.data.workOrderNumber,
      earliest: params.earliest.toISO(),
      cursorAfterSnap: cursor.toISO(),
    });

    // push forward if cursor is inside a reservation
    for (let guard = 0; guard < 500; guard++) {
      const inside = params.reservations.find((r) => cursor >= r.start && cursor < r.end);
      if (inside) {
        this.logger.debug(`Feasible start search: cursor inside reservation`, {
          woNumber: params.wo.data.workOrderNumber,
          reservationKind: inside.kind,
          reservationEnd: inside.end.toISO(),
        });
        cursor = snapToNextShiftTime(inside.end, params.wc.data.shifts);
        continue;
      }
      this.logger.debug(`Feasible start found after ${guard} iterations`, {
        woNumber: params.wo.data.workOrderNumber,
        feasibleStart: cursor.toISO(),
      });
      return cursor;
    }

    throw new Error(`Unable to find feasible start for ${params.wo.data.workOrderNumber} (guard exceeded).`);
  }

  /**
   * Resolve overlaps by iteratively pushing start times forward.
   *
   * After computing an end time, checks if the interval [start, end) overlaps any reservation.
   * If it does, moves the start to the end of the overlapping block and recomputes the end time.
   * Repeats until no overlaps remain.
   *
   * @param params - Interval parameters and existing reservations
   * @returns A final [start, end) interval with no overlaps
   * @throws Error if unable to resolve within 500 iterations (guard exceeded)
   *
   * @internal
   */
  private resolveOverlapsByPushing(params: {
    wc: WorkCenterDoc;
    wo: WorkOrderDoc;
    start: DateTime;
    end: DateTime;
    reservations: Reservation[];
  }): { start: DateTime; end: DateTime } {
    let start = params.start;
    let end = params.end;

    this.logger.debug(`Overlap resolution initiated`, {
      woNumber: params.wo.data.workOrderNumber,
      initialStart: start.toISO(),
      initialEnd: end.toISO(),
      reservationCount: params.reservations.length,
    });

    for (let guard = 0; guard < 500; guard++) {
      const overlap = firstOverlap(params.reservations, start, end);
      if (!overlap) {
        this.logger.debug(`No overlaps found after ${guard} iterations`, {
          woNumber: params.wo.data.workOrderNumber,
          finalStart: start.toISO(),
          finalEnd: end.toISO(),
        });
        return { start, end };
      }

      this.logger.debug(`Overlap detected, pushing forward`, {
        woNumber: params.wo.data.workOrderNumber,
        overlapKind: overlap.kind,
        overlapEnd: overlap.end.toISO(),
        iteration: guard,
      });

      // push start to end of the overlapping block (strict no-overlap)
      start = snapToNextShiftTime(overlap.end, params.wc.data.shifts);

      end = calculateEndDateWithShiftsAndMaintenance({
        start,
        durationMinutes: params.wo.data.durationMinutes,
        shifts: params.wc.data.shifts,
        maintenanceBlocks: params.reservations,
      });
    }

    throw new Error(
      `Unable to schedule ${params.wo.data.workOrderNumber} without overlaps (guard exceeded).`,
    );
  }
}
