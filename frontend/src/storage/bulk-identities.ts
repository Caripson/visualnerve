import { StorageError } from '../model/errors';

type Input = Record<string, unknown>;
type Identity = { id: string; externalId?: string };
type EntityKind = 'node' | 'connection' | 'owner';

/** Bulk updates resolve external identities; explicit canonical IDs only create new records. */
export class BulkIdentities {
  readonly entries: Input[];
  readonly canonicalIds: string[];
  private readonly byId: Map<string, Identity>;
  private readonly byExternalId: Map<string, Identity>;

  constructor(
    private readonly kind: EntityKind,
    input: unknown,
    existing: readonly Identity[],
    private readonly upsert: boolean,
  ) {
    if (input !== undefined && !Array.isArray(input))
      throw new StorageError(422, `Bulk ${kind} entries must be an array.`);
    this.entries = (input ?? []) as Input[];
    this.byId = new Map(existing.map((entity) => [entity.id, entity]));
    this.byExternalId = new Map(
      existing.filter((entity) => entity.externalId).map((entity) => [entity.externalId!, entity]),
    );
    const ids = new Set<string>(),
      externalIds = new Set<string>();
    for (const values of this.entries) {
      if (!values || typeof values !== 'object' || Array.isArray(values))
        throw new StorageError(422, `Bulk ${kind} entries must be objects.`);
      if (values.id !== undefined) {
        if (typeof values.id !== 'string' || !values.id)
          throw new StorageError(422, `Bulk ${kind} id must be nonempty text.`);
        if (ids.has(values.id))
          throw new StorageError(
            422,
            `Duplicate ${kind} id in bulk request. Submit each ${kind} once.`,
          );
        ids.add(values.id);
      }
      if (values.externalId !== undefined && typeof values.externalId !== 'string')
        throw new StorageError(422, `Bulk ${kind} externalId must be text.`);
      if (values.externalId) {
        const externalId = values.externalId as string;
        if (externalIds.has(externalId))
          throw new StorageError(
            422,
            `Duplicate external ${kind} id in bulk request. Submit each ${kind} once.`,
          );
        externalIds.add(externalId);
      }
    }
    this.canonicalIds = [...ids];
  }

  /** Include explicitly addressed records from other diagrams without expanding external-ID scope. */
  validate(additional: readonly (Identity | undefined)[] = []) {
    const byId = new Map(this.byId);
    for (const entity of additional) if (entity) byId.set(entity.id, entity);
    const label = this.kind[0].toUpperCase() + this.kind.slice(1);
    const collection = this.kind === 'connection' ? 'edges' : `${this.kind}s`;
    for (const values of this.entries) {
      const previous = values.externalId
        ? this.byExternalId.get(values.externalId as string)
        : undefined;
      if (previous && values.id !== undefined && values.id !== previous.id)
        throw new StorageError(
          422,
          `${label} id and externalId identify different entities. Bulk upsert matches externalId; omit id or supply its matching canonical id.`,
        );
      if (values.id !== undefined && byId.has(values.id as string) && !previous)
        throw new StorageError(
          409,
          `${label} id already exists. Use a versioned PATCH /${collection}/{id}, or its existing externalId with upsert: true. Bulk does not update by canonical id alone.`,
        );
      if (previous && !this.upsert)
        throw new StorageError(409, `External ${this.kind} id already exists.`);
    }
  }
}
