import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewDiagram } from '../src/components/Dialogs';
import { TemplatePreview, templateMatches } from '../src/notation/TemplatePreview';
import { createNotationGraph, notationTemplates } from '../src/notation/templates';
import * as notationExamples from '../src/notation/templates';
import { notationGeometry } from '../src/notation/geometry';
import { templates } from '../src/templates/templates';
import { createTemplateDiagram } from '../src/templates/create';

vi.mock('../src/templates/create', () => ({ createTemplateDiagram: vi.fn(async () => {}) }));

describe('notation template gallery', () => {
  it('keeps all canonical templates discoverable and separates the fourteen UML families', () => {
    const { container } = render(<NewDiagram close={vi.fn()} />);
    expect(container.querySelectorAll('.template-option')).toHaveLength(templates.length);
    expect(container.querySelectorAll('[data-notation-preview]')).toHaveLength(21);
    expect(screen.getByRole('heading', { name: 'UML · Structure' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'UML · Behavior and interactions' })).toBeVisible();
    expect(container.querySelectorAll('[data-ibm-preview]')).toHaveLength(3);
    fireEvent.change(screen.getByRole('combobox', { name: 'Template collection' }), {
      target: { value: 'uml' },
    });
    expect(container.querySelectorAll('.template-option')).toHaveLength(14);
    fireEvent.change(screen.getByRole('combobox', { name: 'Template collection' }), {
      target: { value: 'bpmn' },
    });
    expect(container.querySelectorAll('.template-option')).toHaveLength(4);
    fireEvent.change(screen.getByRole('combobox', { name: 'Template collection' }), {
      target: { value: 'all' },
    });
    expect(container.querySelectorAll('.template-option')).toHaveLength(templates.length);
    expect(createTemplateDiagram).not.toHaveBeenCalled();
  });

  it('searches names and families, preserves a hidden selection, and creates the chosen example', async () => {
    const close = vi.fn();
    const { container } = render(<NewDiagram close={close} />);
    const search = screen.getByRole('searchbox', { name: 'Find a template' });
    fireEvent.change(search, { target: { value: '  UML  sequence ' } });
    expect(container.querySelectorAll('.template-option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(createTemplateDiagram).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /UML · Sequence/ }));
    fireEvent.change(search, { target: { value: 'no such template' } });
    expect(screen.getByRole('status')).toHaveTextContent('Selected: UML · Sequence');
    expect(container.querySelectorAll('.template-option')).toHaveLength(0);
    expect(screen.getByText(/No templates match/)).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'New diagram name' }), {
      target: { value: 'Order interaction' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(createTemplateDiagram).toHaveBeenLastCalledWith(
      'uml-sequence',
      'Order interaction',
      'example',
    );
  });

  it.each(notationTemplates)('uses canonical example geometry for $key', (template) => {
    const graph = createNotationGraph(template.key, 'Preview check')!;
    const { container } = render(<TemplatePreview templateKey={template.key} />);
    expect(container.querySelectorAll('[data-preview-symbol]')).toHaveLength(graph.nodes.length);
    expect(container.querySelectorAll('[data-preview-relationship]')).toHaveLength(
      graph.edges.length,
    );
    for (const node of graph.nodes) {
      const rendered = container.querySelector(
        `[data-preview-symbol="${node.notation!.collection}:${node.notation!.symbol}"]`,
      )!;
      expect(rendered.querySelector('path')).toHaveAttribute(
        'd',
        notationGeometry(node.notation!).outlinePath,
      );
    }
    expect(container.querySelectorAll('foreignObject, image')).toHaveLength(0);
  });

  it('matches both DFD dialects and independently filters specialized tools', () => {
    expect(templates.filter((template) => templateMatches(template, 'DFD', 'all'))).toHaveLength(2);
    expect(
      templates
        .filter((template) => templateMatches(template, '', 'simulation'))
        .map((template) => template.key),
    ).toEqual([
      'process-simulator-blank',
      'process-simulator',
      'delivery-network-simulator',
      'api-compute-capacity',
      'network-multi-site-capacity',
      'energy-power-capacity',
      'datacenter-capacity',
    ]);
    expect(templates.filter((template) => templateMatches(template, '', 'analytics'))).toHaveLength(
      1,
    );
    expect(
      templates
        .filter((template) => templateMatches(template, 'state machine', 'uml'))
        .map((template) => template.key),
    ).toEqual(['uml-state-machine']);
  });

  it('shows gateway conditions without an activity condition diamond and retains the default slash', () => {
    const { container } = render(<TemplatePreview templateKey="bpmn-process" />);
    const flows = container.querySelectorAll('[data-preview-relationship="sequence-flow"]');
    expect(flows[2].querySelector(':scope > path')).not.toHaveAttribute('marker-start');
    expect(flows[3].querySelectorAll(':scope > path')).toHaveLength(2);
  });

  it('uses two shared rails for conversation links rather than a single thick line', () => {
    const { container } = render(<TemplatePreview templateKey="bpmn-conversation" />);
    const links = container.querySelectorAll('[data-preview-relationship="conversation-link"]');
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.querySelector(':scope > path')).toHaveAttribute('stroke-width', '0');
      expect(link.querySelectorAll(':scope > path')).toHaveLength(3);
    }
  });

  it('lightly shades the non-initiating choreography participant bands', () => {
    const graph = createNotationGraph('bpmn-choreography', 'Participant preview')!;
    const { container } = render(<TemplatePreview templateKey="bpmn-choreography" />);
    const tasks = container.querySelectorAll('[data-preview-symbol="bpmn:choreography-task"]');
    expect(tasks).toHaveLength(2);
    const expected = graph.nodes.find((node) => node.notation?.symbol === 'choreography-task')!;
    const shading = notationGeometry(expected.notation!).shadedPaths;
    expect(shading?.length).toBeGreaterThan(0);
    for (const task of tasks) {
      const fill = task.querySelector('[data-preview-shading]');
      expect(fill).toHaveAttribute('d', shading![0]);
      expect(fill).toHaveAttribute('fill-opacity', '.12');
    }
  });

  it.each([
    ['uml-class', '«interface»'],
    ['uml-profile', '«stereotype»'],
    ['uml-deployment', '«executionEnvironment»'],
  ])('retains required UML keywords in the %s preview', (key, keyword) => {
    const { container } = render(<TemplatePreview templateKey={key} />);
    expect(container.querySelector('svg')).toHaveTextContent(keyword);
  });

  it('keeps a combined-fragment operator and guard distinct from its editable title', () => {
    const graph = createNotationGraph('uml-sequence', 'Fragment preview')!;
    const node = graph.nodes[0];
    node.title = 'Choose a payment route';
    node.width = 400;
    node.height = 220;
    node.notation = {
      collection: 'uml',
      symbol: 'combined-fragment',
      diagramKind: 'sequence',
      properties: { operator: 'alt', guard: 'payment ready' },
    };
    graph.nodes = [node];
    graph.edges = [];
    const create = vi.spyOn(notationExamples, 'createNotationGraph').mockReturnValueOnce(graph);
    try {
      const { container } = render(<TemplatePreview templateKey="uml-sequence" />);
      const preview = container.querySelector('[data-preview-symbol="uml:combined-fragment"]')!;
      expect(preview).toHaveTextContent('Choose a payment route');
      expect(preview).toHaveTextContent('alt');
      expect(preview.querySelector('[data-preview-guard]')).toHaveTextContent('[payment ready]');
      expect(preview.querySelector('[data-preview-guard]')).toHaveAttribute('clip-path');
    } finally {
      create.mockRestore();
    }
  });
});
