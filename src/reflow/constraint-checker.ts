import { DateTime } from 'luxon';
import type { WorkCenterDoc, WorkOrderDoc } from '../types';
import { asInterval } from '../utils/interval';
import { shiftWindowsForDay } from '../utils/date';
import { Logger } from '../utils/logger';

export class ConstraintChecker {
  constructor(private readonly logger: Logger = new Logger('silent')) {}

  validate(params: { workOrders: WorkOrderDoc[]; workCenters: WorkCenterDoc[] }): void {
    this.logger.info('Constraint validation started', {
      workOrders: params.workOrders.length,
      workCenters: params.workCenters.length,
    });

    const wcById = new Map(params.workCenters.map((wc) => [wc.docId, wc] as const));
    const woById = new Map(params.workOrders.map((wo) => [wo.docId, wo] as const));

    // 1) Dependencies: parent end <= child start
    this.logger.debug('Validating dependencies');
    for (const wo of params.workOrders) {
      const childStart = DateTime.fromISO(wo.data.startDate, { zone: 'utc' });
      for (const parentId of wo.data.dependsOnWorkOrderIds ?? []) {
        const parent = woById.get(parentId);
        if (!parent) throw new Error(`Missing parent work order ${parentId}`);
        const parentEnd = DateTime.fromISO(parent.data.endDate, { zone: 'utc' });
        if (parentEnd > childStart) {
          throw new Error(
            `Dependency violated: parent ${parent.data.workOrderNumber} ends ${parentEnd.toISO()} after child ${wo.data.workOrderNumber} starts ${childStart.toISO()}`,
          );
        }
        this.logger.debug('Dependency validated', {
          parent: parent.data.workOrderNumber,
          child: wo.data.workOrderNumber,
          parentEndsAt: parentEnd.toISO(),
          childStartsAt: childStart.toISO(),
        });
      }
    }
    this.logger.debug('All dependencies valid');

    // 2) Work center overlaps: no two work orders overlap on same WC
    this.logger.debug('Validating work center conflicts');
    const byWc = new Map<string, WorkOrderDoc[]>();
    for (const wo of params.workOrders) {
      const arr = byWc.get(wo.data.workCenterId) ?? [];
      arr.push(wo);
      byWc.set(wo.data.workCenterId, arr);
    }

    for (const [wcId, list] of byWc.entries()) {
      const wc = wcById.get(wcId)!;
      this.logger.debug(`Checking work center ${wc.data.name}`, { workOrderCount: list.length });
      const sorted = [...list].sort((a, b) => a.data.startDate.localeCompare(b.data.startDate));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const curr = sorted[i]!;
        const prevInt = asInterval(
          DateTime.fromISO(prev.data.startDate, { zone: 'utc' }),
          DateTime.fromISO(prev.data.endDate, { zone: 'utc' }),
        );
        const currInt = asInterval(
          DateTime.fromISO(curr.data.startDate, { zone: 'utc' }),
          DateTime.fromISO(curr.data.endDate, { zone: 'utc' }),
        );
        if (prevInt.overlaps(currInt)) {
          throw new Error(
            `Work center overlap on ${wcId}: ${prev.data.workOrderNumber} overlaps ${curr.data.workOrderNumber}`,
          );
        }
        this.logger.debug('Work orders sequential on work center', {
          workCenter: wc.data.name,
          first: prev.data.workOrderNumber,
          second: curr.data.workOrderNumber,
        });
      }
    }
    this.logger.debug('All work center constraints valid');

    // 3) Start must be within some shift window (sanity)
    this.logger.debug('Validating shift windows');
    for (const wo of params.workOrders) {
      const wc = wcById.get(wo.data.workCenterId);
      if (!wc) throw new Error(`Missing work center ${wo.data.workCenterId}`);

      const start = DateTime.fromISO(wo.data.startDate, { zone: 'utc' });
      const day = start.startOf('day');
      const windows = shiftWindowsForDay(day, wc.data.shifts);

      const within = windows.some((w) => {
        const wStart = w.start;
        const wEnd = w.end;
        if (!wStart || !wEnd) return false;
        return start >= wStart && start < wEnd;
      });
      if (!within) {
        throw new Error(
          `Shift violation: ${wo.data.workOrderNumber} starts outside shift on ${wc.data.name}`,
        );
      }
      this.logger.debug('Work order starts within shift', {
        woNumber: wo.data.workOrderNumber,
        workCenter: wc.data.name,
        startTime: start.toISO(),
      });
    }
    this.logger.debug('All shift constraints valid');

    // 4) Maintenance windows must not overlap scheduled work orders (strict occupancy model)
    this.logger.debug('Validating maintenance window conflicts');
    for (const wo of params.workOrders) {
      const wc = wcById.get(wo.data.workCenterId)!;
      const woInt = asInterval(
        DateTime.fromISO(wo.data.startDate, { zone: 'utc' }),
        DateTime.fromISO(wo.data.endDate, { zone: 'utc' }),
      );

      for (const mw of wc.data.maintenanceWindows) {
        const mwInt = asInterval(
          DateTime.fromISO(mw.startDate, { zone: 'utc' }),
          DateTime.fromISO(mw.endDate, { zone: 'utc' }),
        );
        if (woInt.overlaps(mwInt)) {
          throw new Error(
            `Maintenance window overlap: ${wo.data.workOrderNumber} overlaps maintenance on ${wc.data.name}`,
          );
        }
        this.logger.debug('Work order clear of maintenance window', {
          woNumber: wo.data.workOrderNumber,
          workCenter: wc.data.name,
          maintenanceReason: mw.reason,
        });
      }
    }
    this.logger.debug('All maintenance constraints valid');

    this.logger.info('Constraint validation passed', {
      totalWorkOrders: params.workOrders.length,
    });
  }
}
