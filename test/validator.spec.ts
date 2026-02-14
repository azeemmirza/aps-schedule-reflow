import 'jest';

import { ValidationError, validateReflowInput } from '../src/utils/validation';
import type { ReflowInput } from '../src/types';

import case01 from '../data/case-delay-cascade.json';
import case02 from '../data/case-shift-boundary.json';
import case03 from '../data/case-maintenance-conflict.json';


describe('Custom Validator', () => {
    test('validateReflowInput accepts valid input', () => {
      expect(() => validateReflowInput(case01 as ReflowInput)).not.toThrow();
      expect(() => validateReflowInput(case02 as ReflowInput)).not.toThrow();
      expect(() => validateReflowInput(case03 as ReflowInput)).not.toThrow();
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
      const invalid = structuredClone(case01 as ReflowInput);
      invalid.workOrders[0]!.data.durationMinutes = -5;
      expect(() => validateReflowInput(invalid)).toThrow(ValidationError);
    });

    test('validateReflowInput rejects invalid shift dayOfWeek', () => {
      const invalid = structuredClone(case01 as ReflowInput);
      (invalid.workCenters[0]!.data.shifts[0] as unknown as { dayOfWeek: number }).dayOfWeek = 7;
      expect(() => validateReflowInput(invalid)).toThrow(ValidationError);
    });

    test('Validation error: throws error on invalid input', () => {
    /**
     * Represents an invalid input scenario for testing purposes.
     * This object is created by spreading the properties of `scenario1`
     * and overriding the `workOrders` property with an array containing
     * an incorrectly structured work order object.
     * It is used to simulate a case where the work order structure is invalid.
     */
    const invalidInput = {
      ...case01,
      workOrders: [
        { invalidKey: 'invalidValue' },
      ],
    };

    expect(() => validateReflowInput(invalidInput)).toThrow(ValidationError);
  });
  });