import type { Doc } from './doc';

/** Manufacturing order document defining the production order. */
export type ManufacturingOrderDoc = Doc<
  'manufacturingOrder',
  {
    manufacturingOrderNumber: string;
    itemId: string;
    quantity: number;
    dueDate: string;
  }
>;
