import { describe, expect, it } from 'vitest';
import { quantityUnits, quantityValue } from '../src/simulation/infrastructure/quantity';

describe('explicit configuration decimal separators', () => {
  it.each([
    ['1.5', '1,5'],
    ['.25', ',25'],
    ['2.5e3', '2,5e3'],
    ['1.', '1,'],
  ])('converts %s and %s identically to canonical numbers', (dot, comma) => {
    const value = quantityValue(dot, quantityUnits.memory[1]);
    expect(quantityValue(comma, quantityUnits.memory[1])).toBe(value);
    expect(typeof value).toBe('number');
    expect(JSON.parse(JSON.stringify(value))).toBe(value);
  });
  it.each(['1,234.5', '1,2,3', '1.2.3', '1 234,5', '0x10'])(
    'rejects grouping/mixed syntax %s',
    (text) => {
      expect(() => quantityValue(text, quantityUnits.power[0])).toThrow(
        'without thousands separators',
      );
    },
  );
  it('applies the same canonical bounds after either decimal notation', () => {
    expect(quantityValue(' 1,5 ', quantityUnits.power[0], 0, 2)).toBe(1.5);
    expect(() => quantityValue('2,5', quantityUnits.power[0], 0, 2)).toThrow('from 0 to 2');
    expect(() => quantityValue('-1,5', quantityUnits.power[0], 0, 2)).toThrow('from 0 to 2');
  });
});
