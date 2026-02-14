import type { WorkOrderDoc } from './work-order';
import type { Change } from './change';

/**
 * Output of the reflow algorithm with updated schedule and changes.
 */
export type ReflowResult = {
  updatedWorkOrders: WorkOrderDoc[];
  changes: Change[];
  explanation: string[];
};
