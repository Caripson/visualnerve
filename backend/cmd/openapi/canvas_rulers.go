package main

func addCanvasRulerSchemas(schemas object) {
	schemas["CanvasGuide"] = object{
		"type":     "object",
		"required": []string{"id", "axis", "position"},
		"properties": object{
			"id":   object{"type": "string", "format": "uuid", "description": "Guide UUID, unique within the diagram."},
			"axis": object{"type": "string", "enum": []string{"horizontal", "vertical"}},
			"position": object{
				"type":        "number",
				"description": "Finite diagram Y for a horizontal guide or diagram X for a vertical guide.",
			},
		},
	}
	schemas["RulerOrigin"] = object{
		"type":        "object",
		"required":    []string{"x", "y"},
		"default":     object{"x": 0, "y": 0},
		"description": "Diagram coordinates used as X and Y zero on the rulers. Defaults to (0, 0). Guides use absolute diagram coordinates.",
		"properties": object{
			"x": object{"type": "number"},
			"y": object{"type": "number"},
		},
	}
}
