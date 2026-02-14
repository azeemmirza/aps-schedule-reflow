import 'jest';

import { ValidationError, validateReflowInput } from '../src/utils/validation';
import type { ReflowInput } from '../src/types';

import scenario1 from '../data/scenario1.delay-cascade.json';
import scenario2 from '../data/scenario2.shift-boundary.json';
import scenario3 from '../data/scenario3.maintenance-conflict.json';


describe('Custom Validator', () => {
    test('validateReflowInput accepts valid input', () => {
      expect(() => validateReflowInput(scenario1 as ReflowInput)).not.toThrow();
      expect(() => validateReflowInput(scenario2 as ReflowInput)).not.toThrow();
      expect(() => validateReflowInput(scenario3 as ReflowInput)).not.toThrow();
    });

    test('validateReflowInput rejects non-object input', () => {
      expect(() => validateReflowInput(null)).toThrow(ValidationError);
      expect(() => validateReflowInput('string')).toThrow(ValidationError);
      expect(() => validateReflowInput(123)).toThrow(ValidationError);
    });

    test('validateReflowInput rejects missing workOrders array', () => {
      expect(() => validateReflowInput({ workCenters: [] } as unknown)).toThrow(ValidationError);
    });

    test('validateReflowInput rejects missing workCenters array', () => {
      expect(() => validateReflowInput({ workOrders: [] } as unknown)).toThrow(ValidationError);
    });

    test('validateReflowInput rejects invalid work order fields', () => {
      const invalid = structuredClone(scenario1 as ReflowInput);
      invalid.workOrders[0]!.data.durationMinutes = -5;
      expect(() => validateReflowInput(invalid)).toThrow(ValidationError);
    });

    test('validateReflowInput rejects invalid shift dayOfWeek', () => {
      const invalid = structuredClone(scenario1 as ReflowInput);
      (invalid.workCenters[0]!.data.shifts[0] as unknown as { dayOfWeek: number }).dayOfWeek = 7;
      expect(() => validateReflowInput(invalid)).toThrow(ValidationError);
    });
  });