import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeLanguageIds, codeLimits } from '../src/code/types';

describe('generated code OpenAPI contract', () => {
  const document = JSON.parse(readFileSync(resolve(process.cwd(), '../docs/openapi.yaml'), 'utf8'));
  const schemas = document.components.schemas;
  it('keeps all language ids and bounded input aligned with the browser', () => {
    expect(schemas.CodeLanguage.enum).toEqual([...codeLanguageIds]);
    expect(schemas.CodeInput.properties.files.maxItems).toBe(codeLimits.files);
    expect(schemas.CodeFile.properties.content.maxLength).toBe(codeLimits.fileBytes);
    expect(schemas.CodeInput.additionalProperties).toBe(false);
    expect(schemas.CodeFile.additionalProperties).toBe(false);
  });
  it('documents strict metadata and the separate preview/create/discovery operations', () => {
    for (const name of ['CodeObject', 'CodeRelation', 'CodeAnalysis'])
      expect(schemas[name].additionalProperties).toBe(false);
    expect(schemas.Node.properties.metadata.properties.codeObject.$ref).toContain('/CodeObject');
    expect(schemas.Edge.properties.metadata.properties.codeRelation.$ref).toContain(
      '/CodeRelation',
    );
    expect(schemas.Diagram.properties.metadata.properties.codeAnalysis.$ref).toContain(
      '/CodeAnalysis',
    );
    expect(document.paths['/code/languages'].get.responses['200']).toBeDefined();
    expect(document.paths['/code/preview'].post.summary).toContain('without saving');
    expect(document.paths['/code/diagrams'].post.responses['201']).toBeDefined();
  });
});
