import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CodeSummary } from '../src/components/CodeSummary';
import {
  CodeObjectProperties,
  CodeRelationProperties,
  CodeAnalysisProperties,
} from '../src/components/CodeProperties';
import { blankGraph, newNode, newEdge } from '../src/model/types';

it('shows bounded card declarations and full source evidence in properties', () => {
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
  expect(screen.getByText('src/jobs.py:1')).toBeVisible();
  expect(screen.getByText('+4 more declarations')).toBeVisible();
  expect(screen.queryByText('job_9')).toBeNull();
  unmount();
  render(<CodeObjectProperties node={node} />);
  expect(screen.getByLabelText('Code object details')).toHaveTextContent('1–20');
  expect(screen.getByText('job_9')).toBeInTheDocument();
  expect(screen.getByText(/Original source is not stored/)).toBeVisible();
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
