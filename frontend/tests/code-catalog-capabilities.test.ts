import { expect, it } from 'vitest';
import { codeLanguages } from '../src/code/catalog';
import { extractProgramCode } from '../src/code/program';
import type { CodeLanguage } from '../src/code/types';

it.each([
  ['matlab', 'function y = run(x)\n y = calculate(x);\nend'],
  ['vba', 'Sub Run()\n Call Compute\nEnd Sub\nFunction Compute()\nEnd Function'],
  ['apex', 'public class App {\n public void execute() { helper(); }\n public void helper() {}\n}'],
] satisfies [CodeLanguage, string][])(
  'advertises the supported %s outline without unsupported import analysis',
  (language, source) => {
    const catalog = codeLanguages.find((entry) => entry.id === language)!;
    const outline = extractProgramCode(source, language);
    expect(catalog.capabilities).toContain('declarations');
    expect(catalog.capabilities).toContain('calls');
    expect(catalog.capabilities).not.toContain('imports');
    expect(outline.symbols.some((symbol) => symbol.kind === 'function')).toBe(true);
    expect(outline.dependencies.some((dependency) => dependency.kind === 'calls')).toBe(true);
    expect(outline.dependencies.some((dependency) => dependency.kind === 'imports')).toBe(false);
  },
);

it('retains GDScript preload imports while leaving standalone extends outside its advertised analysis', () => {
  const catalog = codeLanguages.find((entry) => entry.id === 'gdscript')!;
  const outline = extractProgramCode(
    'extends Base\nclass_name App\nfunc run():\n var library = preload("res://app.gd")\n work()\n',
    'gdscript',
  );
  expect(catalog.capabilities).toContain('imports');
  expect(catalog.capabilities).not.toContain('inherits');
  expect(outline.dependencies).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'imports', target: 'res://app.gd' })]),
  );
  expect(outline.dependencies.some((dependency) => dependency.target === 'Base')).toBe(false);
});
