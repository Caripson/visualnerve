import { codeLimits, type ProjectDirectory } from './types';
import type { AnalyzedFile } from './resolve';

/** A directory is a project structure object, independent of a source language. */
export class ProjectDirectoryIndex {
  readonly directories: ProjectDirectory[];
  readonly hierarchy: { parent: string; child: string }[] = [];
  private owners = new Map<string, string>();

  constructor(files: AnalyzedFile[]) {
    const entries = new Map<string, ProjectDirectory>();
    const languages = new Map<string, Set<ProjectDirectory['languages'][number]>>();
    for (const file of files) {
      const segments = file.path.split('/').slice(0, -1);
      const paths = ['.', ...segments.map((_, index) => segments.slice(0, index + 1).join('/'))];
      this.owners.set(file.path, paths.at(-1)!);
      for (let index = 0; index < paths.length; index++) {
        const path = paths[index];
        if (!entries.has(path)) {
          if (entries.size >= codeLimits.nodes)
            throw new Error('Project exceeds 5,000 directories. Import a smaller folder.');
          entries.set(path, { version: 1, path, fileCount: 0, languages: [] });
          languages.set(path, new Set());
          if (index) this.hierarchy.push({ parent: paths[index - 1], child: path });
        }
        entries.get(path)!.fileCount++;
        languages.get(path)!.add(file.language);
      }
    }
    this.directories = [...entries.values()].map((entry) => ({
      ...entry,
      languages: [...languages.get(entry.path)!],
    }));
  }

  owner(path: string): string {
    return this.owners.get(path)!;
  }
}
