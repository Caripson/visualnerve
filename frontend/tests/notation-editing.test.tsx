import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotationDraftInput } from '../src/notation/DraftInput';
import { NotationEdgeProperties, NotationNodeProperties } from '../src/notation/Controls';
import { createNotationGraph } from '../src/notation/templates';
import { notationGuard, notationPrefix } from '../src/notation/labels';
import { validateNotationGraph } from '../src/notation/validation';
import type { NodeNotation } from '../src/notation/types';

describe('semantic property editing', () => {
  it('retains required UML keywords independently of user stereotypes', () => {
    expect(notationPrefix({ collection: 'uml', symbol: 'interface' })).toBe('«interface»');
    expect(
      notationPrefix({
        collection: 'uml',
        symbol: 'interface',
        properties: { stereotype: 'service' },
      }),
    ).toBe('«interface» «service»');
    expect(notationPrefix({ collection: 'uml', symbol: 'class' })).toBeUndefined();
    expect(notationPrefix({ collection: 'uml', symbol: 'model' })).toBe('«model»');
    expect(notationPrefix({ collection: 'uml', symbol: 'profile' })).toBe('«profile»');
    expect(notationPrefix({ collection: 'uml', symbol: 'interaction-use' })).toBe('ref');
    expect(
      notationPrefix({
        collection: 'uml',
        symbol: 'combined-fragment',
        properties: { operator: 'par' },
      }),
    ).toBe('par');
    expect(notationPrefix({ collection: 'uml', symbol: 'combined-fragment' })).toBeUndefined();
    expect(
      notationGuard({
        collection: 'uml',
        symbol: 'combined-fragment',
        properties: { guard: 'ready' },
      }),
    ).toBe('[ready]');
    expect(
      notationGuard({
        collection: 'uml',
        symbol: 'combined-fragment',
        properties: { guard: '[ready]' },
      }),
    ).toBe('[ready]');
    expect(
      notationPrefix({
        collection: 'dfd-gane-sarson',
        symbol: 'process',
        properties: { number: '1.2' },
      }),
    ).toBe('1.2');
  });
  it('allows incomplete multiplicity typing and commits the complete value on Enter', () => {
    const commit = vi.fn();
    render(<NotationDraftInput label="Multiplicity" value="1" commit={commit} />);
    const field = screen.getByLabelText('Multiplicity');
    for (const value of ['0', '0.', '0..', '0..*']) fireEvent.change(field, { target: { value } });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(commit).toHaveBeenCalledWith('0..*');
  });
  it('keeps an invalid number local and supports escape without a mutation', () => {
    const commit = vi.fn();
    render(
      <NotationDraftInput
        label="Port position"
        type="number"
        min={0}
        max={1}
        step="any"
        value={0.5}
        commit={commit}
      />,
    );
    const field = screen.getByLabelText('Port position');
    fireEvent.change(field, { target: { value: '2' } });
    fireEvent.blur(field);
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect((field as HTMLInputElement).value).toBe('0.5');
    fireEvent.change(field, { target: { value: '0.25' } });
    fireEvent.blur(field);
    expect(commit).toHaveBeenCalledWith('0.25');
  });
  it('rejects an invalid multiplicity without changing the authoritative graph', () => {
    const graph = createNotationGraph('uml-class', 'Property fixture')!;
    const edge = graph.edges[0];
    const update = vi.fn();
    render(<NotationEdgeProperties graph={graph} edge={edge} update={update} />);
    const field = screen.getByLabelText('Notation sourceMultiplicity');
    fireEvent.change(field, { target: { value: '4..2' } });
    fireEvent.blur(field);
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('upper multiplicity');
    fireEvent.change(field, { target: { value: '0..*' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(update).toHaveBeenCalledWith({
      notation: { ...edge.notation, sourceMultiplicity: '0..*' },
    });
  });
  it('only offers named ports with the correct direction at each endpoint', () => {
    const graph = createNotationGraph('uml-class', 'Ports fixture')!;
    const edge = graph.edges[0],
      source = graph.nodes.find((node) => node.id === edge.sourceNodeId)!;
    source.notation!.ports = [
      { id: 'incoming', label: 'Incoming', side: 'left', direction: 'in' },
      { id: 'outgoing', label: 'Outgoing', side: 'right', direction: 'out' },
    ];
    render(<NotationEdgeProperties graph={graph} edge={edge} update={vi.fn()} />);
    const field = screen.getByLabelText('Notation sourcePort');
    expect(field.querySelector('option[value="outgoing"]')).toBeTruthy();
    expect(field.querySelector('option[value="incoming"]')).toBeNull();
  });
  it('keeps fixed IPO sections visible and rejects an incompatible overview switch', () => {
    const graph = createNotationGraph('hipo', 'IPO sections')!;
    const node = graph.nodes.find(
      (node) => node.notation?.symbol === 'ipo-chart' && node.notation.diagramKind === 'detail-ipo',
    )!;
    const update = vi.fn();
    render(<NotationNodeProperties graph={graph} node={node} update={update} />);
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
    expect(screen.getAllByLabelText(/Section \d+ entries/)).toHaveLength(4);
    // Both selectors define detail mode; removing it requires reviewing the fourth section first.
    const overview: NodeNotation = {
      collection: 'hipo',
      symbol: 'ipo-chart',
      diagramKind: 'overview-ipo',
      properties: { detail: 'overview' },
      compartments: node.notation!.compartments,
    };
    const invalid = {
      ...graph,
      nodes: graph.nodes.map((item) =>
        item.id === node.id ? { ...item, notation: overview } : item,
      ),
    };
    expect(() => validateNotationGraph(invalid)).toThrow(/compartment|section/i);
    expect(update).not.toHaveBeenCalled();
  });
});
