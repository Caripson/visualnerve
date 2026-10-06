import type { CodeLanguage, ExtractedCode } from './types';
import { extractSql, extractCypher } from './special/query';
import { extractGraphql } from './special/graphql';
import { extractBi, extractVega, extractSas } from './special/data';
import { extractInfrastructure } from './special/infrastructure';
import { extractLegacy } from './special/legacy';

export function extractSpecialCode(content: string, language: CodeLanguage): ExtractedCode {
  switch (language) {
    case 'sql':
    case 'tsql':
    case 'plsql':
      return extractSql(content, language);
    case 'graphql':
      return extractGraphql(content);
    case 'cypher':
      return extractCypher(content);
    case 'dax':
    case 'powerquery':
    case 'mdx':
      return extractBi(content, language);
    case 'vega':
      return extractVega(content);
    case 'hcl':
    case 'nix':
      return extractInfrastructure(content, language);
    case 'sas':
      return extractSas(content);
    case 'abap':
    case 'cobol':
    case 'assembly':
      return extractLegacy(content, language);
    default:
      return {
        symbols: [],
        dependencies: [],
        warnings: ['No specialized outline analyzer is available for this language.'],
      };
  }
}
