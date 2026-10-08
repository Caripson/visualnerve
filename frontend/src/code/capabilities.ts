import { codeLimits } from './types';
import { projectArchiveLimits } from './project/types';
import {
  DEFAULT_PROJECT_SOURCE_FILE_LIMIT,
  MAX_PROJECT_SOURCE_FILE_LIMIT,
  PROJECT_SOURCE_FILE_LIMIT_SETTING,
} from './project/limits';
import {
  IMPORT_LIMIT_SETTING,
  DEFAULT_IMPORT_LIMIT_BYTES,
  MAX_IMPORT_LIMIT_BYTES,
} from '../imports/limits';

/** Semantic limits, separate from the browser's currently selected preferences. */
export const codeCapabilities = {
  version: 1,
  modes: ['files', 'symbols', 'folders'],
  sourceFiles: { maximum: codeLimits.files },
  zipProjects: {
    sourceFileLimit: {
      setting: PROJECT_SOURCE_FILE_LIMIT_SETTING,
      default: DEFAULT_PROJECT_SOURCE_FILE_LIMIT,
      minimum: DEFAULT_PROJECT_SOURCE_FILE_LIMIT,
      maximum: MAX_PROJECT_SOURCE_FILE_LIMIT,
    },
    maximumEntries: projectArchiveLimits.entries,
    scanTimeoutMs: projectArchiveLimits.timeoutMs,
  },
  byteLimit: {
    setting: IMPORT_LIMIT_SETTING,
    default: DEFAULT_IMPORT_LIMIT_BYTES,
    maximum: MAX_IMPORT_LIMIT_BYTES,
  },
  analysis: {
    maximumNodes: codeLimits.nodes,
    maximumSymbols: codeLimits.symbols,
    maximumEdges: codeLimits.edges,
    maximumLinesPerFile: codeLimits.lines,
    maximumProjectLines: codeLimits.totalLines,
    maximumLineLength: codeLimits.lineLength,
    timeoutMs: 30_000,
  },
};
