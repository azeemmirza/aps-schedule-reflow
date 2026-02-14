import { ReflowService } from './reflow/reflow.service';
import { ConstraintChecker } from './reflow/constraint-checker';
import { Logger } from './utils/logger';
import type { ReflowInput } from './types';

import scenario1 from '../data/scenario1.delay-cascade.json';
import scenario2 from '../data/scenario2.shift-boundary.json';
import scenario3 from '../data/scenario3.maintenance-conflict.json';

const logger = new Logger('debug');

function runScenario(name: string, input: ReflowInput): void {
  logger.info(`\n=== ${name} ===`);

  const svc = new ReflowService(new Logger('debug'));
  const result = svc.reflow(input);

  logger.info(`Explanation: ${result.explanation}`);

  logger.table(
    result.changes.map((c) => ({
      wo: c.workOrderNumber,
      wc: c.workCenterId,
      deltaStartMin: c.deltaMinutesStart,
      deltaEndMin: c.deltaMinutesEnd,
      reason: c.reason.join(' | '),
    })),
  );

  const checker = new ConstraintChecker();
  checker.validate({ workOrders: result.updatedWorkOrders, workCenters: input.workCenters });

  console.log('Constraints validated');
}

runScenario('Scenario 1 - Delay Cascade', scenario1 as ReflowInput);
runScenario('Scenario 2 - Shift Boundary', scenario2 as ReflowInput);
runScenario('Scenario 3 - Maintenance Conflict', scenario3 as ReflowInput);
