import { sqlTableSchema, sqlForeignKeySchema } from './sql-schema';
import type { Graph } from '../model/types';
import { getSqlRelationship, getSqlTable } from '../sql/schema';
import { getCodeObject, getCodeRelation, getProjectDirectory } from '../code/schema';
import { getSqlQueryRelationship } from '../sql/query-schema';
import { graphDatasets, isGeneratedCsvNode } from '../data/model';
import { getCsvNode } from '../data/csv';
import type { LovablePromptOptions } from './lovable';

import { buildSectionLabels, getBuildSpecification } from './build-specification-draft';
import type {
  ApplicationSpecification,
  BuildDecision,
  BuildSection,
} from './build-specification-draft';
import { columnSchema } from './build-specification-schema';
export * from './build-specification-draft';

export function specificationNodes(graph: Graph, options: LovablePromptOptions) {
  const selected = new Set(options.selectedIds ?? []);
  return graph.nodes.filter((node) =>
    options.scope === 'selected'
      ? selected.has(node.id)
      : options.scope !== 'csv-view' ||
        !isGeneratedCsvNode(node) ||
        getCsvNode(node)?.visible !== false,
  );
}
/** Separate observations, proposed design and answered decisions; never infer app behavior from layout. */
export function applicationSpecification(
  graph: Graph,
  options: LovablePromptOptions,
): ApplicationSpecification {
  const nodes = specificationNodes(graph, options),
    ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) =>
      ids.has(edge.sourceNodeId) &&
      ids.has(edge.targetNodeId) &&
      (options.scope !== 'csv-view' || edge.metadata.csvModelVisible !== false),
  );
  const refs = new Map(nodes.map((node, index) => [node.id, `n${index + 1}`]));
  const outgoing = new Map<string, { count: number; unlabeled: boolean }>();
  for (const edge of edges) {
    const targets = [
      ...(['forward', 'both'].includes(edge.direction) ? [edge.sourceNodeId] : []),
      ...(['backward', 'both'].includes(edge.direction) && edge.targetNodeId !== edge.sourceNodeId
        ? [edge.targetNodeId]
        : []),
    ];
    for (const id of targets) {
      const item = outgoing.get(id) ?? { count: 0, unlabeled: false };
      item.count++;
      item.unlabeled ||= !edge.label?.trim();
      outgoing.set(id, item);
    }
  }
  const csvNodes = new Map<string, string[]>();
  for (const node of nodes) {
    const source = getCsvNode(node)?.datasetId;
    if (!source) continue;
    const existing = csvNodes.get(source) ?? [];
    if (existing.length < 10) existing.push(node.id);
    csvNodes.set(source, existing);
  }
  const draft = getBuildSpecification(graph);
  const decisions: BuildDecision[] = [];
  let omittedDecisions = 0;
  const decision = (id: string, question: string, nodeIds: string[] = []) => {
    if (decisions.length >= 200) {
      omittedDecisions++;
      return;
    }
    decisions.push({
      id,
      question,
      nodeIds,
      ...(draft.answers[id]?.trim() ? { answer: draft.answers[id].trim() } : {}),
    });
  };
  decision('audience', 'Who will use this app, and what must each role be allowed to do?');
  decision('storage', 'Where should app data be stored, and how should backup and retention work?');
  decision(
    'writes',
    'Which actions change data, and what validation and error behavior must each action have?',
  );
  decision('navigation', 'Confirm the screens, navigation and entry points for the app.');
  const data: string[] = [],
    screens: string[] = [],
    rules: string[] = [],
    acceptance: string[] = [];
  const schemas: Record<string, unknown> = {},
    paths: Record<string, unknown> = {};
  for (const node of nodes) {
    const reference = refs.get(node.id)!;
    const table = getSqlTable(node);
    if (table) {
      data.push(
        JSON.stringify({
          ref: reference,
          nodeId: node.id,
          observedTable: table.qualifiedName,
          external: table.external ?? false,
          columns: sqlTableSchema(table)!.columns,
          primaryKey: table.primaryKey,
          uniqueKeys: table.uniqueKeys,
        }),
      );
      if (table.external)
        decision(
          `external:${node.id}`,
          `Provide the definition and access contract for external table ${node.title}.`,
          [node.id],
        );
      else {
        const schemaName = `Entity_${reference}`;
        schemas[schemaName] = {
          type: 'object',
          properties: Object.fromEntries(
            table.columns.map((column) => [
              column.name,
              {
                ...columnSchema(column.dataType),
                nullable: column.nullable,
                'x-sql-type': column.dataType,
              },
            ]),
          ),
          ...(table.columns.some((column) => !column.nullable)
            ? {
                required: table.columns
                  .filter((column) => !column.nullable)
                  .map((column) => column.name),
              }
            : {}),
          description: `Observed SQL schema for ${table.qualifiedName.join('.')}; response shape is a proposal.`,
        };
        paths[`/entities/${reference}`] = {
          get: {
            operationId: `list_${reference}`,
            summary: `Proposed read access to ${node.title}`,
            'x-diagram-node-id': node.id,
            responses: {
              '200': {
                description:
                  'Proposed entity list; pagination, authorization and error responses require review.',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: `#/components/schemas/${schemaName}` },
                    },
                  },
                },
              },
            },
          },
        };
        decision(
          `api:${node.id}`,
          `Confirm read endpoint /entities/${reference}, authorization and pagination for ${node.title}. Define write endpoints if required.`,
          [node.id],
        );
        for (const column of table.columns.filter((column) => !column.nullable))
          acceptance.push(
            `Given a ${reference} record, when it is returned, then ${JSON.stringify(column.name)} must satisfy the declared non-null SQL type ${JSON.stringify(column.dataType)}.`,
          );
      }
    } else if (node.nodeType === 'database') {
      data.push(
        JSON.stringify({
          ref: reference,
          conceptualDataObject: node.title,
          fields: 'unknown',
          nodeId: node.id,
        }),
      );
      decision(
        `entity:${node.id}`,
        `Define fields, identity and validation for ${node.title}; the diagram does not provide a physical schema.`,
        [node.id],
      );
    }
    if (
      ['input', 'output'].includes(node.nodeType) ||
      node.tags.some((tag) => /^(screen|ui)(:|$)/i.test(tag))
    ) {
      screens.push(
        JSON.stringify({
          proposedScreen: node.title,
          ref: reference,
          description: node.description,
          confirmationRequired: true,
        }),
      );
      decision(
        `screen:${node.id}`,
        `Confirm how ${node.title} should appear and behave on screen.`,
        [node.id],
      );
    }
    if (node.nodeType === 'decision') {
      const branches = outgoing.get(node.id);
      if (!branches || branches.count < 2 || branches.unlabeled)
        decision(
          `branches:${node.id}`,
          `Specify complete branch conditions and outcomes for ${node.title}.`,
          [node.id],
        );
    }
    if (getCodeObject(node)?.external)
      decision(
        `code:${node.id}`,
        `Confirm the external behavior or integration represented by ${node.title}.`,
        [node.id],
      );
    if (node.description?.trim() && !table && !getCodeObject(node) && !getProjectDirectory(node))
      acceptance.push(
        `Given the app capability ${reference} ${JSON.stringify(node.title)}, when its described workflow is used, then verify the explicitly described behavior: ${JSON.stringify(node.description)}. Refine this into concrete test inputs and outputs before implementation.`,
      );
  }
  for (const edge of edges) {
    const code = getCodeRelation(edge),
      query = getSqlQueryRelationship(edge),
      key = getSqlRelationship(edge);
    if (code && code.confidence !== 'syntax')
      decision(
        `relation:${edge.id}`,
        `Verify ${code.confidence} ${code.kind} between ${refs.get(edge.sourceNodeId)} and ${refs.get(edge.targetNodeId)}.`,
        [edge.sourceNodeId, edge.targetNodeId],
      );
    if (key) {
      rules.push(
        JSON.stringify({
          observedForeignKey: {
            source: refs.get(edge.sourceNodeId),
            target: refs.get(edge.targetNodeId),
            ...sqlForeignKeySchema(key),
          },
          meaning: 'data integrity, not workflow order',
        }),
      );
      if (key.unresolved)
        decision(`key:${edge.id}`, 'Resolve the missing foreign-key target definition.', [
          edge.sourceNodeId,
          edge.targetNodeId,
        ]);
      else
        acceptance.push(
          `Given a relationship ${edge.id}, when validating records, then enforce foreign-key columns ${JSON.stringify(key.columns)} against ${JSON.stringify(key.referencedColumns)} and the declared delete/update actions. This does not define workflow order.`,
        );
    } else if (
      !code &&
      !query &&
      edge.metadata.csvGenerated !== true &&
      edge.metadata.csvModelGenerated !== true &&
      edge.edgeType !== 'hierarchy'
    ) {
      rules.push(
        JSON.stringify({
          observedConnection: edge.id,
          source: refs.get(edge.sourceNodeId),
          target: refs.get(edge.targetNodeId),
          type: edge.edgeType,
          direction: edge.direction,
          label: edge.label,
          description: edge.description,
        }),
      );
      if (edge.label?.trim())
        acceptance.push(
          `Given the explicitly modeled connection ${edge.id}, when its condition ${JSON.stringify(edge.label)} applies, then verify the declared ${edge.direction} relationship between ${refs.get(edge.sourceNodeId)} and ${refs.get(edge.targetNodeId)}. Confirm whether this is a workflow transition or another relation.`,
        );
    }
  }
  for (const source of graphDatasets(graph)) {
    if (!csvNodes.has(source.id)) continue;
    data.push(
      JSON.stringify({
        observedCsvSource: source.name,
        columns: source.columns.map((column) => column.label),
        rowValues: 'not included',
        fieldTypesAndKeys: 'require confirmation',
      }),
    );
    decision(
      `csv:${source.id}`,
      `Define app record identities and types for CSV source ${source.name}; aggregates are not original records.`,
      csvNodes.get(source.id)!,
    );
  }
  if (Object.keys(paths).length)
    decision(
      'api-policy',
      'Define API authentication, pagination, rate behavior, error responses and write contracts. The generated read endpoints are proposals only.',
    );
  if (!data.length)
    decision(
      'data-model',
      'Define which workflow objects represent stored data, their fields and their identities.',
    );
  if (!acceptance.length)
    decision(
      'acceptance',
      'Provide concrete Given/When/Then scenarios with inputs, expected outcomes and failure cases.',
    );
  const unresolved = decisions.filter((item) => !item.answer).length + omittedDecisions;
  const generated: Record<BuildSection, string> = {
    dataModel: data.join('\n') || 'No physical data model is defined in this scope.',
    screens:
      screens.join('\n') ||
      'Screen layout and navigation require user decisions. Workflow position does not define screen order.',
    businessRules:
      rules.join('\n') ||
      'No explicit business-rule connections are defined. Use the supplied object descriptions and clarify missing conditions.',
    apiContract: Object.keys(paths).length
      ? JSON.stringify(
          {
            openapi: '3.0.3',
            info: {
              title: `${graph.diagram.name} — proposed app API`,
              version: '0.1.0-proposal',
              description:
                'Review required. These endpoints are design proposals derived from observed SQL schemas, not existing services.',
            },
            paths,
            components: { schemas },
          },
          null,
          2,
        )
      : 'An API contract is not specified. Define endpoints, request/response schemas, authorization and error behavior; do not invent an existing API.',
    acceptanceCriteria:
      acceptance.join('\n') || 'Concrete acceptance scenarios are still required.',
    decisions:
      decisions
        .map((item) =>
          JSON.stringify({
            id: item.id,
            question: item.question,
            answer: item.answer ?? 'UNRESOLVED',
            nodeIds: item.nodeIds,
          }),
        )
        .join('\n') +
      (omittedDecisions
        ? `\n${omittedDecisions} additional decisions are outside this bounded review. Narrow the scope before implementation.`
        : ''),
  };
  const sections = Object.fromEntries(
    (Object.keys(buildSectionLabels) as BuildSection[]).map((key) => [
      key,
      generated[key] +
        (draft.sections[key]?.trim()
          ? `\n\nUser-reviewed additions (${buildSectionLabels[key]}):\n${draft.sections[key]}`
          : ''),
    ]),
  ) as Record<BuildSection, string>;
  return { version: 1, sections, decisions, unresolved, omittedDecisions, nodeCount: nodes.length };
}
