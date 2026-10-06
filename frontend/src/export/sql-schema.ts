import type { SqlTable, SqlRelationship } from '../sql/schema';

export function sqlTableSchema(table: SqlTable | undefined) {
  if (!table) return undefined;
  return {
    name: table.name,
    qualifiedName: table.qualifiedName,
    columns: table.columns.map((column) => ({
      name: column.name,
      dataType: column.dataType,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      foreignKey: column.foreignKey,
      unique: column.unique,
    })),
    primaryKey: table.primaryKey,
    uniqueKeys: table.uniqueKeys,
    external: table.external ?? false,
  };
}

export function sqlForeignKeySchema(foreignKey: SqlRelationship | undefined) {
  if (!foreignKey) return undefined;
  return {
    columns: foreignKey.columns,
    referencedColumns: foreignKey.unresolved ? null : foreignKey.referencedColumns,
    ...(foreignKey.unresolved ? { unresolved: true } : {}),
    name: foreignKey.name,
    onDelete: foreignKey.onDelete,
    onUpdate: foreignKey.onUpdate,
  };
}
