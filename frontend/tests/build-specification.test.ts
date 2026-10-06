import { describe, expect, it } from 'vitest';
import { blankGraph, newEdge, newNode } from '../src/model/types';
import {
  applicationSpecification,
  setBuildSpecification,
  validateBuildSpecification,
} from '../src/export/build-specification';
import { buildLovablePrompt } from '../src/export/lovable';

describe('Reviewable app specifications', () => {
  it('keeps observed SQL schema separate from proposed endpoints and requires API decisions', () => {
    const graph = blankGraph('Fleet app');
    const node = newNode(graph.diagram.id, {
      title: 'fleet',
      nodeType: 'database',
      metadata: {
        sqlTable: {
          version: 1,
          name: 'fleet',
          qualifiedName: ['public', 'fleet'],
          columns: [
            {
              name: 'id',
              dataType: 'integer',
              nullable: false,
              primaryKey: true,
              foreignKey: false,
              unique: false,
            },
          ],
          primaryKey: ['id'],
          uniqueKeys: [],
        },
      },
    });
    graph.nodes.push(node);
    const before = JSON.stringify(graph);
    const specification = applicationSpecification(graph, { scope: 'diagram' });
    const contract = JSON.parse(specification.sections.apiContract);
    expect(contract.openapi).toBe('3.0.3');
    expect(contract.components.schemas.Entity_n1.properties.id.type).toBe('integer');
    expect(
      specification.decisions.find((decision) => decision.id === `api:${node.id}`)?.answer,
    ).toBeUndefined();
    expect(specification.sections.apiContract).toContain('not existing services');
    expect(JSON.stringify(graph)).toBe(before);
  });
  it('does not invent schemas for conceptual or external objects', () => {
    const graph = blankGraph('Concept');
    graph.nodes.push(newNode(graph.diagram.id, { title: 'Customer', nodeType: 'database' }));
    const specification = applicationSpecification(graph, { scope: 'diagram' });
    expect(specification.sections.dataModel).toContain('"fields":"unknown"');
    expect(specification.sections.apiContract).toContain('not specified');
    expect(specification.decisions.some((decision) => decision.id.startsWith('entity:'))).toBe(
      true,
    );
  });
  it('finds incomplete decision branches and retains explicit conditions as reviewable requirements', () => {
    const graph = blankGraph('Inspection');
    graph.nodes = [
      newNode(graph.diagram.id, { nodeType: 'decision', title: 'Passed inspection?' }),
      newNode(graph.diagram.id, { title: 'Release truck' }),
    ];
    graph.edges.push(
      newEdge(graph.diagram.id, graph.nodes[0].id, graph.nodes[1].id, { label: 'Passed' }),
    );
    const result = applicationSpecification(graph, { scope: 'diagram' });
    expect(result.decisions.some((decision) => decision.id.startsWith('branches:'))).toBe(true);
    expect(result.sections.acceptanceCriteria).toContain('Passed');
    expect(result.sections.businessRules).not.toContain('Rejected');
  });
  it('includes reviewed answers and corrections in the exact Lovable prompt without exposing arbitrary metadata', () => {
    let graph = blankGraph('Truck service');
    graph.nodes = [
      newNode(graph.diagram.id, {
        title: 'Book service',
        metadata: { secretPayload: 'MUST_NOT_EXPORT' },
      }),
    ];
    graph = setBuildSpecification(graph, {
      version: 1,
      sections: { screens: 'Use a calendar with available slots.' },
      answers: { audience: 'Service coordinators can book appointments.' },
    });
    const prompt = buildLovablePrompt(graph, '', { scope: 'diagram' });
    expect(prompt.text).toContain('Use a calendar with available slots.');
    expect(prompt.text).toContain('Service coordinators can book appointments.');
    expect(prompt.text).not.toContain('MUST_NOT_EXPORT');
    expect(
      prompt.specification.decisions.find((decision) => decision.id === 'audience')?.answer,
    ).toBeTruthy();
  });
  it('applies selected scope and bounds ambiguous decision review', () => {
    const graph = blankGraph('Selected workflow');
    graph.nodes = [
      newNode(graph.diagram.id, { title: 'Included', nodeType: 'database' }),
      newNode(graph.diagram.id, { title: 'Excluded', nodeType: 'database' }),
    ];
    const result = applicationSpecification(graph, {
      scope: 'selected',
      selectedIds: [graph.nodes[0].id],
    });
    expect(result.nodeCount).toBe(1);
    expect(result.sections.dataModel).not.toContain('Excluded');
    expect(() =>
      validateBuildSpecification({ version: 1, sections: { unsupported: 'text' }, answers: {} }),
    ).toThrow();
    expect(() =>
      validateBuildSpecification({ version: 1, sections: {}, answers: {}, extra: true }),
    ).toThrow();
  });
});
