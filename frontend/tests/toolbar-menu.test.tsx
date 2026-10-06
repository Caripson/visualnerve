import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { blankGraph } from '../src/model/types';
import { parseSql } from '../src/sql/parser';
import { ToolbarDataTools } from '../src/components/ToolbarDataTools';
import { SqlQueryQualityChecks } from '../src/components/SqlQueryQualityChecks';

it('opens the explained data actions outside the scrolling toolbar and dismisses with Escape or outside click', () => {
  const open = vi.fn();
  const graph = blankGraph('Plain diagram');
  const { container } = render(
    <div style={{ overflowX: 'auto' }}>
      <ToolbarDataTools graph={graph} open={open} />
    </div>,
  );
  const trigger = screen.getByRole('button', { name: 'Explore data' });
  fireEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: 'Explore data menu' });
  expect(panel.parentElement).toBe(document.body);
  expect(container).not.toContainElement(panel);
  expect(panel).toHaveTextContent('Data behind this diagram');
  expect(panel).toHaveTextContent('CSV');
  expect(screen.getByRole('button', { name: 'Refresh source' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Data quality' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Data sources' }));
  expect(open).toHaveBeenCalledWith('sources');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps SQL schema refresh and structure checks available', () => {
  const graph = parseSql('CREATE TABLE customer (id INT PRIMARY KEY);').graph;
  render(<ToolbarDataTools graph={graph} open={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Explore data' }));
  expect(screen.getByRole('button', { name: 'Refresh source' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Data quality' })).toBeEnabled();
});

it('allows SELECT quality review and explains why source refresh is unavailable', () => {
  const graph = parseSql('SELECT b.id, b.name AS name, b.id AS name FROM business b;').graph;
  render(<ToolbarDataTools graph={graph} open={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Explore data' }));
  expect(screen.getByRole('button', { name: 'Refresh source' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Data quality' })).toBeEnabled();
  expect(screen.getByRole('dialog')).toHaveTextContent('SELECT diagrams support structure checks.');
});

it('reports duplicate output names and ambiguous references without claiming database verification', () => {
  const graph = parseSql(
    'SELECT id, b.name AS name, b.id AS name FROM business b JOIN customers c ON c.id = b.id;',
  ).graph;
  render(<SqlQueryQualityChecks graph={graph} />);
  expect(screen.getByRole('region', { name: 'SQL query quality checks' })).toHaveTextContent(
    'repeated output name',
  );
  expect(screen.getByRole('region', { name: 'SQL query quality checks' })).toHaveTextContent(
    'id: ambiguous',
  );
  expect(
    screen.getByText(/Database schemas, returned values and runtime correctness are not verified/),
  ).toBeVisible();
});
