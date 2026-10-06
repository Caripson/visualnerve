import { expect, it } from 'vitest';
import { parseCode } from '../src/code/analyzer';
import { getCodeObject, getCodeRelation } from '../src/code/schema';
import type { CodeLanguage } from '../src/code/types';
import type { Graph } from '../src/model/types';

const object = (graph: Graph, name: string) =>
  graph.nodes.find((node) => getCodeObject(node)?.name === name && !getCodeObject(node)?.external)!;
const connects = (graph: Graph, source: string, target: string, kind: string) => {
  const first = object(graph, source);
  const second = object(graph, target);
  return (
    !!first &&
    !!second &&
    graph.edges.some(
      (edge) =>
        edge.sourceNodeId === first.id &&
        edge.targetNodeId === second.id &&
        getCodeRelation(edge)?.kind === kind,
    )
  );
};

it.each(['csharp', 'cpp'] as const)(
  'keeps class and call ownership with %s Allman braces',
  (language) => {
    const graph = parseCode({
      mode: 'symbols',
      files: [
        {
          path: `orders.${language === 'cpp' ? 'cpp' : 'cs'}`,
          language,
          content:
            language === 'cpp'
              ? 'class Orders\n{\npublic:\n void Run()\n {\n  Save();\n }\n void Save()\n {\n }\n};'
              : 'public class Orders\n{\n public void Run()\n {\n  Save();\n }\n public void Save()\n {\n }\n}',
        },
      ],
    }).graph;
    expect(connects(graph, 'Orders', 'Run', 'contains')).toBe(true);
    expect(connects(graph, 'Run', 'Save', 'calls')).toBe(true);
  },
);

it('keeps a multiline Python header attached to its indented body', () => {
  const graph = parseCode({
    mode: 'symbols',
    files: [
      {
        path: 'tasks.py',
        content:
          'def calculate():\n    return 42\n\ndef run(\n    input,\n):\n    return calculate()\n',
      },
    ],
  }).graph;
  expect(connects(graph, 'run', 'calculate', 'calls')).toBe(true);
  expect(getCodeObject(object(graph, 'run'))?.endLine).toBeGreaterThanOrEqual(7);
});

it.each([
  ['javascript', 'function run() { return /FAKE_SECRET_CALL()/.test(input); }'],
  [
    'shell',
    "function run() {\ncat <<'EOF'\nfunction FAKE_SECRET_DECL() { FAKE_SECRET_CALL(); }\nEOF\n}",
  ],
  ['lua', 'function run()\n local payload = [[FAKE_SECRET_CALL()]]\nend'],
  ['ruby', 'def run\n payload = %q{FAKE_SECRET_CALL()}\nend'],
  ['perl', 'sub run { my $payload = q{FAKE_SECRET_CALL()}; }'],
  ['cpp', 'void run() { auto text = R"tag(quote " FAKE_SECRET_CALL() )tag"; }'],
  ['rust', 'fn run() { let text = r#"quote " FAKE_SECRET_CALL() "#; }'],
] satisfies [CodeLanguage, string][])(
  'omits %s nonstandard literal contents from structure and persisted metadata',
  (language, content) => {
    const graph = parseCode({
      mode: 'symbols',
      files: [{ path: 'source.txt', language, content }],
    }).graph;
    expect(JSON.stringify(graph)).not.toContain('FAKE_SECRET_CALL');
    expect(JSON.stringify(graph)).not.toContain('FAKE_SECRET_DECL');
  },
);

it('links Terraform files in one module without explicit imports', () => {
  const graph = parseCode({
    mode: 'symbols',
    files: [
      { path: 'infra/network.tf', content: 'resource "aws_vpc" "main" {}' },
      {
        path: 'infra/app.tf',
        content: 'resource "aws_instance" "app" {\n subnet_id = aws_vpc.main.id\n}',
      },
    ],
  }).graph;
  expect(connects(graph, 'aws_instance.app', 'aws_vpc.main', 'depends-on')).toBe(true);
  expect(
    graph.nodes.some(
      (node) => getCodeObject(node)?.external && getCodeObject(node)?.name === 'aws_vpc.main',
    ),
  ).toBe(false);
});

it('keeps separate Terraform module resource names unresolved', () => {
  const graph = parseCode({
    mode: 'symbols',
    files: [
      {
        path: 'root/main.tf',
        content: 'resource "aws_instance" "app" {\n subnet_id = aws_vpc.main.id\n}',
      },
      { path: 'modules/network/main.tf', content: 'resource "aws_vpc" "main" {}' },
    ],
  }).graph;
  expect(connects(graph, 'aws_instance.app', 'aws_vpc.main', 'depends-on')).toBe(false);
  expect(
    graph.nodes.some(
      (node) => getCodeObject(node)?.external && getCodeObject(node)?.name === 'aws_vpc.main',
    ),
  ).toBe(true);
});

it('connects declared GraphQL types split across schema files', () => {
  const graph = parseCode({
    mode: 'symbols',
    files: [
      { path: 'schema/user.graphql', content: 'type User { id: ID! }' },
      { path: 'schema/query.graphql', content: 'type Query { user: User }' },
    ],
  }).graph;
  expect(connects(graph, 'Query', 'Query.user', 'contains')).toBe(true);
  expect(connects(graph, 'Query.user', 'User', 'references')).toBe(true);
});
