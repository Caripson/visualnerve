import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { csvGraph, defaultAnalysis, parseCsv } from '../src/data/csv';
import { DataQualityDialog } from '../src/components/DataQualityDialog';
import { MeasureExplanationDialog } from '../src/components/MeasureExplanationDialog';

const dataset = parseCsv(
  'Id;Company;Amount\n1;123-AAA;10,50\n1;456-AAA;bad\n2;BBB;1,234',
  'transactions.csv',
);
const analysis = {
  ...defaultAnalysis(dataset),
  levels: ['c1'],
  metrics: [{ id: 'sum', operation: 'sum' as const, columnId: 'c2' }],
  columnRules: [{ columnId: 'c1', pattern: '^\\d+-', replacement: '' }],
};

it('lets users inspect cleanup collisions and explicitly selected duplicate identities', async () => {
  render(<DataQualityDialog graph={csvGraph(dataset, analysis)} onClose={() => {}} />);
  fireEvent.click(
    await screen.findByRole('button', { name: /different originals merged by cleanup/ }),
  );
  const table = await screen.findByRole('table', { name: 'Evidence rows' });
  expect(within(table).getAllByText('AAA')).toHaveLength(2);
  fireEvent.click(screen.getByLabelText('Show original cells'));
  expect(within(table).getByText('123-AAA')).toBeInTheDocument();
  expect(within(table).getByText('456-AAA')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Identity key Id'));
  const duplicates = await screen.findByRole('button', {
    name: /Rows sharing the selected identity keys/,
  });
  expect(duplicates).toHaveTextContent('2 rows');
  fireEvent.click(duplicates);
  await waitFor(() =>
    expect(screen.getByRole('table', { name: 'Evidence rows' })).toHaveTextContent('123-AAA'),
  );
});
it('explains a grouped amount and lets users inspect excluded original rows', async () => {
  render(
    <MeasureExplanationDialog
      dataset={dataset}
      analysis={analysis}
      path={[{ columnId: 'c1', value: 'AAA' }]}
      metricId="sum"
      onClose={() => {}}
    />,
  );
  expect(await screen.findByRole('heading', { name: /Sum · Amount: 10.5/ })).toBeInTheDocument();
  expect(screen.getByText(/2 matching rows · 1 contributing · 1 excluded/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Measure evidence rows'), {
    target: { value: 'excluded' },
  });
  const table = await screen.findByRole('table', { name: 'Evidence rows' });
  expect(within(table).getByText('bad')).toBeInTheDocument();
  expect(within(table).getByText('invalid')).toBeInTheDocument();
  expect(within(table).queryByText('10,50')).not.toBeInTheDocument();
});
