import type { ReflowInput } from '../../../neologic/src/types';

/**
 * Custom validation error thrown when input validation fails.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(`Validation Error: ${message}`);
    this.name = 'ValidationError';
  }
}

/**
 * Validates a string is non-empty.
 */
function validateString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

/**
 * Validates a number is a positive integer.
 */
function validatePositiveInt(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${fieldName} must be a positive integer`);
  }
  return value;
}

/**
 * Validates a number is an integer between min and max (inclusive).
 */
function validateIntRange(value: unknown, fieldName: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${fieldName} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * Validates a value is a boolean.
 */
function validateBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${fieldName} must be a boolean`);
  }
  return value;
}

/**
 * Validates a value is an array.
 */
function validateArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an array`);
  }
  return value;
}

/**
 * Validates a value matches one of the allowed literal values.
 */
function validateLiteral<T>(value: unknown, fieldName: string, allowed: T[]): T {
  if (!allowed.includes(value as T)) {
    throw new ValidationError(`${fieldName} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

/**
 * Validates a single work order.
 */
function validateWorkOrder(wo: unknown): void {
  if (typeof wo !== 'object' || wo === null) {
    throw new ValidationError('Work order must be an object');
  }

  const obj = wo as Record<string, unknown>;

  validateString(obj.docId, 'Work order docId');
  validateLiteral(obj.docType, 'Work order docType', ['workOrder']);

  if (typeof obj.data !== 'object' || obj.data === null) {
    throw new ValidationError('Work order data must be an object');
  }

  const data = obj.data as Record<string, unknown>;

  validateString(data.workOrderNumber, 'Work order number');
  validateString(data.manufacturingOrderId, 'Manufacturing order ID');
  validateString(data.workCenterId, 'Work center ID');
  validateString(data.startDate, 'Start date');
  validateString(data.endDate, 'End date');
  validatePositiveInt(data.durationMinutes, 'Duration minutes');
  validateBoolean(data.isMaintenance, 'Is maintenance');

  const deps = data.dependsOnWorkOrderIds;
  if (deps !== undefined) {
    const arr = validateArray(deps, 'Depends on work order IDs');
    for (const dep of arr) {
      validateString(dep, 'Dependency work order ID');
    }
  }
}

/**
 * Validates a single work center.
 */
function validateWorkCenter(wc: unknown): void {
  if (typeof wc !== 'object' || wc === null) {
    throw new ValidationError('Work center must be an object');
  }

  const obj = wc as Record<string, unknown>;

  validateString(obj.docId, 'Work center docId');
  validateLiteral(obj.docType, 'Work center docType', ['workCenter']);

  if (typeof obj.data !== 'object' || obj.data === null) {
    throw new ValidationError('Work center data must be an object');
  }

  const data = obj.data as Record<string, unknown>;

  validateString(data.name, 'Work center name');

  const shifts = validateArray(data.shifts, 'Shifts');
  for (const shift of shifts) {
    if (typeof shift !== 'object' || shift === null) {
      throw new ValidationError('Shift must be an object');
    }
    const s = shift as Record<string, unknown>;
    validateIntRange(s.dayOfWeek, 'Day of week', 0, 6);
    validateIntRange(s.startHour, 'Start hour', 0, 23);
    validateIntRange(s.endHour, 'End hour', 0, 23);
  }

  const maintenanceWindows = validateArray(data.maintenanceWindows, 'Maintenance windows');
  for (const mw of maintenanceWindows) {
    if (typeof mw !== 'object' || mw === null) {
      throw new ValidationError('Maintenance window must be an object');
    }
    const m = mw as Record<string, unknown>;
    validateString(m.startDate, 'Maintenance window start date');
    validateString(m.endDate, 'Maintenance window end date');
    if (m.reason !== undefined) {
      validateString(m.reason, 'Maintenance window reason');
    }
  }
}

/**
 * Validates a single manufacturing order.
 */
function validateManufacturingOrder(mo: unknown): void {
  if (typeof mo !== 'object' || mo === null) {
    throw new ValidationError('Manufacturing order must be an object');
  }

  const obj = mo as Record<string, unknown>;

  validateString(obj.docId, 'Manufacturing order docId');
  validateLiteral(obj.docType, 'Manufacturing order docType', ['manufacturingOrder']);

  if (typeof obj.data !== 'object' || obj.data === null) {
    throw new ValidationError('Manufacturing order data must be an object');
  }

  const data = obj.data as Record<string, unknown>;

  validateString(data.manufacturingOrderNumber, 'Manufacturing order number');
  validateString(data.itemId, 'Item ID');
  validatePositiveInt(data.quantity, 'Quantity');
  validateString(data.dueDate, 'Due date');
}

/**
 * Validates the entire reflow input.
 * Throws ValidationError if any constraint is violated.
 *
 * @param input - The input to validate
 * @throws ValidationError if validation fails
 *
 * @example
 * ```typescript
 * try {
 *   validateReflowInput(input);
 * } catch (err) {
 *   if (err instanceof ValidationError) {
 *     console.error(err.message);
 *   }
 * }
 * ```
 */
export function validateReflowInput(input: unknown): input is ReflowInput {
  if (typeof input !== 'object' || input === null) {
    throw new ValidationError('Input must be an object');
  }

  const obj = input as Record<string, unknown>;

  // Validate workOrders array
  const workOrders = validateArray(obj.workOrders, 'Work orders');
  for (const wo of workOrders) {
    validateWorkOrder(wo);
  }

  // Validate workCenters array
  const workCenters = validateArray(obj.workCenters, 'Work centers');
  for (const wc of workCenters) {
    validateWorkCenter(wc);
  }

  // Validate manufacturingOrders array (optional)
  if (obj.manufacturingOrders !== undefined) {
    const manufacturingOrders = validateArray(obj.manufacturingOrders, 'Manufacturing orders');
    for (const mo of manufacturingOrders) {
      validateManufacturingOrder(mo);
    }
  }

  return true;
}
