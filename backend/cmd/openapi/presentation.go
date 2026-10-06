package main

func addPresentationSchemas(schemas object) {
	schemas["PresentationDefinition"] = object{
		"type": "object", "additionalProperties": false,
		"required":    []string{"version", "nodeIds", "secondsPerNode", "transitionMs"},
		"description": "Ordered native node UUIDs, unique and existing in the same diagram, maximum 20,000. Array positions are contiguous presentation numbers starting at 1. Missing settings use an empty sequence and default timings.",
		"properties": object{
			"version":        object{"type": "integer", "enum": []int{1}},
			"nodeIds":        object{"type": "array", "uniqueItems": true, "maxItems": 20000, "items": object{"type": "string", "format": "uuid"}},
			"secondsPerNode": object{"type": "number", "minimum": 2, "maximum": 600, "default": 8},
			"transitionMs":   object{"type": "number", "minimum": 0, "maximum": 10000, "default": 1200},
		},
	}
	schemas["PresentationUpdate"] = object{"type": "object", "additionalProperties": false, "required": []string{"baseVersion", "presentation"}, "properties": object{"baseVersion": object{"type": "integer", "minimum": 1}, "presentation": ref("PresentationDefinition")}}
	schemas["PresentationEmptyInput"] = object{"type": "object", "additionalProperties": false, "properties": object{}}
	schemas["PresentationOpenInput"] = object{"type": "object", "additionalProperties": false, "properties": object{"diagramId": object{"type": "string", "format": "uuid", "description": "Defaults to the currently open diagram."}}}
	schemas["PresentationOptions"] = object{"type": "object", "additionalProperties": false, "minProperties": 1, "properties": object{"audio": object{"type": "boolean", "default": false}, "subtitles": object{"type": "boolean", "default": true}, "preload": object{"type": "boolean", "default": false}}}
	schemas["PresentationRuntime"] = object{
		"type": "object", "additionalProperties": false,
		"required":    []string{"open", "diagramId", "status", "index", "total", "nodeId", "audio", "subtitles", "preload", "buffered", "progress", "message"},
		"description": "Transient connected-browser playback state; camera navigation works in the current 2D or 3D view. Does not rewrite the canonical presentation sequence.",
		"properties": object{
			"open": object{"type": "boolean"}, "diagramId": object{"type": "string", "format": "uuid", "nullable": true},
			"status": object{"type": "string", "enum": []string{"idle", "loading", "moving", "playing", "paused", "ended", "error"}},
			"index":  object{"type": "integer", "minimum": -1, "description": "Zero-based active index, -1 for an empty sequence."},
			"total":  object{"type": "integer", "minimum": 0, "maximum": 20000}, "nodeId": object{"type": "string", "format": "uuid", "nullable": true},
			"audio": object{"type": "boolean"}, "subtitles": object{"type": "boolean"}, "preload": object{"type": "boolean"},
			"buffered": object{"type": "integer", "minimum": 0, "description": "Prepared audio clips in the lookahead buffer."},
			"progress": object{"type": "number", "minimum": 0, "maximum": 1}, "message": object{"type": "string"},
		},
	}
	voice := object{"type": "string", "enum": []string{"en_US-ljspeech-high", "en_GB-cori-high", "sv_SE-nst-medium"}, "default": "en_US-ljspeech-high"}
	schemas["PresentationVoiceId"] = voice
	schemas["PresentationVoiceSetting"] = object{"type": "object", "additionalProperties": false, "required": []string{"value"}, "properties": object{"value": ref("PresentationVoiceId")}}
	schemas["PresentationVoice"] = object{"type": "object", "additionalProperties": false, "required": []string{"id", "label", "language", "sampleRate", "modelBytes", "license", "source"}, "properties": object{
		"id": ref("PresentationVoiceId"), "label": object{"type": "string"}, "language": object{"type": "string", "enum": []string{"en", "sv"}},
		"sampleRate": object{"type": "integer", "minimum": 1}, "modelBytes": object{"type": "integer", "minimum": 1}, "license": object{"type": "string"}, "source": object{"type": "string", "format": "uri"},
	}}
	schemas["PresentationVoices"] = object{"type": "object", "additionalProperties": false, "required": []string{"defaultVoiceId", "voices"}, "properties": object{"defaultVoiceId": ref("PresentationVoiceId"), "voices": object{"type": "array", "items": ref("PresentationVoice")}}}
}

func addPresentationPaths(add func(string, string, string, string, string, string)) {
	add("GET", "/diagrams/{diagramId}/presentation", "Read the saved ordered presentation or empty defaults", "", "PresentationDefinition", "200")
	add("PUT", "/diagrams/{diagramId}/presentation", "Save an exact presentation definition transactionally at baseVersion; stale versions return 409; write access required", "PresentationUpdate", "Graph", "200")
	add("GET", "/presentation", "Read transient playback state, including when closed; read-only access allowed", "", "PresentationRuntime", "200")
	add("PATCH", "/presentation", "Change audio/subtitles/preload playback options; write access required", "PresentationOptions", "PresentationRuntime", "200")
	add("POST", "/presentation/open", "Open presentation for the current or requested diagram; write access required", "PresentationOpenInput", "PresentationRuntime", "200")
	for _, action := range []string{"play", "pause", "rewind", "forward", "close", "preload"} {
		add("POST", "/presentation/"+action, "Presentation "+action+"; exact empty object body and write access required", "PresentationEmptyInput", "PresentationRuntime", "200")
	}
	add("GET", "/presentation/voices", "Discover English and Swedish local neural voice models, sizes, licenses and sources", "", "PresentationVoices", "200")
	add("GET", "/settings/presentation-voice", "Read selected browser-local presentation voice; missing values use en_US-ljspeech-high", "", "PresentationVoiceId", "200")
	add("PUT", "/settings/presentation-voice", "Select a catalogued browser-local presentation voice; write access required", "PresentationVoiceSetting", "", "200")
}
