import type { WorkOrderDoc } from './work-order';
import type { WorkCenterDoc } from './work-center';
import type { ManufacturingOrderDoc } from './manufacturing-order';

/**
 * Input payload for the reflow algorithm.
 */
export type ReflowInput = {
  workOrders: WorkOrderDoc[];
  workCenters: WorkCenterDoc[];
  manufacturingOrders?: ManufacturingOrderDoc[];
};
