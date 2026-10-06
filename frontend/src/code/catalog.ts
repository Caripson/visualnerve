import type { CodeLanguage, LanguageDefinition } from './types';

const declarations = ['declarations', 'calls', 'imports'];
const language = (
  id: CodeLanguage,
  name: string,
  extensions: string[],
  family: string,
  capabilities = declarations,
): LanguageDefinition => ({ id, name, extensions, family, capabilities: [...capabilities] });

/** These capabilities describe bounded structural extraction, not compiler/type resolution. */
export const codeLanguages: LanguageDefinition[] = [
  language('python', 'Python', ['.py', '.pyw'], 'indent'),
  language('javascript', 'JavaScript', ['.js', '.mjs', '.cjs', '.jsx'], 'brace'),
  language('typescript', 'TypeScript', ['.ts', '.tsx', '.mts', '.cts'], 'brace'),
  language('java', 'Java', ['.java'], 'brace'),
  language('csharp', 'C#', ['.cs', '.csx'], 'brace'),
  language('cpp', 'C++', ['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.hh', '.h'], 'brace'),
  language('c', 'C', ['.c', '.h'], 'brace'),
  language('sql', 'SQL', ['.sql', '.ddl'], 'query', ['queries', 'tables', 'references']),
  language('go', 'Go', ['.go'], 'brace'),
  language('rust', 'Rust', ['.rs'], 'brace'),
  language('php', 'PHP', ['.php', '.phtml'], 'brace'),
  language('kotlin', 'Kotlin', ['.kt', '.kts'], 'brace'),
  language('swift', 'Swift', ['.swift'], 'brace'),
  language('shell', 'Bash / Shell', ['.sh', '.bash', '.zsh'], 'shell'),
  language('r', 'R', ['.r', '.R'], 'assignment'),
  language('dart', 'Dart', ['.dart'], 'brace'),
  language('ruby', 'Ruby', ['.rb', '.rake'], 'end'),
  language('powershell', 'PowerShell', ['.ps1', '.psm1', '.psd1'], 'shell'),
  language('dax', 'DAX', ['.dax'], 'bi', ['measures', 'references']),
  language('powerquery', 'Power Query M', ['.pq', '.m'], 'bi', ['steps', 'references']),
  language('vba', 'VBA', ['.bas', '.cls', '.frm'], 'end', ['declarations', 'calls']),
  language('scala', 'Scala', ['.scala', '.sc'], 'brace'),
  language('lua', 'Lua', ['.lua'], 'end'),
  language('matlab', 'MATLAB', ['.m'], 'end', ['declarations', 'calls']),
  language('objective-c', 'Objective-C', ['.m', '.mm', '.h'], 'brace'),
  language('perl', 'Perl', ['.pl', '.pm', '.t'], 'brace'),
  language('groovy', 'Groovy', ['.groovy', '.gvy', '.gradle'], 'brace'),
  language('vbnet', 'Visual Basic / VB.NET', ['.vb', '.vbproj'], 'end'),
  language('julia', 'Julia', ['.jl'], 'end'),
  language('elixir', 'Elixir', ['.ex', '.exs'], 'end'),
  language('solidity', 'Solidity', ['.sol'], 'brace'),
  language('haskell', 'Haskell', ['.hs', '.lhs'], 'functional'),
  language('fsharp', 'F#', ['.fs', '.fsx', '.fsi'], 'functional'),
  language('clojure', 'Clojure', ['.clj', '.cljs', '.cljc', '.edn'], 'lisp'),
  language('tsql', 'T-SQL', ['.tsql'], 'query', ['queries', 'procedures', 'references']),
  language('plsql', 'PL/SQL', ['.pls', '.pks', '.pkb', '.plsql'], 'query', [
    'queries',
    'procedures',
    'references',
  ]),
  language('sas', 'SAS', ['.sas'], 'analytics', ['steps', 'data dependencies']),
  language('apex', 'Apex', ['.cls', '.trigger'], 'brace', ['declarations', 'calls']),
  language('abap', 'ABAP', ['.abap'], 'enterprise', ['declarations', 'calls', 'data dependencies']),
  language('cobol', 'COBOL', ['.cob', '.cbl', '.cpy'], 'legacy', ['paragraphs', 'calls', 'files']),
  language('fortran', 'Fortran', ['.f', '.for', '.f90', '.f95', '.f03', '.f08'], 'end'),
  language('assembly', 'Assembly', ['.asm', '.s'], 'low-level', ['labels', 'calls', 'includes']),
  language('pascal', 'Delphi / Object Pascal', ['.pas', '.pp', '.dpr'], 'end'),
  language('gdscript', 'GDScript', ['.gd'], 'indent'),
  language('graphql', 'GraphQL', ['.graphql', '.gql'], 'declarative', [
    'operations',
    'types',
    'references',
  ]),
  language('mdx', 'MDX', ['.mdx'], 'bi', ['measures', 'cubes', 'references']),
  language('cypher', 'Cypher', ['.cypher', '.cql'], 'query', ['patterns', 'labels', 'references']),
  language(
    'vega',
    'Vega / Vega-Lite',
    ['.vg.json', '.vl.json', '.vega.json', '.vegalite.json'],
    'declarative',
    ['data', 'transforms', 'references'],
  ),
  language('hcl', 'HCL', ['.tf', '.tfvars', '.hcl'], 'infrastructure', [
    'resources',
    'modules',
    'references',
  ]),
  language('nix', 'Nix', ['.nix'], 'infrastructure', ['bindings', 'imports', 'references']),
];

export function detectCodeLanguage(path: string): CodeLanguage | undefined {
  const basename = path.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
  if (['rakefile', 'gemfile'].includes(basename)) return 'ruby';
  if (['jenkinsfile'].includes(basename)) return 'groovy';
  const matching = codeLanguages.filter((entry) =>
    entry.extensions.some((extension) => basename.endsWith(extension.toLowerCase())),
  );
  return matching.length === 1 ? matching[0].id : undefined;
}

export function supportedCodeFile(path: string): boolean {
  const basename = path.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
  return (
    Boolean(detectCodeLanguage(path)) ||
    codeLanguages.some((entry) =>
      entry.extensions.some((extension) => basename.endsWith(extension.toLowerCase())),
    )
  );
}
