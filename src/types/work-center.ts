import type { Doc } from './doc';

/**
 * Work center document defining machine/resource with shifts and maintenance windows.
 */
export type WorkCenterDoc = Doc<
  'workCenter',
  {
    name: string;
    shifts: Array<{
      dayOfWeek: number; // 0-6, Sunday=0
      startHour: number; // 0-23
      endHour: number; // 0-23
    }>;
    maintenanceWindows: Array<{
      startDate: string; // UTC ISO
      endDate: string; // UTC ISO
      reason?: string;
    }>;
  }
>;
