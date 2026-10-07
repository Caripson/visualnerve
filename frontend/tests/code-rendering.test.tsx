import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CodeSummary } from '../src/components/CodeSummary';
import {
  CodeObjectProperties,
  CodeRelationProperties,
  CodeAnalysisProperties,
} from '../src/components/CodeProperties';
import { blankGraph, newNode, newEdge } from '../src/model/types';

it('keeps every retained declaration and source line range readable on the card and in properties', () => {
  const graph = blankGraph('Project');
  const node = newNode(graph.diagram.id, {
    metadata: {
      codeObject: {
        version: 1,
        language: 'python',
        path: 'src/jobs.py',
        name: 'jobs',
        kind: 'file',
        line: 1,
        endLine: 20,
        summary: Array.from({ length: 10 }, (_, i) => `job_${i}`),
      },
    },
  });
  const { unmount } = render(<CodeSummary node={node} />);
  expect(screen.getByText('Python · file')).toBeVisible();
  expect(screen.getByText('src/jobs.py:1–20')).toBeVisible();
  const details = screen.getByRole('region', { name: `Code details for ${node.title}` });
  expect(details).toHaveClass('nodrag', 'nopan', 'nowheel');
  expect(details).toHaveAttribute('data-node-scroll');
  expect(details).toHaveAttribute('tabindex', '0');
  expect(screen.getByLabelText('Declarations').children).toHaveLength(10);
  expect(screen.getByText('job_9')).toBeVisible();
  expect(screen.getByText('10 declarations')).toBeVisible();
  expect(screen.getByText('Select to resize')).toBeVisible();
  unmount();
  render(<CodeObjectProperties node={node} />);
  expect(screen.getByLabelText('Code object details')).toHaveTextContent('1–20');
  expect(screen.getByText('job_9')).toBeInTheDocument();
  expect(screen.getByText(/Original source is not stored/)).toBeVisible();
});
it('preserves the full analyzed symbol name after renaming and keeps captures free of resize instructions', () => {
  const node = newNode('diagram', {
    title: 'Readable label',
    metadata: {
      codeObject: {
        version: 1,
        language: 'cobol',
        path: 'accounting/salary-reports/employee-salary-processor.cbl',
        name: '200-PROCESS-DATA-WITH-A-LONG-ORIGINAL-NAME',
        kind: 'function',
        line: 32,
        endLine: 55,
      },
    },
  });
  const { rerender } = render(<CodeSummary node={node} selected />);
  expect(screen.getByText(/200-PROCESS-DATA-WITH-A-LONG-ORIGINAL-NAME/)).toBeVisible();
  expect(screen.getByText('Drag a corner to resize')).toBeVisible();
  rerender(<CodeSummary node={node} selected exporting />);
  expect(
    screen.getByRole('region', { name: 'Code details for Readable label' }),
  ).not.toHaveAttribute('tabindex');
  expect(screen.queryByText('Drag a corner to resize')).toBeNull();
  expect(screen.getByText(/200-PROCESS-DATA-WITH-A-LONG-ORIGINAL-NAME/)).toBeVisible();
});
it('reserves navigation keys for reading while allowing Tab to leave the card', () => {
  const onKeyDown = vi.fn();
  const node = newNode('diagram', {
    metadata: {
      codeObject: { version: 1, language: 'python', path: 'jobs.py', name: 'jobs', kind: 'file' },
    },
  });
  render(
    <div onKeyDown={onKeyDown}>
      <CodeSummary node={node} />
    </div>,
  );
  const details = screen.getByRole('region', { name: `Code details for ${node.title}` });
  for (const key of ['ArrowDown', 'ArrowLeft', 'PageDown', 'Home', 'End', ' '])
    fireEvent.keyDown(details, { key });
  expect(onKeyDown).not.toHaveBeenCalled();
  fireEvent.keyDown(details, { key: 'Tab' });
  expect(onKeyDown).toHaveBeenCalledOnce();
});
it('explains inferred versus unresolved connections and saved analysis notes', () => {
  const graph = blankGraph('Project');
  graph.diagram.metadata.codeAnalysis = {
    version: 1,
    languages: ['python', 'hcl'],
    mode: 'symbols',
    fileCount: 2,
    symbolCount: 4,
    dependencyCount: 3,
    unresolvedCount: 1,
    warnings: ['Check dynamic imports.'],
    focus: 'worker',
  };
  const edge = newEdge(graph.diagram.id, 'one', 'two', {
    metadata: {
      codeRelation: {
        version: 1,
        kind: 'calls',
        confidence: 'heuristic',
        evidence: { path: 'src/jobs.py', line: 14 },
      },
    },
  });
  render(
    <>
      <CodeRelationProperties edge={edge} />
      <CodeAnalysisProperties graph={graph} />
    </>,
  );
  expect(screen.getByLabelText('Code connection details')).toHaveTextContent('Inferred');
  expect(screen.getByLabelText('Code connection details')).toHaveTextContent('src/jobs.py:14');
  expect(screen.getByLabelText('Code analysis details')).toHaveTextContent('Python, HCL');
  expect(screen.getByLabelText('Code analysis details')).toHaveTextContent('focus: worker');
});
