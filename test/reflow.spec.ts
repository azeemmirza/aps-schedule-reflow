import 'jest';

import { DateTime } from 'luxon';
import { ReflowService } from '../src/reflow/reflow.service';
import { ConstraintChecker } from '../src/reflow/constraint-checker';
import { Logger } from '../src/utils/logger';
import type { ReflowInput } from '../src/types';

import case01 from '../data/case-delay-cascade.json';
import case02 from '../data/case-shift-boundary.json';
import case03 from '../data/case-maintenance-conflict.json';
import case04 from '../data/case-multi-parent-dependencies.json';
import case05 from '../data/case-weekend-shift.json';

describe('Production Schedule Reflow', () => {
  const logger = new Logger('debug'); // Use 'debug' to see logs during tests
  const checker = new ConstraintChecker(logger);


  // Case 1
  test('Case 1: delay cascade pushes downstream dependencies', () => {
    const svc = new ReflowService(logger);
    const res = svc.reflow(case01 as ReflowInput);

    checker.validate({ workOrders: res.updatedWorkOrders, workCenters: (case01 as ReflowInput).workCenters });

    /**
     * A Map that organizes updated work orders by their work order numbers.
     * Each entry in the Map has the work order number as the key and the corresponding
     * work order object as the value.
     */
    const byNum = new Map(res.updatedWorkOrders.map((w) => [w.data.workOrderNumber, w]));
    const woA = byNum.get('WO-A')!;
    const woB = byNum.get('WO-B')!;
    const woC = byNum.get('WO-C')!;

    const aEnd = DateTime.fromISO(woA.data.endDate, { zone: 'utc' });
    const bStart = DateTime.fromISO(woB.data.startDate, { zone: 'utc' });
    const bEnd = DateTime.fromISO(woB.data.endDate, { zone: 'utc' });
    const cStart = DateTime.fromISO(woC.data.startDate, { zone: 'utc' });

    expect(bStart.toMillis()).toBeGreaterThanOrEqual(aEnd.toMillis());
    expect(cStart.toMillis()).toBeGreaterThanOrEqual(bEnd.toMillis());

    // A duration is 240, starting 8:00 => should end 12:00 same day under 8-17 shift
    expect(woA.data.endDate).toBe('2026-02-09T12:00:00.000Z');
  });


  // CASE 2
  test('Case 2: shift boundary pauses and resumes next day', () => {
    const svc = new ReflowService(logger);
    const res = svc.reflow(case02 as ReflowInput);

    checker.validate({ workOrders: res.updatedWorkOrders, workCenters: (case02 as ReflowInput).workCenters });

    const wo = res.updatedWorkOrders[0]!;
    // Start at 16:00, duration 120:
    // 16:00-17:00 = 60, remaining 60 next day 08:00-09:00 => end next day 09:00
    expect(wo.data.startDate).toBe('2026-02-10T16:00:00.000Z');
    expect(wo.data.endDate).toBe('2026-02-11T09:00:00.000Z');
  });


  // CASE 3
  test('Case 3: maintenance window forces pushing work order beyond maintenance', () => {
    const svc = new ReflowService(logger);
    const res = svc.reflow(case03 as ReflowInput);

    checker.validate({ workOrders: res.updatedWorkOrders, workCenters: (case03 as ReflowInput).workCenters });

    /**
     * A Map that organizes updated work orders by their work order number.
     * Each entry in the Map has the work order number as the key and the corresponding
     * work order object as the value.
     *
     * @type {Map<string, typeof res.updatedWorkOrders[number]>}
     */
    const byNum = new Map(res.updatedWorkOrders.map((w) => [w.data.workOrderNumber, w]));
    const fixed = byNum.get('WO-FIXED-MAINT')!;
    const prod = byNum.get('WO-PROD-1')!;

    // fixed maintenance should not move
    expect(fixed.data.startDate).toBe('2026-02-11T08:00:00.000Z');
    expect(fixed.data.endDate).toBe('2026-02-11T09:00:00.000Z');

    // strict rule: WO cannot overlap maintenance window 10:00-12:00, so it should start at 12:00
    expect(prod.data.startDate).toBe('2026-02-11T12:00:00.000Z');
    // duration 180 => 12:00-15:00
    expect(prod.data.endDate).toBe('2026-02-11T15:00:00.000Z');
  });

  test('Cycle detection: throws error on circular dependency', () => {
    const svc = new ReflowService(logger);
    const bad = structuredClone(case01 as ReflowInput);

    // Make A depend on C -> cycle A->B->C->A
    /**
     * Finds and assigns the work order with the document ID 'wo-a' from the list of bad work orders.
     * 
     * @constant woA - The work order object with the specified document ID, or `undefined` if not found.
     */
    const woA = bad.workOrders.find((w) => w.docId === 'wo-a');
    if (woA) {
      woA.data.dependsOnWorkOrderIds = ['wo-c'];
    }

    expect(() => svc.reflow(bad)).toThrow(/Circular dependency detected/);
  });

  // CASE 4
  test('Case 4: multi-parent dependencies forces merge point to wait for all parents', () => {
    const svc = new ReflowService(logger);
    const res = svc.reflow(case04 as ReflowInput);

    checker.validate({ workOrders: res.updatedWorkOrders, workCenters: (case04 as ReflowInput).workCenters });

    const byNum = new Map(res.updatedWorkOrders.map((w) => [w.data.workOrderNumber, w]));
    const woD = byNum.get('WO-D')!;
    const woE = byNum.get('WO-E')!;
    const woF = byNum.get('WO-F')!;
    const woMerge = byNum.get('WO-MERGE')!;

    const dEnd = DateTime.fromISO(woD.data.endDate, { zone: 'utc' });
    const eEnd = DateTime.fromISO(woE.data.endDate, { zone: 'utc' });
    const fEnd = DateTime.fromISO(woF.data.endDate, { zone: 'utc' });
    const mergeStart = DateTime.fromISO(woMerge.data.startDate, { zone: 'utc' });

    // Merge must start after all three parents complete
    expect(mergeStart.toMillis()).toBeGreaterThanOrEqual(Math.max(dEnd.toMillis(), eEnd.toMillis(), fEnd.toMillis()));

    // All should complete on same day (single work center, no conflicts if scheduled correctly)
    expect(woMerge.data.endDate).toBe('2026-02-12T16:00:00.000Z');
  });

  // CASE 5
  test('Case 5: weekend shift boundary with different shift hours', () => {
    const svc = new ReflowService(logger);
    const res = svc.reflow(case05 as ReflowInput);

    checker.validate({ workOrders: res.updatedWorkOrders, workCenters: (case05 as ReflowInput).workCenters });

    const byNum = new Map(res.updatedWorkOrders.map((w) => [w.data.workOrderNumber, w]));
    const woPrep = byNum.get('WO-WEEKEND-PREP')!;
    const woMain = byNum.get('WO-WEEKEND-MAIN')!;

    // WO-WEEKEND-PREP: 180 min starting Sat 11:00
    // Sat 11:00-13:00 = 2 hours = 120 min (Sat shift is 09:00-13:00)
    // Sun 10:00-12:00 = 2 hours = 120 min, but only need 60 more min => 10:00-11:00
    // Total: Sat 120 + Sun 60 = 180 min
    expect(woPrep.data.startDate).toBe('2026-02-14T11:00:00.000Z');
    expect(woPrep.data.endDate).toBe('2026-02-15T11:00:00.000Z');

    // WO-WEEKEND-MAIN depends on WO-WEEKEND-PREP, starts after prep ends (Sun 11:00)
    // Sun 11:00-14:00 = 3 hours = 180 min available, only need 120 min => 11:00-13:00
    const prepEnd = DateTime.fromISO(woPrep.data.endDate, { zone: 'utc' });
    const mainStart = DateTime.fromISO(woMain.data.startDate, { zone: 'utc' });
    expect(mainStart.toMillis()).toBeGreaterThanOrEqual(prepEnd.toMillis());
    expect(woMain.data.endDate).toBe('2026-02-15T13:00:00.000Z');
  });
});
