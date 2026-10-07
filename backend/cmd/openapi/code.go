package main

// Keep the language-analysis contract independent of general entity schemas.
func addCodeSchemas(schemas object) {
	languages := []string{"python", "javascript", "typescript", "java", "csharp", "cpp", "c", "sql", "go", "rust", "php", "kotlin", "swift", "shell", "r", "dart", "ruby", "powershell", "dax", "powerquery", "vba", "scala", "lua", "matlab", "objective-c", "perl", "groovy", "vbnet", "julia", "elixir", "solidity", "haskell", "fsharp", "clojure", "tsql", "plsql", "sas", "apex", "abap", "cobol", "fortran", "assembly", "pascal", "gdscript", "graphql", "mdx", "cypher", "vega", "hcl", "nix"}
	text := func(max int) object { return object{"type": "string", "minLength": 1, "maxLength": max} }
	count := func(max int) object { return object{"type": "integer", "minimum": 0, "maximum": max} }
	list := func(item object, max int) object { return object{"type": "array", "maxItems": max, "items": item} }
	record := func(required []string, props object) object {
		return object{"type": "object", "additionalProperties": false, "required": required, "properties": props}
	}
	schemas["CodeLanguage"] = object{"type": "string", "enum": languages}
	schemas["CodeLanguageDefinition"] = record([]string{"id", "name", "extensions", "family", "capabilities"}, object{
		"id": ref("CodeLanguage"), "name": text(100), "extensions": list(text(100), 30), "family": text(100), "capabilities": list(text(100), 30),
	})
	schemas["CodeFile"] = record([]string{"path", "content"}, object{
		"path": text(500), "content": object{"type": "string", "maxLength": absoluteImportByteLimit}, "language": ref("CodeLanguage"),
	})
	schemas["CodeFile"].(object)["description"] = "Relative unique file path. Explicit language is required for ambiguous extensions such as .m; SQL defaults to SQL, use tsql/plsql explicitly for dialects. Source is analyzed locally and never executed."
	schemas["CodeInput"] = record([]string{"files"}, object{
		"name": text(500), "files": list(ref("CodeFile"), 500), "mode": object{"type": "string", "enum": []string{"files", "symbols"}, "description": "Optional detail level. When omitted, one file uses symbols (declarations and dependencies); multiple files use files (project overview). An explicit files or symbols choice is always preserved. Preview and saved code analysis return the resolved mode."}, "focus": text(500),
	})
	schemas["CodeInput"].(object)["properties"].(object)["files"].(object)["minItems"] = 1
	schemas["CodeInput"].(object)["description"] = importLimitPolicyDescription + " Code applies that selected decoded UTF-8 byte limit to each file and to the total project (50 MiB each by default), with an absolute 1 GiB ceiling. Other limits: 500 files, 100,000 lines per file, 500,000 project lines, 20,000 characters per line, 10,000 extracted symbols, 5,000 diagram objects and 10,000 diagram connections; 30-second worker deadline. Structural outline, not compiler verification. Focus matches path/name substrings case-insensitively and includes immediate neighbors. Original source/comments/string literals are not saved; names/paths are retained."
	schemas["CodeObject"] = record([]string{"version", "language", "path", "kind", "name"}, object{
		"version": object{"type": "integer", "enum": []int{1}}, "language": ref("CodeLanguage"), "path": text(500), "kind": object{"type": "string", "enum": []string{"file", "class", "function", "type", "resource", "query", "measure", "variable", "external"}}, "name": text(500), "line": object{"type": "integer", "minimum": 1}, "endLine": object{"type": "integer", "minimum": 1}, "external": object{"type": "boolean"}, "summary": list(text(500), 200),
	})
	schemas["CodeEvidence"] = record([]string{"path", "line"}, object{"path": text(500), "line": object{"type": "integer", "minimum": 1}})
	schemas["CodeRelation"] = record([]string{"version", "kind", "confidence"}, object{
		"version": object{"type": "integer", "enum": []int{1}}, "kind": object{"type": "string", "enum": []string{"contains", "imports", "calls", "inherits", "references", "reads", "writes", "depends-on"}}, "confidence": object{"type": "string", "enum": []string{"syntax", "heuristic", "unresolved"}}, "evidence": ref("CodeEvidence"),
	})
	schemas["CodeAnalysis"] = record([]string{"version", "languages", "mode", "fileCount", "symbolCount", "dependencyCount", "unresolvedCount", "warnings"}, object{
		"version": object{"type": "integer", "enum": []int{1}}, "languages": list(ref("CodeLanguage"), 50), "mode": object{"type": "string", "enum": []string{"files", "symbols"}}, "fileCount": count(500), "symbolCount": count(10000), "dependencyCount": count(10000), "unresolvedCount": count(10000), "warnings": list(text(1000), 100), "focus": text(500),
	})
	schemas["CodeAnalysis"].(object)["properties"].(object)["languages"].(object)["minItems"] = 1
	schemas["CodeAnalysis"].(object)["properties"].(object)["languages"].(object)["uniqueItems"] = true
	schemas["CodeImportResult"] = clone(schemas["CodeAnalysis"].(object))
	schemas["CodeImportResult"].(object)["properties"].(map[string]any)["graph"] = ref("Graph")
	schemas["CodeImportResult"].(object)["required"] = []string{"version", "languages", "mode", "fileCount", "symbolCount", "dependencyCount", "unresolvedCount", "warnings", "graph"}
}
