import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  previewImport,
  readImportTable,
  parseImportDate,
  parseImportNumber,
  analyticsCsvCell,
} from '../src/analytics/import';
import { executeAnalysis, querySeries } from '../src/analytics/engine';
import { blankAnalytics } from '../src/analytics/validation';
import type { ImportMapping, ImportSource } from '../src/analytics/types';
const mapping: ImportMapping = {
  format: 'wide',
  timeColumn: 'Date',
  valueColumns: [
    {
      column: 'Value',
      seriesId: 'value',
      name: 'Value',
      unit: { kind: 'count', label: 'customers' },
      semantics: 'snapshot',
      aggregation: 'last',
      direction: 'higher-is-better',
    },
  ],
  dimensions: [],
  decimal: '.',
  percent: 'ratio',
  dateFormat: 'iso',
  timezone: 'UTC',
  resolution: 'day',
  duplicatePolicy: 'reject',
  invalidRows: 'reject',
  missingValues: 'preserve',
};
const fixed = { now: () => '2026-10-01T00:00:00.000Z' };
function workbook(rows: string[], other: Record<string, Uint8Array> = {}) {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" r:id="sheet1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="sheet1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row>${rows.map((r, i) => `<row><c r="A${i + 2}" t="inlineStr"><is><t>2024-01-0${i + 1}</t></is></c><c r="B${i + 2}">${r}</c></row>`).join('')}</sheetData></worksheet>`,
    ),
    ...other,
  });
}
const preview = (source: ImportSource, m = mapping) =>
  previewImport(source, m, 'data', undefined, fixed);
describe('local analytics import AT02–AT05 and AT30', () => {
  it.each([0.023, 0.5])(
    'reports rate/exposure discrepancies while preserving the reported value %s',
    (reported) => {
      const result = preview(
        {
          kind: 'csv',
          name: 'rates.csv',
          text: `Date,Value,Lost,Opening\n2024-01-01,${reported},2,87`,
        },
        {
          ...mapping,
          numeratorColumn: 'Lost',
          denominatorColumn: 'Opening',
          valueColumns: [
            {
              ...mapping.valueColumns![0],
              unit: { kind: 'ratio', label: 'churn' },
              semantics: 'rate',
              aggregation: 'ratio',
              riskPopulation: 'opening-customers',
            },
          ],
        },
      );
      expect(result.valid).toBe(true);
      expect(result.dataset.observations[0].value).toBe(reported);
      expect(result.issues).toEqual([
        expect.objectContaining({
          severity: 'warning',
          row: 2,
          column: 'Value',
          message: expect.stringContaining('reported value is preserved'),
        }),
      ]);
      expect(result.dataset.transformations.join(' ')).toContain(
        'Review rate/exposure discrepancies before commit',
      );
      const extension = { ...blankAnalytics(), datasets: [result.dataset], series: result.series };
      expect(querySeries(extension, 'value', { resolution: 'day' })[0].value).toBe(2 / 87);
    },
  );
  it('CSV/XLSX/JSON normalize equivalent literal data', () => {
    const sources: ImportSource[] = [
      { kind: 'csv', name: 'same.csv', text: 'Date,Value\n2024-01-01,100\n2024-01-02,120' },
      {
        kind: 'json',
        name: 'same.json',
        text: '[{"Date":"2024-01-01","Value":100},{"Date":"2024-01-02","Value":120}]',
      },
      { kind: 'xlsx', name: 'same.xlsx', bytes: workbook(['<v>100</v>', '<v>120</v>']) },
    ];
    const observations = sources.map((s) => preview(s).dataset.observations);
    expect(observations[0]).toEqual(observations[1]);
    expect(observations[1]).toEqual(observations[2]);
  });
  it('explicit comma-decimal, percent and ratio conventions stay distinct', () => {
    const unit = { kind: 'ratio' as const, label: 'churn' };
    expect(parseImportNumber('2,4', ',', 'percent', unit)).toBe(0.024);
    expect(parseImportNumber('2%', '.', 'ratio', unit)).toBe(0.02);
    expect(parseImportNumber('.02', '.', 'ratio', unit)).toBe(0.02);
    expect(parseImportNumber('2', '.', 'ratio', unit)).toBe(2);
    expect(() => parseImportNumber('2,4', '.', 'percent', unit)).toThrow(/convention/);
  });
  it('dateconvention handles DMY MDY withoutguessing', () => {
    expect(parseImportDate('03/04/2024', { dateFormat: 'dmy', timezone: 'UTC' })).toBe(
      '2024-04-03T00:00:00.000Z',
    );
    expect(parseImportDate('03/04/2024', { dateFormat: 'mdy', timezone: 'UTC' })).toBe(
      '2024-03-04T00:00:00.000Z',
    );
    expect(() => parseImportDate('03/04/2024', { dateFormat: 'iso', timezone: 'UTC' })).toThrow(
      /convention/,
    );
  });
  it('invalid wall-clock time and bad values identify the actual import column', () => {
    expect(() =>
      parseImportDate('2024-01-01T12:60', { dateFormat: 'iso', timezone: 'UTC' }),
    ).toThrow();
    const p = preview({ kind: 'csv', name: 'bad.csv', text: 'Date,Value\n2024-01-01,wrong' });
    expect(p.issues[0]).toMatchObject({ row: 2, column: 'Value', severity: 'error' });
    expect(p.valid).toBe(false);
  });
  it('rate-denominator failures stay in the row-local preview report', () => {
    const m: ImportMapping = {
      ...mapping,
      denominatorColumn: 'Exposure',
      valueColumns: [
        {
          ...mapping.valueColumns![0],
          unit: { kind: 'ratio', label: 'rate' },
          semantics: 'rate',
          aggregation: 'ratio',
        },
      ],
    };
    const p = preview(
      { kind: 'csv', name: 'bad.csv', text: 'Date,Value,Exposure\n2024-01-01,0.02,0' },
      m,
    );
    expect(p.valid).toBe(false);
    expect(p.dataset.observations).toEqual([]);
    expect(p.issues[0]).toMatchObject({
      code: 'INVALID_RATE_DENOMINATOR',
      row: 2,
      column: 'Exposure',
    });
  });
  it('Excel1900/1904 and fakeleapday deterministic', () => {
    expect(parseImportDate(1, { dateFormat: 'excel-1900', timezone: 'UTC' })).toBe(
      '1900-01-01T00:00:00.000Z',
    );
    expect(parseImportDate(61, { dateFormat: 'excel-1900', timezone: 'UTC' })).toBe(
      '1900-03-01T00:00:00.000Z',
    );
    expect(parseImportDate(0, { dateFormat: 'excel-1904', timezone: 'UTC' })).toBe(
      '1904-01-01T00:00:00.000Z',
    );
    expect(() => parseImportDate(60, { dateFormat: 'excel-1900', timezone: 'UTC' })).toThrow(
      /nonexistent/,
    );
  });
  it('timezone midnightconverted andDSTgaps/folds reject', () => {
    expect(parseImportDate('2024-07-01', { dateFormat: 'iso', timezone: 'Europe/Stockholm' })).toBe(
      '2024-06-30T22:00:00.000Z',
    );
    expect(() =>
      parseImportDate('2024-03-31T02:30', { dateFormat: 'iso', timezone: 'Europe/Stockholm' }),
    ).toThrow(/Nonexistent/);
    expect(() =>
      parseImportDate('2024-10-27T02:30', { dateFormat: 'iso', timezone: 'Europe/Stockholm' }),
    ).toThrow(/Ambiguous/);
    expect(
      parseImportDate('2024-10-27T02:30:00+02:00', {
        dateFormat: 'iso',
        timezone: 'Europe/Stockholm',
      }),
    ).toBe('2024-10-27T00:30:00.000Z');
  });
  it('invalidcalendar dates nevernormalize silently', () => {
    expect(() => parseImportDate('2024-02-30', { dateFormat: 'iso', timezone: 'UTC' })).toThrow();
    expect(() =>
      parseImportDate('2024-02-30T00:00:00Z', { dateFormat: 'iso', timezone: 'UTC' }),
    ).toThrow();
  });
  it('missing periodsandmissingvalues remainmissing,notzero', () => {
    const p = preview({
      kind: 'csv',
      name: 'gaps.csv',
      text: 'Date,Value\n2024-01-01,100\n2024-01-03,',
    });
    expect(p.valid).toBe(true);
    expect(p.dataset.observations.map((o) => o.value)).toEqual([100, null]);
    expect(p.dataset.observations.length).toBe(2);
  });
  it('duplicatepolicy reject/first/last/keep explicit', () => {
    const source: ImportSource = {
      kind: 'csv',
      name: 'duplicates.csv',
      text: 'Date,Value\n2024-01-01,10\n2024-01-01,20',
    };
    expect(preview(source).valid).toBe(false);
    expect(
      preview(source, { ...mapping, duplicatePolicy: 'first' }).dataset.observations[0].value,
    ).toBe(10);
    expect(
      preview(source, { ...mapping, duplicatePolicy: 'last' }).dataset.observations[0].value,
    ).toBe(20);
    expect(
      preview(source, { ...mapping, duplicatePolicy: 'keep' }).dataset.observations.length,
    ).toBe(2);
  });
  it('invalidOHLCreturnsrowerrorandno validcommitpayload', () => {
    const p = preview(
      {
        kind: 'csv',
        name: 'bad.csv',
        text: 'Date,Value,Open,High,Low,Close\n2024-01-01,100,100,90,95,105',
      },
      { ...mapping, ohlcColumns: { open: 'Open', high: 'High', low: 'Low', close: 'Close' } },
    );
    expect(p.valid).toBe(false);
    expect(p.issues[0]).toMatchObject({ code: 'INVALID_OHLC', row: 2 });
    expect(p.dataset.observations).toHaveLength(0);
  });
  it('longformat usesexplicitseriesanddimensions; inspectorfinds allnames', () => {
    const source: ImportSource = {
      kind: 'json',
      name: 'long.json',
      text: JSON.stringify(
        Array.from({ length: 12 }, (_, i) => ({
          Date: '2024-01-01',
          Metric: i === 11 ? 'Other' : 'Growth',
          Value: i,
          Region: 'NO',
        })),
      ),
    };
    const inspected = executeAnalysis({
      kind: 'inspect-import',
      source,
      seriesColumn: 'Metric',
    }) as { seriesNames: string[] };
    expect(inspected.seriesNames).toEqual(['Growth', 'Other']);
    const p = preview(source, {
      ...mapping,
      format: 'long',
      valueColumns: undefined,
      valueColumn: 'Value',
      seriesColumn: 'Metric',
      dimensions: ['Region'],
      duplicatePolicy: 'keep',
      longSeries: [
        {
          name: 'Growth',
          id: 'growth',
          unit: { kind: 'count', label: 'customers' },
          semantics: 'flow',
          aggregation: 'sum',
          direction: 'higher-is-better',
        },
        {
          name: 'Other',
          id: 'other',
          unit: { kind: 'count', label: 'customers' },
          semantics: 'flow',
          aggregation: 'sum',
          direction: 'higher-is-better',
        },
      ],
    });
    expect(p.valid).toBe(true);
    expect(p.series.map((s) => s.id)).toEqual(['growth', 'other']);
    expect(p.dataset.observations.every((o) => o.dimensions.Region === 'NO')).toBe(true);
  });
  it('cancellationandbyteboundaries rejectbefore anypersistedwrite', () => {
    const source: ImportSource = {
      kind: 'csv',
      name: 'size.csv',
      text: 'Date,Value\n2024-01-01,1',
    };
    expect(() => previewImport(source, mapping, 'data', 4)).toThrow(/import limit/);
    const abort = new AbortController();
    abort.abort();
    expect(() =>
      previewImport(source, mapping, 'data', undefined, { signal: abort.signal }),
    ).toThrow(/cancelled/);
  });
  it('formulas,macros,externalworkbooklinks andDTDs cannotexecute', () => {
    expect(() =>
      readImportTable({
        kind: 'xlsx',
        name: 'formula.xlsx',
        bytes: workbook(['<f>SUM(1,2)</f><v>3</v>']),
      }),
    ).toThrow(/Formula cells/);
    expect(() =>
      readImportTable({
        kind: 'xlsx',
        name: 'macro.xlsx',
        bytes: workbook(['<v>1</v>'], { 'xl/vbaProject.bin': new Uint8Array([1]) }),
      }),
    ).toThrow(/Macros/);
    expect(() =>
      readImportTable({
        kind: 'xlsx',
        name: 'dtd.xlsx',
        bytes: workbook(['<v>1</v>'], {
          'xl/workbook.xml': strToU8(
            '<!DOCTYPE workbook [<!ENTITY test SYSTEM "https://evil.invalid">]><workbook/>',
          ),
        }),
      }),
    ).toThrow(/DTD/);
  });
  it('JSON rejectsproto,nestedcode andmalformedrows', () => {
    expect(() =>
      readImportTable({
        kind: 'json',
        name: 'proto.json',
        text: '[{"__proto__":{"polluted":true}}]',
      }),
    ).toThrow(/Unsafe/);
    expect(() =>
      readImportTable({
        kind: 'json',
        name: 'code.json',
        text: '[{"Date":"2024-01-01","Value":{"code":"alert(1)"}}]',
      }),
    ).toThrow(/literal/);
    expect(({} as any).polluted).toBeUndefined();
  });
  it('CSVexport neutralizes spreadsheetformulas andquotes labels', () => {
    for (const value of ['=HYPERLINK("https://evil.invalid")', '+cmd', '-cmd', '@cmd', '\tcmd'])
      expect(analyticsCsvCell(value)).toMatch(/^"'/);
    expect(analyticsCsvCell(-5)).toBe('"-5"');
    expect(analyticsCsvCell('a"b')).toBe('"a""b"');
  });
  it('riskpopulationchurncap doesnotcapNRRor netgrowth', () => {
    const ratios = {
      ...mapping,
      valueColumns: [
        {
          ...mapping.valueColumns![0],
          unit: { kind: 'ratio' as const, label: 'NRR' },
          semantics: 'rate' as const,
          aggregation: 'none' as const,
        },
      ],
    };
    const source: ImportSource = {
      kind: 'csv',
      name: 'nrr.csv',
      text: 'Date,Value\n2024-01-01,1.2',
    };
    expect(preview(source, ratios).valid).toBe(true);
    expect(
      preview(source, {
        ...ratios,
        valueColumns: [{ ...ratios.valueColumns[0], riskPopulation: 'opening-customers' }],
      }).valid,
    ).toBe(false);
  });
});
