import { describe, expect, it } from 'vitest';
import { extractSpecialCode } from '../src/code/special';
import { codeLimits, type CodeLanguage } from '../src/code/types';

const fixtures: {
  language: CodeLanguage;
  content: string;
  names: string[];
  target: string;
  kind: string;
}[] = [
  {
    language: 'sql',
    content:
      'CREATE TABLE orders (id int); SELECT o.id FROM sales.orders o JOIN customers c ON c.id=o.id;',
    names: ['orders', 'Query 1'],
    target: 'sales.orders',
    kind: 'reads',
  },
  {
    language: 'tsql',
    content: 'CREATE PROCEDURE dbo.Load AS BEGIN SELECT id FROM dbo.orders; EXEC dbo.Refresh; END;',
    names: ['dbo.Load', 'Query 1'],
    target: 'dbo.Refresh',
    kind: 'calls',
  },
  {
    language: 'plsql',
    content:
      'CREATE OR REPLACE PACKAGE BODY billing AS\n PROCEDURE charge IS BEGIN SELECT id INTO v FROM customers; CALL audit; END; END;',
    names: ['billing', 'charge', 'Query 1'],
    target: 'customers',
    kind: 'reads',
  },
  {
    language: 'dax',
    content: "Revenue = SUM('Sales'[Amount])\nMargin = [Revenue] - SUM(Cost[Amount])",
    names: ['Revenue', 'Margin'],
    target: 'Revenue',
    kind: 'references',
  },
  {
    language: 'powerquery',
    content:
      'let\n Source = Excel.CurrentWorkbook(),\n #"Changed Type" = Table.TransformColumnTypes(Source, {{"Amount", type number}}),\n Result = Table.SelectRows(#"Changed Type", each [Amount] > 0)\nin Result',
    names: ['Source', 'Changed Type', 'Result'],
    target: 'Changed Type',
    kind: 'depends-on',
  },
  {
    language: 'graphql',
    content:
      'interface Named { name: String! }\ntype Customer implements Named { name: String! orders: [Order!]! }\ntype Order { id: ID! }\nquery Customers { customers { ...CustomerInfo } }\nfragment CustomerInfo on Customer { name }',
    names: ['Named', 'Customer', 'Order', 'Customers', 'CustomerInfo'],
    target: 'Order',
    kind: 'references',
  },
  {
    language: 'mdx',
    content:
      'WITH MEMBER [Measures].[Margin] AS [Measures].[Revenue] - [Measures].[Cost]\nSELECT [Measures].[Margin] ON COLUMNS FROM [Sales]',
    names: ['Measures.Margin', 'MDX query'],
    target: 'Sales',
    kind: 'reads',
  },
  {
    language: 'cypher',
    content: 'MATCH (c:Customer)-[:PLACED]->(o:Order) RETURN c.name\nCALL db.labels()',
    names: ['Graph query', 'Customer', 'PLACED', 'Order'],
    target: 'db.labels',
    kind: 'calls',
  },
  {
    language: 'vega',
    content: JSON.stringify({
      data: [{ name: 'orders' }, { name: 'filtered', source: 'orders' }],
      marks: [{ name: 'bars', type: 'rect', from: { data: 'filtered' } }],
    }),
    names: ['Visualization', 'orders', 'filtered', 'bars'],
    target: 'filtered',
    kind: 'reads',
  },
  {
    language: 'hcl',
    content:
      'variable "region" {}\nresource "aws_s3_bucket" "logs" { region = var.region }\noutput "name" { value = aws_s3_bucket.logs.id }',
    names: ['var.region', 'aws_s3_bucket.logs', 'output.name'],
    target: 'aws_s3_bucket.logs',
    kind: 'depends-on',
  },
  {
    language: 'nix',
    content:
      '{ pkgs, ... }: let base = import ./base.nix; app = pkgs.callPackage ./app.nix {}; in { result = app; }',
    names: ['base', 'app', 'result'],
    target: './base.nix',
    kind: 'imports',
  },
  {
    language: 'sas',
    content: '%macro summarize();\ndata work.result; set work.source; run;\n%mend;\n%summarize()',
    names: ['summarize', 'work.result'],
    target: 'work.source',
    kind: 'reads',
  },
  {
    language: 'abap',
    content:
      'REPORT analysis.\nCLASS lcl_report DEFINITION INHERITING FROM base_report.\nENDCLASS.\nFORM show.\nPERFORM load.\nSELECT * FROM customers INTO TABLE result.\nENDFORM.',
    names: ['analysis', 'lcl_report', 'show'],
    target: 'load',
    kind: 'calls',
  },
  {
    language: 'cobol',
    content:
      '       PROGRAM-ID. BILLING.\n       PROCEDURE DIVISION.\n       MAIN SECTION.\n           PERFORM LOAD-DATA\n           CALL "AUDIT"\n           READ CUSTOMER-FILE.\n       LOAD-DATA.\n           GOBACK.',
    names: ['BILLING', 'MAIN', 'LOAD-DATA'],
    target: 'AUDIT',
    kind: 'calls',
  },
  {
    language: 'assembly',
    content: 'global start\nstart:\n call load_data\n jmp finish\nload_data:\n ret\nfinish:\n ret',
    names: ['start', 'load_data', 'finish'],
    target: 'load_data',
    kind: 'calls',
  },
];

describe('specialized language outlines', () => {
  for (const fixture of fixtures)
    it(`extracts connected ${fixture.language} identifiers and locations`, () => {
      const result = extractSpecialCode(fixture.content, fixture.language);
      const names = result.symbols.map((symbol) => symbol.name);
      expect(names).toEqual(expect.arrayContaining(fixture.names));
      expect(result.dependencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target: fixture.target,
            kind: fixture.kind,
            line: expect.any(Number),
          }),
        ]),
      );
      expect(result.symbols.every((symbol) => symbol.line >= 1)).toBe(true);
      expect(
        result.dependencies.every((dependency) =>
          ['syntax', 'heuristic', 'unresolved'].includes(dependency.confidence),
        ),
      ).toBe(true);
    });

  it('connects GraphQL operations to schema fields and anonymous query selections', () => {
    const result = extractSpecialCode(
      'type Query { customers(limit: Int): [Customer] }\ntype Customer { id: ID }\nquery List { alias: customers(limit: 5) { id } }',
      'graphql',
    );
    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Query.customers', kind: 'variable' }),
      ]),
    );
    expect(result.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'Query.customers', kind: 'reads' }),
        expect.objectContaining({ target: 'Customer', kind: 'references' }),
      ]),
    );
    for (const content of ['{ customers { id } }', 'query { customers { id } }'])
      expect(extractSpecialCode(content, 'graphql').dependencies).toEqual(
        expect.arrayContaining([expect.objectContaining({ target: 'Query.customers' })]),
      );
    const union = extractSpecialCode('union Result = Cat | Dog', 'graphql');
    expect(union.dependencies.map((dependency) => dependency.target)).toEqual(['Cat', 'Dog']);
  });

  it('retains SQL quoted identifiers while removing values and commented statements', () => {
    const result = extractSpecialCode(
      '-- SELECT id FROM fake;\nSELECT \'SECRET FROM leaked\', id FROM /* source */ "sales"."orders" JOIN [dbo].[customers] ON 1=1;',
      'sql',
    );
    expect(result.dependencies.map((dependency) => dependency.target)).toEqual([
      'sales.orders',
      'dbo.customers',
    ]);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('leaked');
  });

  it('ignores commented definitions and references across unusual comment syntaxes', () => {
    for (const [language, content] of [
      ['graphql', '# type Fake { bogus: Secret }\ntype Real { id: ID }'],
      ['hcl', '# resource "secret" "fake" { x = secret.leak }\nresource "real" "thing" {}'],
      ['abap', '* FORM Fake.\nREPORT real. " PERFORM SECRET'],
      ['cobol', '      * PROGRAM-ID. SECRET.\n       PROGRAM-ID. REAL.'],
      ['assembly', '; fake:\nreal: ; call SECRET'],
      ['sas', '* data secret;\ndata real;\n%* set secret;\nrun;'],
    ] as const) {
      const result = extractSpecialCode(content, language);
      expect(JSON.stringify(result)).not.toMatch(/SECRET|Fake|fake|leak|secret/);
    }
  });

  it('does not persist connector literals, inline data or module URLs', () => {
    const cases: [CodeLanguage, string][] = [
      ['powerquery', 'let Source = Sql.Database("SECRET_SERVER", "SECRET_DATABASE") in Source'],
      ['hcl', 'module "app" { source = "git::https://SECRET:token@example.com/repo" }'],
      [
        'vega',
        JSON.stringify({
          data: {
            name: 'rows',
            url: 'https://SECRET:token@example.com/data',
            values: [{ password: 'SECRET' }],
          },
          mark: 'bar',
        }),
      ],
      ['dax', 'Revenue = IF([Amount] > 0, "SECRET", "other")'],
    ];
    for (const [language, content] of cases)
      expect(JSON.stringify(extractSpecialCode(content, language))).not.toContain('SECRET');
  });

  it('recognizes declarations separately from values, includes and quoted step functions', () => {
    const dax = extractSpecialCode("DEFINE MEASURE 'Sales'[Revenue] = SUM('Sales'[Amount])", 'dax');
    expect(dax.dependencies.filter((dependency) => dependency.target === 'Sales')).toHaveLength(1);
    const m = extractSpecialCode(
      'let Fn = (value) => value, Result = Fn(1) in Result',
      'powerquery',
    );
    expect(m.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Fn', kind: 'function' })]),
    );
    const asm = extractSpecialCode('%include "helpers.inc"\nstart: call helper', 'assembly');
    expect(asm.dependencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: 'helpers.inc', kind: 'imports' })]),
    );
    const cobol = extractSpecialCode('PROGRAM-ID. MAIN.\nCOPY "record.cpy".', 'cobol');
    expect(cobol.dependencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: 'record.cpy', kind: 'imports' })]),
    );
  });

  it('does not confuse ABAP inheritance with a database FROM clause', () => {
    const result = extractSpecialCode(
      'CLASS report DEFINITION INHERITING FROM base.\nMETHODS load.\nENDCLASS.',
      'abap',
    );
    expect(result.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'load', kind: 'function' })]),
    );
    expect(result.dependencies.filter((dependency) => dependency.target === 'base')).toEqual([
      expect.objectContaining({ kind: 'inherits' }),
    ]);
  });

  it('reports unsupported dynamic behavior and invalid Vega explicitly', () => {
    expect(extractSpecialCode('EXECUTE IMMEDIATE sql_text;', 'plsql').warnings.join(' ')).toContain(
      'Dynamic SQL',
    );
    expect(extractSpecialCode('start:\ncall rax', 'assembly').warnings.join(' ')).toContain(
      'Indirect',
    );
    expect(extractSpecialCode('{ "data":', 'vega').warnings.join(' ')).toContain('not valid JSON');
  });

  it('rejects overlong lines and excessive symbols explicitly', () => {
    expect(() =>
      extractSpecialCode(
        `${'x'.repeat(codeLimits.lineLength + 1)}\nSELECT id FROM real_table;`,
        'sql',
      ),
    ).toThrow('line limit');
    expect(() =>
      extractSpecialCode('SELECT id FROM real_table;\n'.repeat(codeLimits.symbols + 1), 'sql'),
    ).toThrow(/symbol|query limit/);
  });

  it('connects local HCL module imports and Vega-Lite lookup datasets', () => {
    const hcl = extractSpecialCode('module "app" { source = "./modules/app" }', 'hcl');
    expect(hcl.dependencies).toEqual([
      expect.objectContaining({ target: './modules/app', kind: 'imports', targetType: 'module' }),
    ]);
    const vega = extractSpecialCode(
      JSON.stringify({
        data: { name: 'orders' },
        transform: [{ lookup: 'id', from: { data: { name: 'customers' }, key: 'id' } }],
        mark: 'bar',
      }),
      'vega',
    );
    expect(vega.dependencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: 'customers', kind: 'reads' })]),
    );
  });
});
