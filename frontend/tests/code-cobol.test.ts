import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { parseCode } from '../src/code/analyzer';
import { getCodeObject, getCodeRelation } from '../src/code/schema';
import { extractLegacy } from '../src/code/special/legacy';
import { validateGraph } from '../src/model/validation';

const payroll = readFileSync(resolve('tests/fixtures/cobol-payroll.cbl'), 'utf8');
const lineOf = (source: string, marker: string) =>
  source.slice(0, source.indexOf(marker)).split('\n').length;

it('recognizes the supplied payroll program, numbered paragraphs and real file resources', () => {
  const result = extractLegacy(payroll, 'cobol');
  expect(result.symbols.map((symbol) => symbol.name)).toEqual([
    'EMP-SALARY-PROCESSOR',
    'MAIN-PROCEDURE',
    '100-INITIALIZE',
    '200-PROCESS-DATA',
    '300-TERMINATE',
    'EMPLOYEE-FILE',
    'REPORT-FILE',
  ]);
  for (const name of ['100-INITIALIZE', '200-PROCESS-DATA', '300-TERMINATE'])
    expect(result.symbols.find((symbol) => symbol.name === name)?.line).toBe(
      payroll.split('\n').findIndex((line) => line.trim() === `${name}.`) + 1,
    );
  const names = new Map(result.symbols.map((symbol) => [symbol.key, symbol.name]));
  const dependencies = result.dependencies.map((dependency) => ({
    ...dependency,
    source: names.get(dependency.source!),
  }));
  expect(dependencies.filter((dependency) => dependency.kind === 'calls')).toMatchObject([
    { source: 'MAIN-PROCEDURE', target: '100-INITIALIZE' },
    { source: 'MAIN-PROCEDURE', target: '200-PROCESS-DATA' },
    { source: 'MAIN-PROCEDURE', target: '300-TERMINATE' },
  ]);
  for (const source of ['100-INITIALIZE', '200-PROCESS-DATA']) {
    expect(dependencies).toContainEqual(
      expect.objectContaining({ source, target: 'EMPLOYEE-FILE', kind: 'reads' }),
    );
    expect(dependencies).toContainEqual(
      expect.objectContaining({ source, target: 'REPORT-FILE', kind: 'writes' }),
    );
  }
  expect(dependencies).toContainEqual(
    expect.objectContaining({ source: '300-TERMINATE', target: 'REPORT-FILE', kind: 'writes' }),
  );
});

it('creates resolved native connections with line evidence while discarding the original payroll source', () => {
  const result = parseCode({ files: [{ path: 'payroll.cbl', content: payroll }] });
  expect(result.mode).toBe('symbols');
  expect(result.graph.nodes).toHaveLength(8);
  expect(result.symbolCount).toBe(7);
  expect(result.unresolvedCount).toBe(0);
  expect(() => validateGraph(result.graph)).not.toThrow();
  const names = new Map(result.graph.nodes.map((node) => [node.id, getCodeObject(node)?.name]));
  for (const target of ['100-INITIALIZE', '200-PROCESS-DATA', '300-TERMINATE']) {
    const edge = result.graph.edges.find(
      (edge) =>
        names.get(edge.sourceNodeId) === 'MAIN-PROCEDURE' &&
        names.get(edge.targetNodeId) === target,
    );
    expect(getCodeRelation(edge!)).toMatchObject({
      kind: 'calls',
      confidence: 'heuristic',
      evidence: { path: 'payroll.cbl', line: lineOf(payroll, `PERFORM ${target}`) },
    });
  }
  const serialized = JSON.stringify(result.graph);
  for (const excluded of [
    'EMPLOYEES.DAT',
    'SALARY_REPORT.TXT',
    'LÖNERAPPORT FÖR ANSTÄLLDA',
    'AI-COLLABORATOR',
    'PERFORM 100-INITIALIZE',
    'PIC 9(3)V99',
  ])
    expect(serialized).not.toContain(excluded);
});

it('keeps fixed-format line numbers accurate and ignores scope terminators, comments and inline repeat counts', () => {
  const source = [
    '000100 IDENTIFICATION DIVISION.',
    '000200 PROGRAM-ID. BILLING.',
    '000300 PROCEDURE DIVISION.',
    '000400 MAIN.',
    '000500     PERFORM 100-INIT',
    '000600     PERFORM 3 TIMES',
    '000700         CONTINUE',
    '000800     END-PERFORM.',
    '000900* PERFORM 900-SECRET',
    '001000',
    '001100 100-INIT.',
    '001200     READ CUSTOMER-FILE',
    '001300     END-READ.',
    '001400     CONTINUE.',
    '001500* 900-SECRET.',
    '001600',
    '001700 200-FINISH.',
    '001800     GOBACK.',
  ].join('\n');
  const result = extractLegacy(source, 'cobol');
  expect(result.symbols.map(({ name, line }) => ({ name, line }))).toEqual([
    { name: 'BILLING', line: 2 },
    { name: 'MAIN', line: 4 },
    { name: '100-INIT', line: 11 },
    { name: '200-FINISH', line: 17 },
  ]);
  expect(result.dependencies.filter((dependency) => dependency.kind === 'calls')).toMatchObject([
    { target: '100-INIT', line: 5 },
  ]);
  expect(JSON.stringify(result)).not.toContain('SECRET');
  expect(result.dependencies.some((dependency) => dependency.target === '3')).toBe(false);
});

it('binds WRITE and REWRITE records to one case-insensitive FD/SELECT resource without using storage records', () => {
  const source = [
    'IDENTIFICATION DIVISION.',
    'PROGRAM-ID. REPORTER.',
    'ENVIRONMENT DIVISION.',
    'INPUT-OUTPUT SECTION.',
    'FILE-CONTROL.',
    'SELECT REPORT-FILE ASSIGN TO "SECRET-DISK-PATH".',
    'DATA DIVISION.',
    'FILE SECTION.',
    'FD report-file.',
    '01 OUTPUT-ROW PIC X(80).',
    '01 OTHER-ROW PIC X(80).',
    'WORKING-STORAGE SECTION.',
    '01 LOCAL-ROW PIC X(80).',
    'PROCEDURE DIVISION.',
    '100-WRITE.',
    'WRITE output-row.',
    'REWRITE other-row.',
    'WRITE LOCAL-ROW.',
  ].join('\n');
  const result = extractLegacy(source, 'cobol');
  expect(
    result.symbols.filter((symbol) => symbol.name.toUpperCase() === 'REPORT-FILE'),
  ).toHaveLength(1);
  expect(
    result.dependencies
      .filter((dependency) => dependency.kind === 'writes')
      .map((dependency) => dependency.target),
  ).toEqual(['REPORT-FILE', 'REPORT-FILE', 'LOCAL-ROW']);
  expect(result.symbols.some((symbol) => symbol.name === 'FILE-CONTROL')).toBe(false);
  expect(JSON.stringify(result)).not.toContain('SECRET-DISK-PATH');
});

it('retains numbered standalone procedure snippets without treating ordinary strings as references', () => {
  const source =
    '100-START.\n    PERFORM 200-WORK\n    DISPLAY "PERFORM 900-SECRET"\n\n*> 800-SECRET.\n200-WORK.\n    CALL "AUDIT"\n    GOBACK.';
  const result = extractLegacy(source, 'cobol');
  expect(result.symbols.map((symbol) => symbol.name)).toEqual(['100-START', '200-WORK']);
  expect(result.dependencies.map((dependency) => dependency.target)).toEqual(['AUDIT', '200-WORK']);
  expect(result.symbols[1].line).toBe(6);
  expect(JSON.stringify(result)).not.toContain('SECRET');
});
