import type { Doc } from './doc';

/**
 * Work order document representing a production task.
 */
export type WorkOrderDoc = Doc<
  'workOrder',
  {
    workOrderNumber: string;
    manufacturingOrderId: string;
    workCenterId: string;

    startDate: string; // UTC ISO
    endDate: string; // UTC ISO
    durationMinutes: number;

    isMaintenance: boolean;
    dependsOnWorkOrderIds: string[];
  }
>;
