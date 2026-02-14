import 'jest';

import { DateTime } from 'luxon';
import { ReflowService } from '../src/reflow/reflow.service';
import { ConstraintChecker } from '../src/reflow/constraint-checker';
import { ValidationError, validateReflowInput } from '../src/utils/validation';
import { Logger } from '../src/utils/logger';
import type { ReflowInput } from '../src/types';

import scenario1 from '../data/scenario1.delay-cascade.json';
import scenario2 from '../data/scenario2.shift-boundary.json';
import scenario3 from '../data/scenario3.maintenance-conflict.json';

describe('Production Schedule Reflow', () => {
  const logger = new Logger('silent'); // Use 'debug' to see logs during tests
  const checker = new ConstraintChecker(logger);

  
  // SCENARIO 1
  test('Scenario1: delay cascade pushes downstream dependencies', () => {
    const svc = new ReflowService(logger);
    const res = svc.reflow(scenario1 as ReflowInput);

    checker.validate({ workOrders: res.updatedWorkOrders, workCenters: (scenario1 as ReflowInput).workCenters });

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


  // SCENARIO 2
  test('Scenario2: shift boundary pauses and resumes next day', () => {
    const svc = new ReflowService(logger);
    const res = svc.reflow(scenario2 as ReflowInput);

    checker.validate({ workOrders: res.updatedWorkOrders, workCenters: (scenario2 as ReflowInput).workCenters });

    const wo = res.updatedWorkOrders[0]!;
    // Start at 16:00, duration 120:
    // 16:00-17:00 = 60, remaining 60 next day 08:00-09:00 => end next day 09:00
    expect(wo.data.startDate).toBe('2026-02-10T16:00:00.000Z');
    expect(wo.data.endDate).toBe('2026-02-11T09:00:00.000Z');
  });


  // SCENARIO 3
  test('Scenario3: maintenance window forces pushing work order beyond maintenance', () => {
    const svc = new ReflowService(logger);
    const res = svc.reflow(scenario3 as ReflowInput);

    checker.validate({ workOrders: res.updatedWorkOrders, workCenters: (scenario3 as ReflowInput).workCenters });

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
    const bad = structuredClone(scenario1 as ReflowInput);

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

  test('Validation error: throws error on invalid input', () => {
    /**
     * Represents an invalid input scenario for testing purposes.
     * This object is created by spreading the properties of `scenario1`
     * and overriding the `workOrders` property with an empty array.
     * It is used to simulate a case where no work orders are provided.
     */
    const invalidInput = { ...scenario1, workOrders: [] };

    expect(() => validateReflowInput(invalidInput)).toThrow(ValidationError);
  });
});
