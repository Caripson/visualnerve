import { describe, expect, it } from 'vitest';
import { extractProgramCode } from '../src/code/program';
import { codeLanguages, detectCodeLanguage, supportedCodeFile } from '../src/code/catalog';
import { codeLanguageIds, type CodeLanguage } from '../src/code/types';
import { maskCode } from '../src/code/lex';

const samples: Array<[CodeLanguage, string]> = [
  ['python', 'import math\ndef helper():\n    return 1\ndef run():\n    helper()'],
  [
    'javascript',
    'import { x } from "./util.js";\nfunction helper() { return 1; }\nfunction run() { helper(); }',
  ],
  [
    'typescript',
    'import { x } from "./util";\nfunction helper(): number { return 1; }\nexport function run(): void { helper(); }',
  ],
  [
    'java',
    'import util.Math;\nclass Demo {\n  public void helper() {}\n  public void run() { helper(); }\n}',
  ],
  [
    'csharp',
    'using System;\nclass Demo {\n public void helper() {}\n public void run() { helper(); }\n}',
  ],
  ['cpp', '#include "util.h"\nint helper() { return 1; }\nint run() { return helper(); }'],
  ['c', '#include "util.h"\nint helper() { return 1; }\nint run() { return helper(); }'],
  ['go', 'import "fmt"\nfunc helper() {}\nfunc run() { helper() }'],
  ['rust', 'use util::Math;\nfn helper() {}\nfn run() { helper(); }'],
  ['php', '<?php\nrequire "util.php";\nfunction helper() {}\nfunction run() { helper(); }'],
  ['kotlin', 'import util.Math\nfun helper() {}\nfun run() { helper() }'],
  ['swift', 'import Foundation\nfunc helper() {}\nfunc run() { helper() }'],
  ['shell', 'source ./util.sh\nhelper() {\n echo ok\n}\nrun() {\n helper\n}'],
  ['r', 'library(stats)\nhelper <- function() { 1 }\nrun <- function() { helper() }'],
  ['dart', 'import "util.dart";\nvoid helper() {}\nvoid run() { helper(); }'],
  ['ruby', 'require "util"\ndef helper\n 1\nend\ndef run\n helper\nend'],
  ['powershell', 'Import-Module Utility\nfunction helper { }\nfunction run {\n helper\n}'],
  ['vba', 'Sub helper()\nEnd Sub\nSub run()\n Call helper\nEnd Sub'],
  ['scala', 'import util.Math\ndef helper(): Unit = {}\ndef run(): Unit = { helper() }'],
  ['lua', 'local util = require("util")\nfunction helper()\nend\nfunction run()\n helper()\nend'],
  ['matlab', 'function helper()\nend\nfunction run()\n helper()\nend'],
  [
    'objective-c',
    '#import "util.h"\n@interface Demo : Base\n@end\n@implementation Demo\n- (void)helper { }\n- (void)run { [self helper]; }\n@end',
  ],
  ['perl', 'use Utility;\nsub helper { }\nsub run { helper(); }'],
  ['groovy', 'import util.Math\ndef helper() {}\ndef run() { helper() }'],
  ['vbnet', 'Imports System\nSub helper()\nEnd Sub\nSub run()\n helper()\nEnd Sub'],
  ['julia', 'using Statistics\nfunction helper()\nend\nfunction run()\n helper()\nend'],
  [
    'elixir',
    'alias Utility\ndefmodule Demo do\n def helper(), do: 1\n def run(), do: helper()\nend',
  ],
  [
    'solidity',
    'import "./Util.sol";\ncontract Demo {\n function helper() public {}\n function run() public { helper(); }\n}',
  ],
  ['haskell', 'import Data.List\nhelper x = x\nrun x = helper x'],
  ['fsharp', 'open System\nlet helper x = x\nlet run x = helper x'],
  ['clojure', '(ns demo (:require [util :as util]))\n(defn helper [] 1)\n(defn run [] (helper))'],
  ['apex', 'class Demo {\n public void helper() {}\n public void run() { helper(); }\n}'],
  [
    'fortran',
    'use utility\nsubroutine helper()\nend subroutine helper\nsubroutine run()\n call helper()\nend subroutine run',
  ],
  [
    'pascal',
    'uses Utility;\nprocedure helper;\nbegin\nend;\nprocedure run;\nbegin\n helper;\nend;',
  ],
  [
    'gdscript',
    'var util = preload("res://util.gd")\nfunc helper():\n pass\nfunc run():\n helper()',
  ],
];

describe('Code language catalog and modular program analyzers', () => {
  it('contains each requested language once, in the supplied order', () => {
    expect(codeLanguages.map((language) => language.id)).toEqual([...codeLanguageIds]);
    expect(new Set(codeLanguages.map((language) => language.id)).size).toBe(codeLanguageIds.length);
  });
  it('requires explicit choices for ambiguous extensions', () => {
    for (const path of ['helper.m', 'helper.h', 'helper.cls']) {
      expect(detectCodeLanguage(path)).toBeUndefined();
      expect(supportedCodeFile(path)).toBe(true);
    }
    expect(detectCodeLanguage('src/main.ts')).toBe('typescript');
    expect(detectCodeLanguage('chart.vega.json')).toBe('vega');
    expect(supportedCodeFile('secret.txt')).toBe(false);
  });
  it.each(samples)('extracts actual declarations and dependencies for %s', (language, content) => {
    const result = extractProgramCode(content, language);
    expect(
      result.symbols.some((symbol) => symbol.name === 'helper'),
      JSON.stringify(result),
    ).toBe(true);
    expect(
      result.symbols.some((symbol) => symbol.name === 'run'),
      JSON.stringify(result),
    ).toBe(true);
    expect(
      result.dependencies.some(
        (dependency) =>
          dependency.target === 'helper' && ['calls', 'references'].includes(dependency.kind),
      ),
      JSON.stringify(result),
    ).toBe(true);
  });
  it('masks comments and literal calls while preserving source offsets', () => {
    const source =
      '// fake()\nfunction real() { const text = "secretCall()"; helper(); }\n/* nope() */';
    const masked = maskCode(source, 'javascript');
    expect(masked.length).toBe(source.length);
    expect(masked.split('\n')).toHaveLength(3);
    expect(masked).not.toContain('fake');
    expect(masked).not.toContain('secretCall');
    expect(masked).not.toContain('nope');
    expect(
      extractProgramCode(source, 'javascript').dependencies.map((entry) => entry.target),
    ).toEqual(['helper']);
  });
  it('ignores nested multiline Lua comments and strings', () => {
    expect(
      extractProgramCode(
        '--[[ function fake()\n bad() ]]\nfunction real()\nend',
        'lua',
      ).symbols.map((symbol) => symbol.name),
    ).toEqual(['real']);
  });
});

describe('Language-specific lexical boundaries', () => {
  it('preserves Rust lifetimes while masking character literals and nested comments', () => {
    const source =
      "fn helper<'a>(value: &'a str) { }\n/* outer /* inner */ fake() */\nfn run<'a>() { let ch = 'x'; helper(); }";
    const result = extractProgramCode(source, 'rust');
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(['helper', 'run']);
    expect(result.dependencies.map((entry) => entry.target)).toEqual(['helper']);
  });
  it('distinguishes MATLAB quoted text from transpose operators', () => {
    const source = "function run()\nx = 'fake()';\ny = x';\nhelper();\nend";
    expect(extractProgramCode(source, 'matlab').dependencies.map((entry) => entry.target)).toEqual([
      'helper',
    ]);
    expect(maskCode(source, 'matlab')).toContain("y = x'");
  });
  it('masks JavaScript regular-expression literals without erasing division expressions', () => {
    const source = 'function run() { const pattern = /fake()/g; const n = a / b; helper(); }';
    const result = extractProgramCode(source, 'javascript');
    expect(result.dependencies.map((entry) => entry.target)).toEqual(['helper']);
    expect(maskCode(source, 'javascript')).toContain('a / b');
  });
  it('keeps Nix identifier apostrophes and erases indented string bodies', () => {
    const source = "let foo' = bar; script = ''fake()''; in foo'";
    expect(maskCode(source, 'nix')).toContain("foo' = bar");
    expect(maskCode(source, 'nix')).not.toContain('fake');
  });
  it('can preserve SQL quoted identifiers while masking literal values', () => {
    const source = 'SELECT "safe" FROM "sales"."orders" WHERE secret = \'PASSWORD\'';
    const masked = maskCode(source, 'sql', { quotedIdentifiers: true });
    expect(masked).toContain('"sales"."orders"');
    expect(masked).not.toContain('PASSWORD');
  });
  it('recognizes a multiline import and a function whose body opens on a following line', () => {
    const source =
      'import {\n helper\n} from "./util";\nfunction run(\n value: number\n)\n{\n helper();\n}';
    const result = extractProgramCode(source, 'typescript');
    expect(result.symbols).toMatchObject([{ name: 'run', line: 4, endLine: 9 }]);
    expect(result.dependencies).toMatchObject([
      { target: './util', kind: 'imports', line: 1 },
      { target: './util::helper', source: '4:run', line: 8 },
    ]);
  });
});

describe('Opaque blocks do not become program objects', () => {
  it.each([
    ['julia', '#= function fake()\n#= inner =#\nfake() =#\nfunction real()\nend'],
    ['ruby', '=begin\ndef fake\n fake()\nend\n=end\ndef real\nend'],
    ['ruby', 'text = %q{def fake; fake() }\ndef real\nend'],
    ['ruby', 'text = <<~BODY\ndef fake\n fake()\nBODY\ndef real\nend'],
    ['lua', 'local text = [=[ function fake()\n fake() ]=]\nfunction real()\nend'],
    ['lua', '--[=[ function fake()\n fake() ]=]\nfunction real()\nend'],
    ['matlab', '%{\nfunction fake()\n fake()\n%}\nfunction real()\nend'],
    ['shell', 'cat <<EOF\nfake() {\n fake\n}\nEOF\nreal() {\n}\n'],
    ['powershell', "$text = @'\nfunction fake { fake() }\n'@\nfunction real { }"],
    ['fortran', 'C fake()\n* subroutine fake()\nsubroutine real()\nend subroutine real'],
  ] as Array<[CodeLanguage, string]>)('ignores %s opaque block source', (language, source) => {
    const result = extractProgramCode(source, language);
    expect(result.symbols.some((symbol) => symbol.name === 'real')).toBe(true);
    expect(result.symbols.some((symbol) => symbol.name === 'fake')).toBe(false);
    expect(result.dependencies.some((entry) => entry.target === 'fake')).toBe(false);
  });
  it('keeps a Python multiline definition as owner after its closing parenthesis', () => {
    const result = extractProgramCode('def run(\n x,\n):\n return calculate()', 'python');
    expect(result.symbols).toMatchObject([{ name: 'run', line: 1, endLine: 4 }]);
    expect(result.dependencies).toMatchObject([{ target: 'calculate', source: '1:run', line: 4 }]);
  });
});

it('recognizes public Rust functions and C header prototypes as declarations', () => {
  expect(
    extractProgramCode('pub fn helper() {}\npub(crate) fn run() { helper(); }', 'rust').symbols.map(
      (symbol) => symbol.name,
    ),
  ).toEqual(['helper', 'run']);
  expect(extractProgramCode('void helper();', 'c').symbols).toMatchObject([
    { name: 'helper', kind: 'function', endLine: 1 },
  ]);
});

it.each([
  ['sql', 'SELECT $$ SELECT fake FROM FAKE_SECRET_TABLE $$; SELECT * FROM real_table;'],
  ['sql', 'SELECT $body$ SELECT fake FROM FAKE_SECRET_TABLE $body$; SELECT * FROM real_table;'],
  ['plsql', "SELECT q'[ quote ' SELECT fake FROM FAKE_SECRET_TABLE ]' FROM real_table;"],
  ['plsql', "SELECT q'! quote ' SELECT fake FROM FAKE_SECRET_TABLE !' FROM real_table;"],
  ['php', 'function run() {\n $text = <<<BODY\n" FAKE_SECRET_CALL()\nBODY;\n helper();\n}'],
  ['php', "function run() {\n $text = <<<'BODY'\n\" FAKE_SECRET_CALL()\nBODY;\n helper();\n}"],
  ['swift', 'func run() { let text = #" quote " FAKE_SECRET_CALL() "#; helper(); }'],
  ['swift', 'func run() { let text = ##""" quote " FAKE_SECRET_CALL() """##; helper(); }'],
  [
    'ruby',
    'def run\n pattern = /FAKE_SECRET_CALL()/\n return /FAKE_SECRET_CALL()/\n helper()\nend',
  ],
  ['perl', 'sub run { $pattern =~ /FAKE_SECRET_CALL()/; helper(); }'],
] as Array<[CodeLanguage, string]>)(
  'masks extended %s literal forms while preserving following real source',
  (language, source) => {
    const masked = maskCode(source, language, { quotedIdentifiers: true });
    expect(masked).not.toContain('FAKE_SECRET_TABLE');
    expect(masked).not.toContain('FAKE_SECRET_CALL');
    expect(masked).toContain(['sql', 'plsql'].includes(language) ? 'real_table' : 'helper');
    if (!['sql', 'plsql'].includes(language))
      expect(
        extractProgramCode(source, language).dependencies.map((entry) => entry.target),
      ).toContain('helper');
  },
);
