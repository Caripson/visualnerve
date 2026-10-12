package main

import "visualnerve/internal/model"

const flowchartPolicy = "IBM Flowcharting uses existing flowchart diagrams and canonical node types. Optional node.flowchartSymbol is a stable IBM catalog ID; it changes appearance without changing identity, relationships or semantic nodeType. GET /flowchart/symbols returns the full shared 43-entry catalog with labels, nodeType defaults, category, construction, revisions, physicalCutout, normalized outline/detail geometry, 0..100 SVG paths and normalized contentBox. There are 38 revised-stencil entries: 32 completed symbols, two raw apertures and four arrowheads; five legacy entries preserve the original Input/Output, Predefined Process, Program Modification, Clerical Operation and Perforated Tape forms. category is symbol|outline|arrowhead|legacy, and revisions lists GX20-8020|GX20-8020-1|GX20-8020-2 outline membership; historical names/functions may differ for shared outlines. physicalCutout identifies only the 26 apertures of GX20-8020-1/-2. GET /flowchart/stencils returns each revision with its exact physicalCutoutSymbolIds: original GX20-8020 has 25, each revised stencil has 26, including four arrowheads. Optional symbolLabels maps catalog IDs to source-backed historical names so shared outlines preserve revision-specific meanings. GET discovery permits Read only. POST /diagrams with {name,template:ibm-flowcharting,type?:flowchart} creates the editable built-in example with Read + write; no mode option is accepted. Node creation, children, bulk upserts, versioned PATCH, graph replacement, JSON imports/exports, backups and templates preserve flowchartSymbol. Omitted partial-update fields preserve appearance; PATCH or an existing bulk upsert with flowchartSymbol:null removes it and restores the ordinary node appearance. Complete node/graph records accept omission or a catalog ID, never null, empty strings or unknown IDs; invalid inputs return 422 without partial writes. No storage schema or exchange format migration is required."

func stringsToAny(values []string) []any {
	result := make([]any, len(values))
	for i, value := range values {
		result[i] = value
	}
	return result
}

func addFlowchartSchemas(schemas object) {
	point := object{"type": "array", "minItems": 2, "maxItems": 2, "items": object{"type": "number", "minimum": 0, "maximum": 1}}
	line := object{"type": "array", "minItems": 2, "items": point}
	unit := object{"type": "number", "minimum": 0, "maximum": 1}
	schemas["FlowchartSymbol"] = object{"type": "string", "enum": model.FlowchartSymbols, "description": "Optional stable catalog appearance; nodeType remains the existing semantic kind. Omit for ordinary node appearance."}
	schemas["IBMStencilRevision"] = object{"type": "string", "enum": []string{"GX20-8020", "GX20-8020-1", "GX20-8020-2"}}
	labels := object{}
	for _, id := range model.FlowchartSymbols {
		labels[id] = object{"type": "string", "minLength": 1}
	}
	schemas["FlowchartStencilSymbolLabels"] = strictObject(nil, labels)
	schemas["FlowchartStencilSymbolLabels"].(object)["description"] = "Optional source-backed historical names keyed by catalog ID. When an alias is present, use it instead of the shared catalog label for this stencil revision. Keys are restricted to known catalog IDs; missing aliases retain the catalog label."
	schemas["FlowchartStencilRecord"] = strictObject([]string{"revision", "label", "physicalCutoutSymbolIds"}, object{
		"revision": ref("IBMStencilRevision"), "label": object{"type": "string"},
		"physicalCutoutSymbolIds": object{"type": "array", "minItems": 25, "maxItems": 26, "uniqueItems": true, "items": ref("FlowchartSymbol"), "description": "The exact physical apertures belonging to this revision: original GX20-8020 has 25; GX20-8020-1/-2 each have 26. Shared outlines can have distinct revision-specific meanings."},
		"symbolLabels":            ref("FlowchartStencilSymbolLabels"),
	})
	schemas["FlowchartSymbolRecord"] = strictObject([]string{"id", "label", "nodeType", "physicalCutout", "category", "construction", "revisions", "outline", "outlinePath", "details", "detailPaths", "contentBox"}, object{
		"id": ref("FlowchartSymbol"), "label": object{"type": "string"},
		"nodeType":       object{"type": "string", "enum": model.NodeTypes, "description": "Suggested existing semantic node type; selecting an appearance does not force an existing node to change type."},
		"physicalCutout": object{"type": "boolean", "description": "True for one of the 26 physical apertures of GX20-8020-1/-2 only. Discover GET /flowchart/stencils for original GX20-8020's separate 25-aperture membership."},
		"category":       object{"type": "string", "enum": []string{"symbol", "outline", "arrowhead", "legacy"}},
		"construction":   object{"type": "string", "enum": []string{"cutout", "composite", "drawn"}},
		"revisions":      object{"type": "array", "minItems": 1, "maxItems": 3, "uniqueItems": true, "items": ref("IBMStencilRevision"), "description": "Stencil revisions that share this outline. Historical names/functions may differ for a shared outline; legacy entries retain distinct original meanings separately from later replacements."},
		"outline":        line, "outlinePath": object{"type": "string", "description": "Closed SVG outline using a 0 0 100 100 viewBox."},
		"details": object{"type": "array", "items": line}, "detailPaths": object{"type": "array", "items": object{"type": "string"}, "description": "Open SVG detail paths in the same 0 0 100 100 viewBox."},
		"contentBox": strictObject([]string{"x", "y", "width", "height"}, object{"x": unit, "y": unit, "width": unit, "height": unit}),
	})
	schemas["FlowchartSymbolRecord"].(object)["description"] = flowchartPolicy
}
