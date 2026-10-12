package main

const nodeAppearancePolicy = "Optional node.backgroundColor is a six-digit hex fill (#RRGGBB, case-insensitive), independent of node.color accent, nodeType, title, icon and flowchartSymbol. Omission uses the current theme fill. Complete/new nodes accept omission or a valid hex string; null, empty, shorthand, alpha, named colors, objects and non-hex values return structured 422 INVALID_NODE_BACKGROUND_COLOR without partial writes. Node PATCH with current version and existing external-ID bulk upserts preserve an omitted backgroundColor; explicit null removes it and restores theme fill. Native graph replacement, JSON, clipboard, templates, encrypted persistence, history, backups and collaborative edits preserve the field with no schema/format migration. Read-only grants permit inspection and exports but reject color mutations."

func addNodeAppearanceSchemas(schemas object) {
	color := object{"type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "minLength": 7, "maxLength": 7, "description": nodeAppearancePolicy}
	schemas["NodeBackgroundColor"] = color
	partial := clone(color)
	partial["nullable"] = true
	partial["description"] = "Set a six-digit hex fill or use null to remove the field on an existing node. Omission preserves it. New bulk entries still reject null. " + nodeAppearancePolicy
	schemas["NodeBackgroundColorPatch"] = partial
}
