import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import type { Graph } from '../../src/model/types';
import { getCodeAnalysis, getCodeObject, getCodeRelation } from '../../src/code/schema';

const sourcePath = resolve('tests/fixtures/cobol-payroll.cbl');
const source = readFileSync(sourcePath, 'utf8');
const declarations = [
  'EMP-SALARY-PROCESSOR',
  'MAIN-PROCEDURE',
  '100-INITIALIZE',
  '200-PROCESS-DATA',
  '300-TERMINATE',
  'EMPLOYEE-FILE',
  'REPORT-FILE',
];

function semanticRelations(graph: Graph) {
  const names = new Map(graph.nodes.map((node) => [node.id, getCodeObject(node)?.name]));
  return graph.edges
    .map((edge) => ({
      source: names.get(edge.sourceNodeId),
      target: names.get(edge.targetNodeId),
      ...getCodeRelation(edge),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function expectPayrollGraph(graph: Graph) {
  expect(getCodeAnalysis(graph)).toMatchObject({
    languages: ['cobol'],
    mode: 'symbols',
    fileCount: 1,
    symbolCount: 7,
    unresolvedCount: 0,
  });
  const objects = graph.nodes.map((node) => getCodeObject(node));
  expect(objects.every((object) => object && !object.external)).toBe(true);
  expect(objects.filter((object) => object?.kind !== 'file').map((object) => object?.name)).toEqual(
    declarations,
  );
  expect(objects.find((object) => object?.kind === 'file')?.summary).toEqual(declarations);
  const relations = semanticRelations(graph);
  expect(relations.filter((relation) => relation.kind === 'calls')).toHaveLength(3);
  for (const target of declarations.slice(2, 5)) {
    expect(objects.find((object) => object?.name === target)?.kind).toBe('function');
    expect(relations).toContainEqual(
      expect.objectContaining({
        source: 'MAIN-PROCEDURE',
        target,
        kind: 'calls',
        confidence: 'heuristic',
        evidence: {
          path: 'cobol-payroll.cbl',
          line: source.slice(0, source.indexOf(`PERFORM ${target}`)).split('\n').length,
        },
      }),
    );
  }
  expect(
    relations
      .filter((relation) => ['reads', 'writes'].includes(relation.kind!))
      .map(({ source, target, kind }) => `${source} ${kind} ${target}`)
      .sort(),
  ).toEqual([
    '100-INITIALIZE reads EMPLOYEE-FILE',
    '100-INITIALIZE writes REPORT-FILE',
    '200-PROCESS-DATA reads EMPLOYEE-FILE',
    '200-PROCESS-DATA writes REPORT-FILE',
    '300-TERMINATE writes REPORT-FILE',
  ]);
  const serialized = JSON.stringify(graph);
  for (const excluded of [
    'END-READ',
    'FILE-CONTROL',
    'REPORT-RECORD',
    'EMPLOYEE-RECORD',
    'EMPLOYEES.DAT',
    'SALARY_REPORT.TXT',
    'LÖNERAPPORT FÖR ANSTÄLLDA',
    'AI-COLLABORATOR',
    'PERFORM 100-INITIALIZE',
    'PIC 9(3)V99',
  ])
    expect(serialized).not.toContain(excluded);
}

test('imports the payroll COBOL sample as readable native cards with resolved paragraph and file connections through UI, API and MCP', async ({
  page,
  request,
}) => {
  const before = await (await request.get('/api/v1/diagrams')).json();
  await page
    .locator('.sidebar-footer')
    .getByRole('button', { name: 'Visualize code', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Visualize code', exact: true });
  await dialog.getByLabel('Load source files', { exact: true }).setInputFiles(sourcePath);
  await expect(dialog.getByLabel('Language for cobol-payroll.cbl')).toHaveValue('cobol');
  await dialog.getByLabel('Code diagram name').fill('Payroll COBOL walkthrough');
  await dialog.getByLabel('Code diagram detail').selectOption('symbols');
  await expect(dialog.getByRole('button', { name: 'Create diagram', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Preview code', exact: true }).click();
  const preview = dialog.getByRole('region', { name: 'Code preview', exact: true });
  for (const name of declarations) await expect(preview).toContainText(name);
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(before);
  await dialog.getByRole('button', { name: 'Create diagram', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await expect(page.locator('.project-title-button')).toHaveText('Payroll COBOL walkthrough');

  const diagrams = (await (await request.get('/api/v1/diagrams')).json()) as Graph['diagram'][];
  const diagram = diagrams.find((item) => item.name === 'Payroll COBOL walkthrough')!;
  expect(diagrams).toHaveLength(before.length + 1);
  expect(diagram).toBeTruthy();
  const canonicalResponse = await request.get(`/api/v1/diagrams/${diagram.id}`);
  expect(canonicalResponse.status()).toBe(200);
  const canonicalGraph = (await canonicalResponse.json()) as Graph;
  expectPayrollGraph(canonicalGraph);

  const file = canonicalGraph.nodes.find((node) => getCodeObject(node)?.kind === 'file')!;
  const fileCard = page.locator(`.canvas-shell [data-node-id="${file.id}"]`);
  const details = fileCard.getByRole('region', { name: 'Code details for cobol-payroll.cbl' });
  await expect(details.getByRole('listitem')).toHaveText(declarations);
  await expect
    .poll(() => details.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await details.focus();
  await details.press('End');
  await expect
    .poll(() =>
      details.evaluate((element) => {
        const last = element.querySelector('li:last-child')!;
        const viewport = element.getBoundingClientRect();
        const row = last.getBoundingClientRect();
        return (
          element.scrollTop > 0 && row.top >= viewport.top - 1 && row.bottom <= viewport.bottom + 1
        );
      }),
    )
    .toBe(true);
  await expect(fileCard.getByText('7 declarations', { exact: true })).toBeVisible();

  const mcpResponse = await request.post('/mcp', {
    data: {
      jsonrpc: '2.0',
      id: 71,
      method: 'tools/call',
      params: {
        name: 'visual_nerve_request',
        arguments: {
          path: '/code/preview',
          method: 'POST',
          data: {
            name: 'MCP payroll preview',
            mode: 'symbols',
            files: [{ path: 'cobol-payroll.cbl', content: source, language: 'cobol' }],
          },
        },
      },
    },
  });
  expect(mcpResponse.status()).toBe(200);
  const mcp = (await mcpResponse.json()).result;
  expect(mcp.isError).toBe(false);
  expect(mcp.structuredContent.status).toBe(200);
  const mcpGraph = mcp.structuredContent.body.graph as Graph;
  expectPayrollGraph(mcpGraph);
  expect(semanticRelations(mcpGraph)).toEqual(semanticRelations(canonicalGraph));
  expect(await (await request.get('/api/v1/diagrams')).json()).toEqual(diagrams);
});
