package main

func exportSchema() object {
	identity := object{"type": "string", "format": "uuid"}
	return object{"description": "Read-only export. JSON returns Graph; Markdown and SVG return text as a JSON string. SVG is native vector XML from the canonical 2D layout, never the 3D camera. Optional SVG scope defaults to complete; selected requires unique existing node UUIDs. Viewport uses the saved 2D viewport at the current browser canvas size, or fits the diagram when no usable viewport is saved. Rendering does not open or change the project. Fonts are referenced, not embedded; shadows and CSS decoration may be simplified. No external links, scripts, images or foreignObject are emitted.", "oneOf": []any{
		strictObject([]string{"diagramId", "format"}, object{"diagramId": identity, "format": object{"type": "string", "enum": []string{"json", "markdown"}}}),
		strictObject([]string{"diagramId", "format"}, object{"diagramId": identity, "format": object{"type": "string", "enum": []string{"svg"}}, "scope": object{"type": "string", "enum": []string{"complete", "viewport"}, "default": "complete"}}),
		strictObject([]string{"diagramId", "format", "scope", "nodeIds"}, object{"diagramId": identity, "format": object{"type": "string", "enum": []string{"svg"}}, "scope": object{"type": "string", "enum": []string{"selected"}}, "nodeIds": object{"type": "array", "minItems": 1, "maxItems": 20000, "uniqueItems": true, "items": identity}}),
	}}
}
