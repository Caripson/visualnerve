import type { GraphEdge, GraphNode } from '../model/types';

export interface SqlColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  foreignKey: boolean;
  unique: boolean;
}

export interface SqlTable {
  version: 1;
  name: string;
  qualifiedName: string[];
  columns: SqlColumn[];
  primaryKey: string[];
  uniqueKeys: string[][];
  external?: boolean;
}

export interface SqlRelationship {
  version: 1;
  columns: string[];
  referencedColumns: string[];
  onDelete?: string;
  onUpdate?: string;
  name?: string;
  /** The referenced table is outside the script and its primary key is unknown. */
  unresolved?: boolean;
}

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);

/** Reserved metadata is recognized structurally; ordinary custom metadata stays ordinary. */
export function getSqlTable(node: GraphNode): SqlTable | undefined {
  const table = node.metadata?.sqlTable as SqlTable | undefined;
  if (
    !table ||
    table.version !== 1 ||
    typeof table.name !== 'string' ||
    !table.name ||
    !strings(table.qualifiedName) ||
    !table.qualifiedName.length ||
    !Array.isArray(table.columns) ||
    !strings(table.primaryKey) ||
    !Array.isArray(table.uniqueKeys) ||
    !table.uniqueKeys.every(strings) ||
    (table.external !== undefined && typeof table.external !== 'boolean')
  )
    return undefined;
  if (
    !table.columns.every(
      (column) =>
        column &&
        typeof column.name === 'string' &&
        column.name.length > 0 &&
        typeof column.dataType === 'string' &&
        typeof column.nullable === 'boolean' &&
        typeof column.primaryKey === 'boolean' &&
        typeof column.foreignKey === 'boolean' &&
        typeof column.unique === 'boolean',
    )
  )
    return undefined;
  return table;
}

export function getSqlRelationship(edge: GraphEdge): SqlRelationship | undefined {
  const relationship = edge.metadata?.sqlRelationship as SqlRelationship | undefined;
  if (
    !relationship ||
    relationship.version !== 1 ||
    !strings(relationship.columns) ||
    !relationship.columns.length ||
    !strings(relationship.referencedColumns) ||
    !relationship.referencedColumns.length ||
    relationship.columns.length !== relationship.referencedColumns.length ||
    [relationship.name, relationship.onDelete, relationship.onUpdate].some(
      (value) => value !== undefined && typeof value !== 'string',
    ) ||
    (relationship.unresolved !== undefined && typeof relationship.unresolved !== 'boolean')
  )
    return undefined;
  return relationship;
}
