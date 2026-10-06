import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as limits from '../src/imports/limits';
import { useEditor } from '../src/state/editor';
import { parseCsv } from '../src/data/csv';
import { openCsvFile } from '../src/data/client';
import { parseSql } from '../src/sql/parser';
import { parseSqlAsync } from '../src/sql/client';
import { normalizeCodeInput } from '../src/code/input';
import { parseCode } from '../src/code/analyzer';
import { parseCodeAsync } from '../src/code/client';
import { readCodeFiles } from '../src/code/importFiles';
import { loadRefreshCsv, previewSqlRefresh } from '../src/data/refreshClient';
import { runRefresh } from '../src/data/refreshWorker';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  complete(result: unknown) {
    const id = this.postMessage.mock.calls[0]?.[0]?.id;
    this.onmessage?.({ data: { result, ...(id !== undefined ? { id } : {}) } } as MessageEvent);
  }
}
function file(name: string, text: string, size = limits.utf8Bytes(text)) {
  const value = new File([text], name);
  Object.defineProperty(value, 'size', { value: size });
  Object.defineProperty(value, 'text', { value: vi.fn().mockResolvedValue(text) });
  return value;
}
beforeEach(() => {
  useEditor.setState({ importFileLimitMb: 50 });
  TestWorker.instances = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useEditor.setState({ importFileLimitMb: 50 });
});

describe('Captured source import byte budgets', () => {
  it('counts multibyte text before parsing and keeps the requested small internal budgets', () => {
    const csv = 'Name\n界😀';
    const sql = "SELECT '界😀' AS label;";
    const code = { files: [{ path: 'main.js', content: "const label = '界😀';" }] };
    for (const [text, parse] of [
      [csv, (limit: number) => parseCsv(csv, 'source.csv', limit)],
      [sql, (limit: number) => parseSql(sql, 'Query', limit)],
      [code.files[0].content, (limit: number) => parseCode(code, limit)],
    ] as const) {
      const bytes = limits.utf8Bytes(text);
      expect(() => parse(bytes)).not.toThrow();
      expect(() => parse(bytes - 1)).toThrow(/import limit/);
    }
  });

  it('applies one configurable budget to both individual code files and the entire project', () => {
    const input = {
      files: [
        { path: 'one.py', content: '界' },
        { path: 'two.py', content: '界' },
      ],
    };
    expect(normalizeCodeInput(input, 6).bytes).toBe(6);
    expect(() => normalizeCodeInput(input, 5)).toThrow(/Code project/);
    expect(() => normalizeCodeInput(input, 2)).toThrow(/one.py/);
  });

  it('allows raised parser budgets and reports the experimental warning without allocating huge text', () => {
    const sql = 'CREATE TABLE customers (id INT);';
    const csv = 'Name\nAda';
    const code = 'def run():\n pass';
    const count = limits.utf8Bytes;
    vi.spyOn(limits, 'utf8Bytes').mockImplementation((text) =>
      [sql, csv, code].includes(text) ? 60 * 1024 * 1024 : count(text),
    );
    const budget = 64 * 1024 * 1024;
    expect(() => parseCsv(csv, 'large.csv', budget)).not.toThrow();
    expect(parseSql(sql, 'Schema', budget).warnings).toContain(limits.LARGE_IMPORT_WARNING);
    expect(parseCode({ files: [{ path: 'main.py', content: code }] }, budget).warnings).toContain(
      limits.LARGE_IMPORT_WARNING,
    );
    expect(() => parseCsv(csv, 'large.csv')).toThrow(/50 MB/);
    expect(() => parseSql(sql)).toThrow(/50 MB/);
    expect(() => parseCode({ files: [{ path: 'main.py', content: code }] })).toThrow(/50 MB/);
  });

  it('rejects CSV, SQL and code before worker creation or reading when the budget is exceeded', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const csv = file('large.csv', 'A\n1', 21);
    const source = file('large.py', 'pass', 21);
    await expect(openCsvFile(csv, 20)).rejects.toThrow(/import limit/);
    await expect(readCodeFiles([source], { byteLimit: 20 })).rejects.toThrow(/import limit/);
    await expect(loadRefreshCsv(csv, { byteLimit: 20 })).rejects.toThrow(/import limit/);
    await expect(parseSqlAsync('SELECT 1', 'SQL', { byteLimit: 7 })).rejects.toThrow(
      /import limit/,
    );
    await expect(
      parseCodeAsync({ files: [{ path: 'main.py', content: '界' }] }, { byteLimit: 2 }),
    ).rejects.toThrow(/import limit/);
    expect(csv.text).not.toHaveBeenCalled();
    expect(source.text).not.toHaveBeenCalled();
    expect(TestWorker.instances).toHaveLength(0);
  });

  it('captures the preference for SQL and code workers and keeps it unchanged in flight', async () => {
    vi.stubGlobal('Worker', TestWorker);
    useEditor.setState({ importFileLimitMb: 100 });
    const sql = parseSqlAsync('SELECT 1', 'SQL');
    const code = parseCodeAsync({ files: [{ path: 'main.py', content: 'pass' }] });
    useEditor.setState({ importFileLimitMb: 50 });
    for (const worker of TestWorker.instances) {
      expect(worker.postMessage.mock.calls[0][0].byteLimit).toBe(100 * 1024 * 1024);
      worker.complete({ graph: {}, warnings: [] });
    }
    await Promise.all([sql, code]);
  });

  it('passes the chosen budget to CSV and refresh workers without a hidden old cap', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const large = file('source.csv', 'A\n1', 60 * 1024 * 1024);
    const csv = openCsvFile(large, 64 * 1024 * 1024);
    const refresh = loadRefreshCsv(large, { byteLimit: 64 * 1024 * 1024 });
    const dataset = parseCsv('A\n1', 'source.csv');
    for (const worker of TestWorker.instances) {
      expect(worker.postMessage.mock.calls[0][0].byteLimit).toBe(64 * 1024 * 1024);
      worker.complete(dataset);
    }
    await Promise.all([csv, refresh]);
  });

  it('rejects code project totals before the first read and accepts a raised captured ceiling', async () => {
    const one = file('one.py', 'pass', 30 * 1024 * 1024);
    const two = file('two.py', 'pass', 30 * 1024 * 1024);
    await expect(readCodeFiles([one, two])).rejects.toThrow(/Source project/);
    expect(one.text).not.toHaveBeenCalled();
    expect(two.text).not.toHaveBeenCalled();
    await expect(readCodeFiles([one, two], { byteLimit: 64 * 1024 * 1024 })).resolves.toHaveLength(
      2,
    );
  });

  it('carries byte limits through worker fallback refresh for CSV and SQL', async () => {
    vi.stubGlobal('Worker', undefined);
    const csv = file('source.csv', 'A\n界😀');
    await expect(loadRefreshCsv(csv, { byteLimit: 12 })).resolves.toMatchObject({
      rows: [['界😀']],
    });
    await expect(runRefresh({ operation: 'parse', file: csv, byteLimit: 2 })).rejects.toThrow(
      /import limit/,
    );
    const graph = parseSql('CREATE TABLE customers (id INT);').graph;
    await expect(
      previewSqlRefresh(graph, 'CREATE TABLE customers (id INT);', 'retain', { byteLimit: 2 }),
    ).rejects.toThrow(/import limit/);
    await expect(
      previewSqlRefresh(graph, 'CREATE TABLE customers (id INT);', 'retain', { byteLimit: 50 }),
    ).resolves.toMatchObject({ graph: { diagram: { id: graph.diagram.id } } });
  });
});
