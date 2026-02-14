/** 
 * Record of a single work order schedule change.
 * */
export type Change = {
  workOrderId: string;
  workOrderNumber: string;
  workCenterId: string;
  originalStart: string;
  originalEnd: string;
  newStart: string;
  newEnd: string;
  deltaMinutesStart: number;
  deltaMinutesEnd: number;
  reason: string[];
};
