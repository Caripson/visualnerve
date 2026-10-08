package main

import "sort"

const projectFileLimitPolicyDescription = "ZIP project analyzed source-file limit is independent of the byte budget: browser-local setting project-source-file-limit, default 500, integer 500..10000. GET /settings/project-source-file-limit returns the effective integer (500 when missing or invalid); Read only is allowed. PUT with exact {value:number} requires Read + write. Only projects with up to 500 analyzed source files are supported and guaranteed; higher values are experimental. The setting is excluded from backups and ignored during Merge/Replace. The saved setting is captured once per ZIP job; source payloads cannot override it. Non-ZIP source-file/folder imports remain limited to 500 files. The 10,000 ZIP-entry limit includes ignored files and directory records, so fewer than 10,000 source files may fit. Graph, symbol, connection, line, byte and time limits remain unchanged. Use folders mode for larger projects. GET /code/capabilities discovers these independent limits."

func projectFileLimitValueSchema() object {
	return object{"type": "integer", "minimum": 500, "maximum": 10000, "default": 500}
}

func projectFileLimitSettingSchema() object {
	return object{"type": "object", "additionalProperties": false, "required": []string{"value"},
		"properties": object{"value": projectFileLimitValueSchema()}, "description": projectFileLimitPolicyDescription}
}

func codeCapabilitiesSchema() object {
	integer := func() object { return object{"type": "integer", "minimum": 0} }
	record := func(props object) object {
		required := []string{}
		for key := range props {
			required = append(required, key)
		}
		sort.Strings(required)
		return object{"type": "object", "additionalProperties": false, "required": required, "properties": props}
	}
	return record(object{
		"version":     object{"type": "integer", "enum": []int{1}},
		"modes":       object{"type": "array", "items": object{"type": "string", "enum": []string{"files", "symbols", "folders"}}},
		"sourceFiles": record(object{"maximum": integer()}),
		"zipProjects": record(object{"sourceFileLimit": record(object{"setting": object{"type": "string"}, "default": integer(), "minimum": integer(), "maximum": integer()}), "maximumEntries": integer(), "scanTimeoutMs": integer()}),
		"byteLimit":   record(object{"setting": object{"type": "string"}, "default": integer(), "maximum": integer()}),
		"analysis":    record(object{"maximumNodes": integer(), "maximumSymbols": integer(), "maximumEdges": integer(), "maximumLinesPerFile": integer(), "maximumProjectLines": integer(), "maximumLineLength": integer(), "timeoutMs": integer()}),
	})
}
