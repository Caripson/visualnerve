package main

func addStoryboardSchemas(schemas object) {
	view2d := strictObject([]string{"mode", "viewport"}, object{"mode": object{"type": "string", "enum": []string{"2d"}}, "viewport": strictObject([]string{"x", "y", "zoom"}, object{"x": object{"type": "number", "minimum": -1e7, "maximum": 1e7}, "y": object{"type": "number", "minimum": -1e7, "maximum": 1e7}, "zoom": object{"type": "number", "minimum": 0.01, "maximum": 100}})})
	view3d := strictObject([]string{"mode", "camera"}, object{"mode": object{"type": "string", "enum": []string{"3d"}}, "camera": ref("SpatialCamera")})
	schemas["StoryboardView"] = object{"oneOf": []any{view2d, view3d}, "description": "Saved view requires its matching current mode and Details (semantic overview off); mismatches return 422 before navigation or video export. Choose Details or omit view to auto-fit the same canonical objects in either mode, including overview."}
	schemas["StoryboardScene"] = strictObject([]string{"id", "name", "nodeIds", "edgeIds", "narration", "seconds", "transitionMs"}, object{
		"id": object{"type": "string", "format": "uuid"}, "name": object{"type": "string", "minLength": 1, "maxLength": 200}, "nodeIds": uuidList(20000), "edgeIds": uuidList(20000), "narration": object{"type": "string", "maxLength": 12000},
		"seconds": object{"type": "number", "minimum": 2, "maximum": 600}, "transitionMs": object{"type": "number", "minimum": 0, "maximum": 10000}, "view": ref("StoryboardView"),
	})
	schemas["StoryboardScene"].(object)["properties"].(object)["nodeIds"].(object)["minItems"] = 1
	schemas["StoryboardDefinition"] = strictObject([]string{"version", "scenes"}, object{"version": object{"type": "integer", "enum": []int{1}}, "scenes": object{"type": "array", "maxItems": 1000, "items": ref("StoryboardScene")}})
	schemas["StoryboardDefinition"].(object)["description"] = "Up to 1,000 unique scene UUIDs and 100,000 total canonical object/relationship references. Scene narration is independent of node descriptions. Each referenced ID exists in this graph; edge endpoints also participate in framing/highlighting. Playback temporarily highlights selected content, auto-fits or uses saved views and preserves canonical graph layout. Storyboards coexist with legacy numbering."
	schemas["StoryboardUpdate"] = versionedInput("storyboard", "StoryboardDefinition")
	schemas["PresentationSeek"] = strictObject([]string{"index"}, object{"index": object{"type": "integer", "minimum": 0, "maximum": 9007199254740991, "description": "Zero-based existing step in the active presentation source."}})
	source := object{"type": "string", "enum": []string{"nodes", "storyboard"}, "default": "nodes"}
	schemas["PresentationOpenInput"].(object)["properties"].(object)["source"] = source
	schemas["PresentationVideoInput"].(object)["properties"].(object)["source"] = object{"type": "string", "enum": []string{"nodes", "storyboard"}, "description": "Defaults to the current player source."}
	schemas["PresentationVideoInput"].(object)["description"] = "Optional audio/subtitles booleans and nodes/storyboard source. Omitted values use current player options/source. Export starts at the first numbered step or scene. Uses per-scene narration/timing/view/highlights and the same local voices, subtitle paging, limits and cancellation rules."
	runtime := schemas["PresentationRuntime"].(object)
	properties := runtime["properties"].(object)
	properties["source"] = source
	properties["sceneId"] = object{"type": "string", "format": "uuid", "nullable": true}
	properties["nodeIds"] = uuidList(20000)
	properties["edgeIds"] = uuidList(20000)
	properties["title"] = object{"type": "string"}
	properties["narration"] = object{"type": "string"}
	runtime["required"] = append(runtime["required"].([]string), "source", "sceneId", "nodeIds", "edgeIds", "title", "narration")
	video := schemas["PresentationVideoState"].(object)
	video["properties"].(object)["source"] = source
	video["required"] = append(video["required"].([]string), "source")
}
