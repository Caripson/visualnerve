import { describe, expect, it } from 'vitest';
import {
  buildLovablePrompt,
  lovableLink,
  LOVABLE_MAX_PROMPT_LENGTH,
  LOVABLE_MAX_URL_LENGTH,
} from '../src/export/lovable';
import { base, blankGraph, newEdge, newNode } from '../src/model/types';
import { csvGraph, defaultAnalysis, getCsvNode, parseCsv } from '../src/data/csv';

function records(text: string): Record<string, any>[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

describe('Lovable application handoff', () => {
  it('describes the desired app, complete workflow and named roles without leaking metadata or emails', () => {
    const graph = blankGraph('Loan approvals', 'process');
    graph.diagram.description = 'Customers submit an application and reviewers decide.';
    graph.diagram.metadata = { token: 'secret-diagram-token' };
    graph.diagram.settings.viewport = { x: -9999, y: -9999, zoom: 0.1 };
    graph.diagram.settings.customApiKey = 'secret-settings-key';
    const reviewer = {
      ...base(),
      name: 'Johan',
      kind: 'person' as const,
      role: 'Reviewer',
      team: 'Credit operations',
      email: 'secret-email@example.com',
      color: '#965de1',
      metadata: { key: 'secret-owner-key' },
    };
    graph.owners.push(reviewer, {
      ...reviewer,
      id: crypto.randomUUID(),
      name: 'Unrelated owner',
    });
    const parent = newNode(graph.diagram.id, { title: 'Application', collapsed: true });
    const review = newNode(graph.diagram.id, {
      title: 'Review',
      description: 'Check affordability.',
      notes: 'Ask for additional evidence if necessary.\nRetain the original submission.',
      nodeType: 'decision',
      status: 'done',
      tags: ['credit', 'regulated'],
      ownerId: reviewer.id,
      ownerIds: [reviewer.id],
      parentId: parent.id,
      metadata: { apiKey: 'secret-node-key', csv: { freeform: 'secret-legacy-csv' } },
      dueDate: '2027-01-01',
    });
    const disconnected = newNode(graph.diagram.id, { title: 'Audit log', status: 'blocked' });
    graph.nodes = [parent, review, disconnected];
    const result = buildLovablePrompt(graph, 'Use Swedish copy.\nSupport keyboard navigation.', {
      scope: 'diagram',
    });
    const objects = records(result.text).filter((record) => record.ref?.startsWith('n'));
    expect(result.nodeCount).toBe(3);
    expect(objects[1]).toMatchObject({
      ref: 'n2',
      title: 'Review',
      type: 'decision',
      description: review.description,
      notes: review.notes,
      status: 'done',
      tags: review.tags,
      parent: 'n1',
      responsibilities: [
        { name: 'Johan', kind: 'person', team: 'Credit operations', role: 'Reviewer' },
      ],
      schedule: { due: '2027-01-01' },
    });
    expect(records(result.text)).toContainEqual({
      parent: 'n1',
      child: 'n2',
      type: 'implicit hierarchy',
      externalContext: false,
    });
    expect(result.text).toContain('desired APP');
    expect(result.text).toContain('Done is not permission to omit it');
    expect(result.text).toContain('Use Swedish copy.\nSupport keyboard navigation.');
    expect(result.text).toContain('Audit log');
    expect(result.text).not.toContain('secret-');
    expect(result.text).not.toContain('Unrelated owner');
    expect(result.text).not.toContain(parent.id);
    expect(result.text).not.toContain('-9999');
  });

  it('keeps duplicate titles distinct and preserves every direction, branch condition, loop and parallel edge', () => {
    const graph = blankGraph('Order workflow', 'flowchart');
    const a = newNode(graph.diagram.id, { title: 'Review', nodeType: 'decision' });
    const b = newNode(graph.diagram.id, { title: 'Review', parentId: a.id });
    graph.nodes = [a, b];
    graph.edges = [
      newEdge(graph.diagram.id, a.id, b.id, {
        direction: 'forward',
        edgeType: 'approval',
        label: 'Accepted',
        description: 'Only when the balance is positive.',
        metadata: { token: 'secret-edge-key' },
      }),
      newEdge(graph.diagram.id, a.id, b.id, { direction: 'backward', label: 'Needs changes' }),
      newEdge(graph.diagram.id, a.id, b.id, { direction: 'both', edgeType: 'synchronization' }),
      newEdge(graph.diagram.id, a.id, b.id, { direction: 'none', edgeType: 'hierarchy' }),
      newEdge(graph.diagram.id, b.id, b.id, { label: 'Retry', direction: 'forward' }),
    ];
    const result = buildLovablePrompt(graph, '', { scope: 'diagram' });
    const edges = records(result.text).filter((record) => record.ref?.startsWith('e'));
    expect(result).toMatchObject({ nodeCount: 2, edgeCount: 5, boundaryCount: 0 });
    expect(edges.map((edge) => edge.flow)).toEqual([
      'n1 -> n2',
      'n2 -> n1',
      'n1 <-> n2',
      'n1 -- n2 (association, no execution direction)',
      'n2 -> n2',
    ]);
    expect(edges[0]).toMatchObject({
      source: 'n1',
      target: 'n2',
      type: 'approval',
      label: 'Accepted',
      description: 'Only when the balance is positive.',
    });
    expect(edges[2]).not.toHaveProperty('label');
    expect(edges[4]).toMatchObject({ source: 'n2', target: 'n2', loop: true, label: 'Retry' });
    expect(records(result.text).filter((record) => record.type === 'implicit hierarchy')).toEqual(
      [],
    );
    expect(result.text).not.toContain('secret-edge-key');
    expect(graph.edges[1].direction).toBe('backward');
  });

  it('exports exactly selected objects and exposes crossing conditions and implicit parents as external context', () => {
    const graph = blankGraph('Purchase flow', 'process');
    const parent = newNode(graph.diagram.id, { title: 'Finance', description: 'Budget owners.' });
    const selected = newNode(graph.diagram.id, { title: 'Review', parentId: parent.id });
    const external = newNode(graph.diagram.id, { title: 'Fulfil', notes: 'Outside-only notes' });
    const unrelated = newNode(graph.diagram.id, { title: 'Unrelated secret flow' });
    graph.nodes = [parent, selected, external, unrelated];
    graph.edges = [
      newEdge(graph.diagram.id, selected.id, external.id, {
        direction: 'backward',
        label: 'Rejected items return for review',
      }),
      newEdge(graph.diagram.id, external.id, unrelated.id, { label: 'Unrelated condition' }),
    ];
    const result = buildLovablePrompt(graph, '', {
      scope: 'selected',
      selectedIds: [selected.id, selected.id, 'missing-id'],
    });
    const data = records(result.text);
    expect(result).toMatchObject({ nodeCount: 1, edgeCount: 0, boundaryCount: 2 });
    expect(data.find((item) => item.ref === 'n1')).toMatchObject({
      title: 'Review',
      parent: 'x1',
    });
    expect(data.find((item) => item.ref === 'b1')).toMatchObject({
      source: 'n1',
      target: 'x2',
      direction: 'backward',
      flow: 'x2 -> n1',
      label: 'Rejected items return for review',
    });
    expect(data).toContainEqual({
      parent: 'x1',
      child: 'n1',
      type: 'implicit hierarchy',
      externalContext: true,
    });
    expect(result.text).not.toContain('Unrelated secret flow');
    expect(result.text).not.toContain('Unrelated condition');
    expect(result.text).not.toContain('Outside-only notes');
    expect(result.text).toContain('context outside the chosen scope');
  });

  it('handles empty selections without quietly falling back to the complete diagram', () => {
    const graph = blankGraph('Private app');
    graph.nodes = [newNode(graph.diagram.id, { title: 'Do not include this step' })];
    const result = buildLovablePrompt(graph, 'Build only the selected objects.', {
      scope: 'selected',
    });
    expect(result).toMatchObject({ nodeCount: 0, edgeCount: 0, boundaryCount: 0 });
    expect(result.text).not.toContain('Do not include this step');
  });

  it('distinguishes the whole CSV diagram, current data view and exact selection without reading raw rows', () => {
    const dataset = parseCsv(
      'Region,Amount,Secret\nNorth,10,RAW-SECRET-A\nSouth,20,RAW-SECRET-B\nNorth,30,RAW-SECRET-C',
      'Orders.csv',
    );
    const analysis = {
      ...defaultAnalysis(dataset),
      levels: [dataset.columns[0].id],
      metrics: [
        { id: 'count', operation: 'count' as const },
        { id: 'sum', operation: 'sum' as const, columnId: dataset.columns[1].id },
      ],
    };
    const whole = csvGraph(dataset, analysis);
    const north = whole.nodes.find((node) => getCsvNode(node)?.path[0]?.value === 'North')!;
    const current = csvGraph(
      dataset,
      {
        ...analysis,
        filters: [
          { id: 'region', columnId: dataset.columns[0].id, operation: 'equals', value: 'South' },
        ],
        columnRules: [{ columnId: dataset.columns[1].id, numberFormat: 'dot' }],
      },
      whole,
    );
    const manual = newNode(dataset.diagramId, { title: 'Send summary to finance', status: 'done' });
    const copied = newNode(dataset.diagramId, {
      title: 'Manually copied North summary',
      metadata: { csv: { ...getCsvNode(north)!, visible: false } },
    });
    current.nodes.push(manual, copied);
    current.edges.push(
      newEdge(dataset.diagramId, manual.id, north.id, { label: 'Investigate later' }),
    );
    Object.defineProperty(dataset, 'rows', {
      get() {
        throw new Error('The handoff must never read raw rows.');
      },
    });
    const all = buildLovablePrompt(current, '', { scope: 'diagram' });
    const view = buildLovablePrompt(current, '', { scope: 'csv-view' });
    const selection = buildLovablePrompt(current, '', {
      scope: 'selected',
      selectedIds: [north.id],
    });
    expect(all.nodeCount).toBe(current.nodes.length);
    expect(view.nodeCount).toBe(current.nodes.length - 1);
    expect(selection.nodeCount).toBe(1);
    const included = records(view.text).filter((record) => record.ref?.startsWith('n'));
    expect(included.map((node) => node.title)).toContain('Send summary to finance');
    expect(included.map((node) => node.title)).toContain('Manually copied North summary');
    expect(included.some((node) => node.title === north.title)).toBe(false);
    expect(view.text).toContain('Investigate later');
    expect(view.boundaryCount).toBe(2);
    expect(view.text).toContain('"operation":"equals","value":"South"');
    expect(view.text).toContain('"numberFormat":"dot"');
    expect(all.text).toContain('"label":"Amount"');
    expect(all.text).toContain('"operation":"sum","column":"c2","value":40');
    for (const result of [all, view, selection]) {
      expect(result.text).not.toContain('RAW-SECRET');
      expect(result.text).not.toContain(dataset.id);
      expect(result.text).not.toContain(dataset.fileName);
    }
    expect(getCsvNode(north)?.visible).toBe(true);
    expect(getCsvNode(current.nodes.find((node) => node.id === north.id)!)?.visible).toBe(false);
  });

  it('exports source-free aggregate snapshots without exporting generic custom metadata', () => {
    const source = parseCsv('Category,Amount\nA,25', 'Accounts.csv');
    const original = csvGraph(source, defaultAnalysis(source));
    const graph = blankGraph('Summary');
    const data = getCsvNode(original.nodes[0])!;
    graph.nodes = [
      newNode(graph.diagram.id, {
        title: 'Saved aggregate',
        metadata: { csvSnapshot: data, credentials: 'DO-NOT-SHARE' },
      }),
    ];
    const result = buildLovablePrompt(graph, '', { scope: 'csv-view' });
    expect(result.nodeCount).toBe(1);
    expect(result.text).toContain('"matchingRows":1');
    expect(result.text).toContain('"sourceAnalysisUnavailable":true');
    expect(result.text).not.toContain('DO-NOT-SHARE');
    expect(result.text).not.toContain(data.datasetId);
  });

  it('preserves large instructions and full object details for copy/download instead of truncating', () => {
    const graph = blankGraph('Large app');
    const notes = `${'Detailed requirement. '.repeat(3_000)}FINAL REQUIREMENT`;
    graph.nodes = [newNode(graph.diagram.id, { title: 'Full specifications', notes })];
    const prompt = buildLovablePrompt(graph, 'Keep every requirement.', { scope: 'diagram' });
    expect(records(prompt.text).find((node) => node.ref === 'n1')?.notes).toBe(notes);
    expect(prompt.text).toContain('FINAL REQUIREMENT');
    expect(prompt.text.length).toBeGreaterThan(LOVABLE_MAX_PROMPT_LENGTH);
    expect(lovableLink(prompt.text)).toMatchObject({
      url: null,
      reason: expect.stringContaining('complete prompt'),
    });
  });
});

describe('Lovable links', () => {
  it('round-trips Unicode, delimiters and multiline text into an unsent homepage fragment', () => {
    const text = 'Bygg en app för Åsa 🐈\nLabels: #start &end?=yes + no / 50%';
    const result = lovableLink(text);
    expect(result.reason).toBeNull();
    const url = new URL(result.url!);
    expect(url.origin).toBe('https://lovable.dev');
    expect(url.search).toBe('');
    const parameters = new URLSearchParams(url.hash.slice(1));
    expect(parameters.get('prompt')).toBe(text);
    expect([...parameters.keys()]).toEqual(['prompt']);
  });

  it('accepts the prompt limit and rejects one extra character without shortening it', () => {
    expect(lovableLink('a'.repeat(LOVABLE_MAX_PROMPT_LENGTH)).url).not.toBeNull();
    const text = 'a'.repeat(LOVABLE_MAX_PROMPT_LENGTH + 1);
    expect(lovableLink(text)).toMatchObject({
      url: null,
      reason: expect.stringContaining('50,000'),
    });
    expect(text.length).toBe(LOVABLE_MAX_PROMPT_LENGTH + 1);
  });

  it('checks encoded URL length separately from prompt length', () => {
    const prefix = 'https://lovable.dev/#prompt=';
    const count = Math.floor((LOVABLE_MAX_URL_LENGTH - prefix.length) / 9);
    expect(lovableLink('界'.repeat(count)).url).not.toBeNull();
    const over = '界'.repeat(count + 1);
    expect(over.length).toBeLessThan(LOVABLE_MAX_PROMPT_LENGTH);
    expect(lovableLink(over)).toMatchObject({
      url: null,
      reason: expect.stringContaining('encoded link'),
    });
  });

  it('returns a fallback reason for empty or unencodable prompts instead of throwing', () => {
    expect(lovableLink(' \n\t')).toMatchObject({ url: null, reason: expect.any(String) });
    expect(lovableLink('\ud800')).toMatchObject({
      url: null,
      reason: expect.stringContaining('complete prompt'),
    });
  });
});
