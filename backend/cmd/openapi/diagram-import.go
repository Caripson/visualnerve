package main

func addDiagramImportSchemas(schemas object) {
	text := func(max int) object { return object{"type": "string", "minLength": 1, "maxLength": max} }
	schemas["DiagramFileFormat"] = object{"type": "string", "enum": []string{"drawio", "vsdx"}}
	schemas["DiagramFileInput"] = object{
		"type": "object", "additionalProperties": false, "required": []string{"format", "data"},
		"properties": object{
			"format": ref("DiagramFileFormat"),
			"data":   text(4 * ((absoluteImportByteLimit + 2) / 3)),
			"name":   text(500),
		},
		"description": "drawio data is XML text (.drawio/.xml); vsdx data is strict padded standard base64 containing a ZIP archive (.vsdx). No URLs, scripts, images or macros are fetched or executed. Legacy .vsd and macro-enabled .vsdm are unsupported. Absolute decoded file ceiling 1 GiB. Expanded data ceiling is min(1 GiB, max(100 MiB, 2 * selected file limit)); default 100 MiB. Other limits: 2,048 ZIP entries, 100 pages, 20,000 total objects, 40,000 total relationships, hierarchy depth 256. Browser worker deadline 30 seconds; transport allows 45 seconds. Base64 integration files must remain below roughly 24 MiB to fit the JSON envelope. " + importLimitPolicyDescription,
	}
	schemas["DiagramFileImportInput"] = clone(schemas["DiagramFileInput"].(object))
	schemas["DiagramFileImportInput"].(object)["properties"].(map[string]any)["pageId"] = text(500)
	schemas["DiagramFileImportInput"].(object)["description"] = "Same source and size/structure limits as preview, plus optional source pageId. A one-page file may omit pageId; a multipage file must specify the ID returned by preview. Missing selection for multipage files or unknown IDs return 422 with no saved graph. Saves and opens only the selected page as an editable native graph; write access required. Source XML/ZIP and unselected pages are not retained. " + importLimitPolicyDescription
	schemas["DiagramImportPage"] = object{
		"type": "object", "additionalProperties": false, "required": []string{"id", "name", "graph", "warnings"},
		"properties": object{
			"id": text(500), "name": text(500), "graph": ref("Graph"),
			"warnings": object{"type": "array", "maxItems": 200, "items": object{"type": "string"}},
		},
		"description": "Source page ID is a string, not a Visual Nerve UUID. The native approximation retains recognized geometry, text, groups, connections and safe HTTP(S) links; advanced shapes, rotations and connector waypoints may be simplified with warnings.",
	}
	schemas["DiagramImportResult"] = object{
		"type": "object", "additionalProperties": false, "required": []string{"format", "pages", "warnings"},
		"properties": object{
			"format":   ref("DiagramFileFormat"),
			"pages":    object{"type": "array", "minItems": 1, "maxItems": 100, "items": ref("DiagramImportPage")},
			"warnings": object{"type": "array", "maxItems": 200, "items": object{"type": "string"}},
		},
		"description": "Read-only local preview. Creates no project, changes no open diagram and stores no source. Review per-page and file warnings before importing the selected page.",
	}
}
