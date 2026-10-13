package main

import (
	"sort"
	"strings"
	"visualnerve/internal/model"
)

const robloxPolicy = "Roblox Game Builder uses bridge/browser 0.11.0 and roblox-game-builder-v1 with the existing two MCP tools. Diagram.game is the portable strict GameDefinition schemaVersion:1; world coordinates are Roblox studs, never canvas pixels. The browser's shared validator, expansion and compiler are authoritative for the UI and REST/MCP. No arbitrary executable-script fields, remote-asset references or Roblox credentials are accepted in the game AST; strings remain escaped data. Read GET /roblox/capabilities and the exact endpoint documentation first. GET .../roblox/configuration returns {diagramId,baseVersion,configuration:{schemaVersion,id,name,description,settings}} without collections. PATCH on that path accepts {baseVersion,value:{name?,description?,settings?:partialSettings}}, preserves omitted fields and rejects null, arrays, unknown fields and id/schemaVersion changes before canonical validation/save. Combine configuration with all collection pages using the same baseVersion, restarting reads if any version differs; this reconstructs valid large saved drafts without requiring a successful build. Configuration edits require Read + write and use normal operation recovery. Dedicated PUT and collection CRUD require baseVersion and Read + write; omission preserves partial fields, nested null clears optional properties, arrays replace, and the whole resolved game is validated before an atomic save. Full/new game records reject null and unsupported fields. Pure validation and captured-current-model build jobs permit Read only and allocate no recoverable write receipt; build input cannot substitute an unsaved shadow game. Jobs and artifact bytes are transient, bounded to the original unlocked workspace session and grant, and discarded on lock, reload or access revocation. Standard native JSON, history, templates and encrypted backups retain the game definition, never build artifacts or publication credentials. Live collaboration does not support game documents and rejects them rather than silently dropping their semantics. Local preview is a simplified game-rule preview, not Roblox multiplayer or physics certification. The optional bridge publication broker is a separate browser-UI-only protocol, never a REST/MCP confirmation route. A human must configure a fixed existing Universe/Place and scoped key in the local bridge process, retain an explicit current Read + write grant, and review the exact artifact/destination through the native browser action plus a fresh one-use phrase in the independent foreground bridge terminal. Self-declared Origin/grant fields and MCP tokens cannot supply terminal approval. No request or ENV auto-approval exists; non-TTY and MCP-stdio publisher startup fails closed, with Studio export still available. Preparation, terminal approval and HTTP each have a 60-second budget. Before dispatch the broker rechecks the original peer/origin/grant and current write access; denial or cancellation while awaiting approval sends no request. It uses one fixed HTTPS Open Cloud request, no arbitrary hosts, redirects or automatic retry. Publication is limited to 10 MiB UTF-8 game.rbxlx. Ambiguous outcomes require Creator Dashboard version-history review and a separate UI acknowledgment before another begin; no exactly-once guarantee spans browser or bridge restart. A compromised local process or same-origin script is outside the trusted-click boundary."

var robloxCollections = []string{"entities", "rules", "variables", "items", "quests", "timers", "prefabs", "instances"}

func supportedCreationTemplateKeys() []string {
	keys := append([]string{"time-series-analysis", "ibm-flowcharting"}, model.NotationTemplateKeys...)
	keys = append(keys, infrastructureTemplateKeys...)
	return append(keys, "roblox-game-builder")
}

func robloxID() object {
	return object{"type": "string", "minLength": 1, "maxLength": 96, "pattern": `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}(?![\s\S])`, "description": "Stable game-local ID, not a native graph UUID. IDs and references are validated after prefab expansion."}
}
func robloxReference() object { return object{"type": "string", "minLength": 1, "maxLength": 200} }
func robloxText(max int, nonempty bool) object {
	result := object{"type": "string", "maxLength": max, "description": "UTF-16 code units; XML-invalid controls and lone surrogates reject. Names must contain non-whitespace text."}
	if nonempty {
		result["minLength"] = 1
	}
	return result
}
func robloxNumber(min, max float64) object {
	return object{"type": "number", "minimum": min, "maximum": max}
}
func robloxInteger(min, max int) object {
	return object{"type": "integer", "minimum": min, "maximum": max}
}
func robloxArray(name string, max int) object {
	return object{"type": "array", "maxItems": max, "items": ref(name)}
}
func robloxVector(min, max float64) object {
	return strictObject([]string{"x", "y", "z"}, object{"x": robloxNumber(min, max), "y": robloxNumber(min, max), "z": robloxNumber(min, max)})
}

func robloxExpressionSchemas(schemas object, prefix string, parameter bool) {
	variant := func(kind string, props object) object {
		props["kind"] = simEnum(kind)
		required := []string{"kind"}
		for key := range props {
			if key != "kind" {
				required = append(required, key)
			}
		}
		sort.Strings(required)
		return strictObject(required, props)
	}
	expressions := []any{variant("literal", object{"value": ref("RobloxValue")}), variant("variable", object{"variableId": robloxReference()}), variant("inventory", object{"itemId": robloxReference()}), variant("questProgress", object{"questId": robloxReference()}), variant("questState", object{"questId": robloxReference()}), variant("arithmetic", object{"operator": simEnum("+", "-", "*", "/"), "left": ref(prefix + "Expression"), "right": ref(prefix + "Expression")})}
	if parameter {
		expressions = append(expressions, variant("parameter", object{"parameterId": robloxReference()}))
	}
	schemas[prefix+"Expression"] = object{"oneOf": expressions, "description": "Recursive typed AST depth at most 12; arithmetic and consuming actions require compatible value types. Finite values are bounded to ±1e12. No arbitrary source code.", "x-visual-nerve-max-depth": 12}
	conditions := object{"type": "array", "minItems": 1, "maxItems": 64, "items": ref(prefix + "Condition")}
	schemas[prefix+"Condition"] = object{"oneOf": []any{variant("compare", object{"operator": simEnum("==", "!=", ">", ">=", "<", "<="), "left": ref(prefix + "Expression"), "right": ref(prefix + "Expression")}), variant("all", object{"conditions": conditions}), variant("any", object{"conditions": conditions}), variant("not", object{"condition": ref(prefix + "Condition")})}, "description": "Condition nesting at most 12; comparison operands must have compatible types.", "x-visual-nerve-max-depth": 12}
	actions := []any{}
	add := func(kinds []string, props object) {
		for _, kind := range kinds {
			actions = append(actions, variant(kind, clone(props)))
		}
	}
	add([]string{"setVariable", "addVariable"}, object{"variableId": robloxReference(), "value": ref(prefix + "Expression")})
	add([]string{"giveItem", "removeItem"}, object{"itemId": robloxReference(), "amount": ref(prefix + "Expression")})
	add([]string{"startQuest", "completeQuest"}, object{"questId": robloxReference()})
	add([]string{"advanceQuest"}, object{"questId": robloxReference(), "amount": ref(prefix + "Expression")})
	add([]string{"startTimer", "stopTimer"}, object{"timerId": robloxReference()})
	add([]string{"setEntityEnabled", "setEntityVisible", "setEntityCollidable"}, object{"entityId": robloxReference(), "value": object{"type": "boolean"}})
	add([]string{"teleport", "setCheckpoint"}, object{"entityId": robloxReference()})
	add([]string{"message"}, object{"text": robloxText(2000, false)})
	add([]string{"damage", "heal"}, object{"amount": ref(prefix + "Expression")})
	add([]string{"win"}, object{"message": robloxText(2000, false)})
	add([]string{"startRound", "endRound"}, object{})
	schemas[prefix+"Action"] = object{"oneOf": actions}
	schemas[prefix+"Rule"] = strictObject([]string{"id", "name", "enabled", "event", "actions", "cooldown", "oncePerPlayer"}, object{"id": robloxID(), "name": robloxText(120, true), "enabled": object{"type": "boolean"}, "event": ref("RobloxEvent"), "condition": ref(prefix + "Condition"), "actions": object{"type": "array", "minItems": 1, "maxItems": 64, "items": ref(prefix + "Action")}, "cooldown": robloxNumber(0, 86400), "oncePerPlayer": object{"type": "boolean"}})
}

func addRobloxSchemas(schemas object) {
	schemas["RobloxValue"] = object{"oneOf": []any{robloxText(2000, false), robloxNumber(-1e12, 1e12), object{"type": "boolean"}}}
	color := object{"type": "string", "minLength": 7, "maxLength": 7, "pattern": `^#[0-9a-fA-F]{6}(?![\s\S])`}
	schemas["RobloxTransform"] = strictObject([]string{"position", "rotation", "size"}, object{"position": robloxVector(-100000, 100000), "rotation": robloxVector(-36000, 36000), "size": robloxVector(.05, 2048)})
	entityProps := object{"id": robloxID(), "name": robloxText(120, true), "kind": simEnum("spawn", "platform", "checkpoint", "hazard", "collectible", "door", "goal", "npc", "zone", "decoration", "movingPlatform"), "transform": ref("RobloxTransform"), "color": color, "material": simEnum("Plastic", "SmoothPlastic", "Neon", "Wood", "Metal", "Glass", "Grass", "Concrete"), "anchored": object{"type": "boolean"}, "collidable": object{"type": "boolean"}, "visible": object{"type": "boolean"}, "enabled": object{"type": "boolean"}, "movement": strictObject([]string{"offset", "duration"}, object{"offset": robloxVector(-100000, 100000), "duration": robloxNumber(.1, 3600)})}
	schemas["RobloxEntity"] = strictObject([]string{"id", "name", "kind", "transform", "color", "material", "anchored", "collidable", "visible", "enabled"}, entityProps)
	schemas["RobloxEntity"].(object)["description"] = "movement is permitted only for movingPlatform. movingPlatform and npc must be anchored. Stored world coordinates are studs. Unsupported combinations reject rather than being silently simplified."
	schemas["RobloxEntity"].(object)["oneOf"] = []any{
		object{"required": []string{"kind", "movement"}, "properties": object{"kind": simEnum("movingPlatform"), "anchored": object{"type": "boolean", "enum": []bool{true}}}},
		object{"required": []string{"kind"}, "properties": object{"kind": simEnum("npc"), "anchored": object{"type": "boolean", "enum": []bool{true}}}, "not": object{"required": []string{"movement"}}},
		object{"required": []string{"kind"}, "properties": object{"kind": simEnum("spawn", "platform", "checkpoint", "hazard", "collectible", "door", "goal", "zone", "decoration")}, "not": object{"required": []string{"movement"}}},
	}
	events := []any{}
	for _, kind := range []string{"playerJoin", "roundStart", "roundEnd"} {
		events = append(events, strictObject([]string{"kind"}, object{"kind": simEnum(kind)}))
	}
	for _, kind := range []string{"touch", "interact"} {
		events = append(events, strictObject([]string{"kind", "entityId"}, object{"kind": simEnum(kind), "entityId": robloxReference()}))
	}
	events = append(events, strictObject([]string{"kind", "timerId"}, object{"kind": simEnum("timer"), "timerId": robloxReference()}))
	schemas["RobloxEvent"] = object{"oneOf": events}
	robloxExpressionSchemas(schemas, "Roblox", false)
	robloxExpressionSchemas(schemas, "RobloxPrefab", true)
	scope := simEnum("player", "shared")
	schemas["RobloxVariable"] = strictObject([]string{"id", "name", "scope", "initial"}, object{"id": robloxID(), "name": robloxText(120, true), "scope": scope, "initial": ref("RobloxValue"), "min": robloxNumber(-1e12, 1e12), "max": robloxNumber(-1e12, 1e12)})
	schemas["RobloxVariable"].(object)["description"] = "Numeric min/max require a numeric initial value, min≤max and initial within bounds. Shared-timer rules cannot consume per-player state."
	schemas["RobloxItem"] = strictObject([]string{"id", "name", "maxStack"}, object{"id": robloxID(), "name": robloxText(120, true), "maxStack": robloxInteger(1, 1000000)})
	schemas["RobloxQuest"] = strictObject([]string{"id", "name", "description", "target"}, object{"id": robloxID(), "name": robloxText(120, true), "description": robloxText(2000, false), "target": robloxInteger(1, 1000000)})
	schemas["RobloxTimer"] = strictObject([]string{"id", "name", "scope", "duration", "repeat"}, object{"id": robloxID(), "name": robloxText(120, true), "scope": scope, "duration": robloxNumber(.1, 86400), "repeat": object{"type": "boolean"}})
	schemas["RobloxPrefabParameter"] = strictObject([]string{"id", "name", "default"}, object{"id": robloxID(), "name": robloxText(120, true), "default": ref("RobloxValue")})
	schemas["RobloxPrefabBinding"] = strictObject([]string{"entityId", "property", "parameterId"}, object{"entityId": robloxReference(), "property": simEnum("color", "enabled", "visible", "collidable", "position.x", "position.y", "position.z", "size.x", "size.y", "size.z", "movement.duration"), "parameterId": robloxReference()})
	schemas["RobloxPrefab"] = strictObject([]string{"id", "name", "entities", "rules"}, object{"id": robloxID(), "name": robloxText(120, true), "entities": robloxArray("RobloxEntity", 1000), "rules": robloxArray("RobloxPrefabRule", 1000), "parameters": robloxArray("RobloxPrefabParameter", 64), "bindings": robloxArray("RobloxPrefabBinding", 256)})
	schemas["RobloxInstance"] = strictObject([]string{"id", "name", "prefabId", "position", "rotation"}, object{"id": robloxID(), "name": robloxText(120, true), "prefabId": robloxReference(), "position": robloxVector(-100000, 100000), "rotation": robloxVector(-36000, 36000), "parameters": object{"type": "object", "additionalProperties": ref("RobloxValue"), "description": "Only parameters declared by the selected prefab, with matching value types and binding bounds."}})
	props := object{"schemaVersion": object{"type": "integer", "enum": []int{1}}, "id": robloxID(), "name": robloxText(120, true), "description": robloxText(2000, false), "settings": strictObject([]string{"maxPlayers", "gravity", "walkSpeed", "jumpPower", "respawnSeconds", "ambient"}, object{"maxPlayers": robloxInteger(1, 100), "gravity": robloxNumber(0, 1000), "walkSpeed": robloxNumber(1, 100), "jumpPower": robloxNumber(0, 200), "respawnSeconds": robloxNumber(0, 60), "ambient": color}), "entities": robloxArray("RobloxEntity", 1000), "rules": robloxArray("RobloxRule", 1000), "variables": robloxArray("RobloxVariable", 128), "items": robloxArray("RobloxItem", 128), "quests": robloxArray("RobloxQuest", 128), "timers": robloxArray("RobloxTimer", 128), "prefabs": robloxArray("RobloxPrefab", 128), "instances": robloxArray("RobloxInstance", 256)}
	schemas["RobloxGameDefinition"] = strictObject([]string{"schemaVersion", "id", "name", "description", "settings", "entities", "rules", "variables", "items", "quests", "timers", "prefabs", "instances"}, props)
	schemas["RobloxGameDefinition"].(object)["description"] = robloxPolicy + " Counts are also enforced after prefab expansion: at most 1000 entities and 1000 rules. All references resolve, IDs are unique within their namespaces and all event action batches stay within 8192 actions, including configured player fan-out for round events. Compiler validation additionally requires an enabled spawn; storage drafts may omit one."
	schemas["RobloxDiagnostic"] = strictObject([]string{"severity", "code", "path", "message"}, object{"severity": simEnum("error", "warning"), "code": object{"type": "string"}, "path": object{"type": "string"}, "message": object{"type": "string"}, "entityId": robloxReference(), "ruleId": robloxReference()})
	schemas["RobloxValidation"] = strictObject([]string{"valid", "diagnostics"}, object{"valid": object{"type": "boolean"}, "diagnostics": object{"type": "array", "items": ref("RobloxDiagnostic")}})
	schemas["RobloxValidationInput"] = strictObject(nil, object{"game": object{"nullable": true, "anyOf": []any{ref("RobloxGameDefinition"), object{}}, "description": "Draft JSON is inspected rather than saved. Invalid values, including explicit null, return valid:false diagnostics from the shared validator. Omission validates the saved current game."}})
	schemas["RobloxReplacement"] = strictObject([]string{"baseVersion", "game"}, object{"baseVersion": robloxInteger(1, 9007199254740991), "game": ref("RobloxGameDefinition")})
	schemas["RobloxModelSnapshot"] = strictObject([]string{"diagramId", "baseVersion", "game"}, object{"diagramId": object{"type": "string", "format": "uuid"}, "baseVersion": robloxInteger(1, 9007199254740991), "game": ref("RobloxGameDefinition")})
	schemas["RobloxBuildInput"] = strictObject([]string{"baseVersion"}, object{"baseVersion": robloxInteger(1, 9007199254740991)})
	schemas["RobloxEmptyInput"] = strictObject(nil, object{})
	addRobloxJobSchemas(schemas)
	addRobloxCollectionSchemas(schemas)
	addRobloxConfigurationSchemas(schemas, props)
	addRobloxCapabilities(schemas)
	addRobloxPreviewSchemas(schemas)
	publicationLimits := object{}
	for key, value := range map[string]int{"chunkBytes": 65536, "artifactBytes": 10485760, "pendingPerPeer": 1, "retainedOwners": 64, "pendingBytes": 33554432, "preparationMs": 60000, "approvalMs": 60000, "networkMs": 60000} {
		publicationLimits[key] = object{"type": "integer", "enum": []int{value}}
	}
	keys := []string{}
	for key := range publicationLimits {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	schemas["RobloxPublicationCapabilities"] = strictObject([]string{"configured", "limits", "terminalApprovalRequired"}, object{"configured": object{"type": "boolean"}, "terminalApprovalRequired": object{"type": "boolean", "enum": []bool{true}}, "target": strictObject([]string{"universeId", "placeId"}, object{"universeId": object{"type": "string", "pattern": `^[1-9][0-9]{0,18}(?![\s\S])`}, "placeId": object{"type": "string", "pattern": `^[1-9][0-9]{0,18}(?![\s\S])`}}), "limits": strictObject(keys, publicationLimits)})
	schemas["RobloxPublicationCapabilities"].(object)["description"] = "Safe static bridge metadata only; never a key or publication authority. Actual publication is an optional UI-only WebSocket protocol, never REST/MCP confirmation."
}

func addRobloxConfigurationSchemas(schemas, gameProps object) {
	configuration := object{}
	for _, key := range []string{"schemaVersion", "id", "name", "description", "settings"} {
		configuration[key] = clone(gameProps[key].(object))
	}
	schemas["RobloxConfiguration"] = strictObject([]string{"schemaVersion", "id", "name", "description", "settings"}, configuration)
	schemas["RobloxConfiguration"].(object)["description"] = "Complete game-level configuration without collections; available for saved drafts even when the full model exceeds 512 KiB or cannot yet build. Combine with every collection page at the same baseVersion to reconstruct the canonical model when individual collection entries fit the 512 KiB response limit. Discard and restart reads if any version differs."
	schemas["RobloxConfigurationSnapshot"] = strictObject([]string{"diagramId", "baseVersion", "configuration"}, object{"diagramId": object{"type": "string", "format": "uuid"}, "baseVersion": robloxInteger(1, 9007199254740991), "configuration": ref("RobloxConfiguration")})
	settings := clone(configuration["settings"].(object))
	delete(settings, "required")
	value := strictObject(nil, object{"name": clone(configuration["name"].(object)), "description": clone(configuration["description"].(object)), "settings": settings})
	schemas["RobloxConfigurationPatch"] = strictObject([]string{"baseVersion", "value"}, object{"baseVersion": robloxInteger(1, 9007199254740991), "value": value})
	schemas["RobloxConfigurationPatch"].(object)["description"] = "Versioned configuration edit with Read + write. Only name, description and partial settings may change; omitted values preserve the saved configuration. All configuration fields are required in the model, so null, arrays, unknown fields and id/schemaVersion edits reject. The entire resolved canonical game validates before an atomic save."
}

func addRobloxJobSchemas(schemas object) {
	meta := strictObject([]string{"name", "mimeType", "totalBytes", "sha256"}, object{"name": simEnum("game.rbxlx", "VisualNerve.server.luau", "VisualNerve.client.luau", "VisualNerveImporter.plugin.luau", "game.json", "README.txt"), "mimeType": object{"type": "string"}, "totalBytes": robloxInteger(0, 16*1024*1024), "sha256": object{"type": "string", "minLength": 64, "maxLength": 64, "pattern": `^[a-f0-9]{64}(?![\s\S])`}})
	schemas["RobloxArtifactMetadata"] = meta
	jobProps := object{"jobId": object{"type": "string", "format": "uuid"}, "diagramId": object{"type": "string", "format": "uuid"}, "baseVersion": robloxInteger(1, 9007199254740991), "engineVersion": simEnum("1.0.0"), "schemaVersion": object{"type": "integer", "enum": []int{1}}, "state": simEnum("running", "succeeded", "failed", "cancelled"), "progress": robloxNumber(0, 100), "createdAt": object{"type": "string", "format": "date-time"}, "error": strictObject([]string{"code", "message"}, object{"code": object{"type": "string"}, "message": object{"type": "string"}})}
	schemas["RobloxBuildStatus"] = strictObject([]string{"jobId", "diagramId", "baseVersion", "engineVersion", "schemaVersion", "state", "progress", "createdAt"}, jobProps)
	schemas["RobloxBuildManifest"] = strictObject([]string{"jobId", "diagramId", "baseVersion", "engineVersion", "objects", "rules", "artifacts"}, object{"jobId": jobProps["jobId"], "diagramId": jobProps["diagramId"], "baseVersion": jobProps["baseVersion"], "engineVersion": jobProps["engineVersion"], "objects": robloxInteger(0, 1000), "rules": robloxInteger(0, 1000), "artifacts": object{"type": "array", "maxItems": 6, "items": ref("RobloxArtifactMetadata")}})
	schemas["RobloxArtifactChunk"] = strictObject([]string{"name", "mimeType", "encoding", "offset", "nextOffset", "totalBytes", "content"}, object{"name": object{"type": "string"}, "mimeType": object{"type": "string"}, "encoding": simEnum("base64"), "offset": robloxInteger(0, 16*1024*1024), "nextOffset": object{"type": "integer", "nullable": true, "minimum": 0, "maximum": 16 * 1024 * 1024}, "totalBytes": robloxInteger(0, 16*1024*1024), "content": object{"type": "string", "format": "byte", "maxLength": 87384, "description": "Strict padded base64 of at most 65536 raw bytes; decode bytes before UTF-8 concatenation. Byte offsets are not Unicode character offsets."}})
	schemas["RobloxArtifactList"] = strictObject([]string{"jobId", "artifacts"}, object{"jobId": jobProps["jobId"], "artifacts": object{"type": "array", "maxItems": 6, "items": ref("RobloxArtifactMetadata")}})
}

func addRobloxPaths(add func(string, string, string, string, string, string), paths object) {
	base := "/diagrams/{diagramId}/roblox"
	add("GET", "/roblox/capabilities", "Discover the local game schema, compiler and bounded job support; Read only allowed", "", "RobloxCapabilities", "200")
	add("GET", base, "Read the current canonical game; Read only allowed", "", "RobloxModelSnapshot", "200")
	add("PUT", base, "Replace the canonical game atomically at baseVersion; write required", "RobloxReplacement", "RobloxMutationSummary", "200")
	add("GET", base+"/configuration", "Read bounded game-level configuration without collections; Read only allowed", "", "RobloxConfigurationSnapshot", "200")
	add("PATCH", base+"/configuration", "Edit game name, description or settings atomically at baseVersion; write required", "RobloxConfigurationPatch", "RobloxMutationSummary", "200")
	add("POST", base+"/validate", "Validate current or complete draft game without saving; Read only allowed", "RobloxValidationInput", "RobloxValidationReport", "200")
	paths[base+"/validate"].(object)["post"].(object)["requestBody"].(object)["required"] = false
	add("POST", base+"/preview", "Run a captured rule-input trace without saving or physics; Read only allowed", "RobloxPreviewInput", "RobloxPreviewReport", "200")
	for index, collection := range robloxCollections {
		name := []string{"Entity", "Rule", "Variable", "Item", "Quest", "Timer", "Prefab", "Instance"}[index]
		add("GET", base+"/"+collection, "Page the canonical game collection; Read only allowed", "", "Roblox"+name+"Page", "200")
		add("GET", base+"/"+collection+"/{entityId}", "Read one canonical game entry; Read only allowed", "", "Roblox"+name+"Snapshot", "200")
		add("POST", base+"/"+collection, "Create a typed game entry atomically at baseVersion; write required", "Roblox"+name+"Create", "RobloxMutationSummary", "201")
		add("PATCH", base+"/"+collection+"/{entityId}", "Merge a typed game entry at baseVersion; write required", "Roblox"+name+"Patch", "RobloxMutationSummary", "200")
		add("DELETE", base+"/"+collection+"/{entityId}", "Remove a game entry only when references remain valid; write required", "RobloxBuildInput", "", "204")
		page := paths[base+"/"+collection].(object)["get"].(object)
		parameters := page["parameters"].([]any)
		page["parameters"] = append(parameters, object{"name": "offset", "in": "query", "schema": object{"type": "integer", "minimum": 0, "maximum": 1000, "default": 0}}, object{"name": "limit", "in": "query", "schema": object{"type": "integer", "minimum": 1, "maximum": 200, "default": 100}})
	}
	jobs := base + "/builds"
	add("POST", jobs, "Build the captured current game without saving; Read only allowed", "RobloxBuildInput", "RobloxBuildStatus", "202")
	add("GET", jobs+"/{jobId}", "Read transient build status in its original grant", "", "RobloxBuildStatus", "200")
	add("DELETE", jobs+"/{jobId}", "Cancel and discard a transient build; Read only allowed", "RobloxEmptyInput", "RobloxBuildStatus", "200")
	paths[jobs+"/{jobId}"].(object)["delete"].(object)["requestBody"].(object)["required"] = false
	add("GET", jobs+"/{jobId}/result", "Read the completed compact manifest without duplicate XML", "", "RobloxBuildManifest", "200")
	add("GET", jobs+"/{jobId}/artifacts", "Read completed artifact names, byte sizes and digests", "", "RobloxArtifactList", "200")
	add("GET", jobs+"/{jobId}/artifacts/{artifactName}", "Read at most 64 KiB of exact artifact bytes as base64", "", "RobloxArtifactChunk", "200")
	for path, raw := range paths {
		if path != "/roblox/capabilities" && !strings.HasPrefix(path, base) {
			continue
		}
		for method, value := range raw.(object) {
			op := value.(object)
			op["description"] = robloxPolicy
			responses := op["responses"].(object)
			modelRead := method == "get" && (path == base || strings.HasPrefix(path, base+"/") && !strings.HasPrefix(path, jobs))
			if modelRead || method == "post" && (path == base+"/validate" || path == base+"/preview") {
				responses["413"] = object{"description": "Game model, collection or validation/preview response exceeds the 512 KiB transport limit, or preview exceeds its 8 MiB internal result limit; use smaller collection pages or a shorter trace without history. A single collection entry above 512 KiB still returns 413 at limit=1 and cannot be split further; native diagram JSON export remains the full exchange path, while successful builds also expose chunked game.json model data", "content": object{"application/json": object{"schema": ref("Error")}}}
			}
			if method == "post" && (path == base+"/preview" || path == jobs) {
				responses["429"] = object{"description": "Two rule previews or builds of the requested kind are already active; wait or cancel existing work before starting another", "content": object{"application/json": object{"schema": ref("Error")}}}
			}
			params, _ := op["parameters"].([]any)
			for _, item := range params {
				parameter := item.(object)
				if parameter["name"] == "entityId" {
					parameter["schema"] = robloxID()
				}
				if parameter["name"] == "artifactName" {
					parameter["schema"] = metaArtifactNames()
				}
			}
		}
	}
	chunk := paths[jobs+"/{jobId}/artifacts/{artifactName}"].(object)["get"].(object)
	parameters := chunk["parameters"].([]any)
	chunk["parameters"] = append(parameters, object{"name": "offset", "in": "query", "schema": robloxInteger(0, 16*1024*1024)}, object{"name": "limit", "in": "query", "schema": object{"type": "integer", "minimum": 1, "maximum": 65536, "default": 65536}})
}
func metaArtifactNames() object {
	return simEnum("game.rbxlx", "VisualNerve.server.luau", "VisualNerve.client.luau", "VisualNerveImporter.plugin.luau", "game.json", "README.txt")
}

func robloxReadOperation(path, method string) bool {
	base := "/diagrams/{diagramId}/roblox"
	return method == "post" && (path == base+"/validate" || path == base+"/preview" || path == base+"/builds") || method == "delete" && path == base+"/builds/{jobId}"
}

// Request schemas describe a partial merge, while the authoritative browser
// validates the complete resolved value. Null is valid only for optional fields.
func robloxPartialSchema(value object) object {
	result := clone(value)
	delete(result, "required")
	if properties, ok := result["properties"].(object); ok {
		for key, raw := range properties {
			child := robloxPartialSchema(raw.(object))
			properties[key] = object{"nullable": true, "anyOf": []any{child, object{"nullable": true, "enum": []any{nil}}}}
		}
	}
	if reference, ok := result["$ref"].(string); ok && strings.HasPrefix(reference, "#/components/schemas/Roblox") && !strings.HasSuffix(reference, "Value") {
		result["$ref"] = reference + "Partial"
	}
	if variants, ok := result["oneOf"].([]any); ok {
		delete(result, "oneOf")
		partial := []any{}
		for _, raw := range variants {
			partial = append(partial, robloxPartialSchema(raw.(object)))
		}
		result["anyOf"] = partial
	}
	// Arrays replace as complete arrays; their element schema must stay strict.
	return result
}

func addRobloxCollectionSchemas(schemas object) {
	// All referenced object partials must be registered, including recursive ASTs.
	names := []string{}
	for name := range schemas {
		if strings.HasPrefix(name, "Roblox") {
			names = append(names, name)
		}
	}
	for _, name := range names {
		schemas[name+"Partial"] = robloxPartialSchema(schemas[name].(object))
	}
	for _, name := range []string{"Entity", "Rule", "Variable", "Item", "Quest", "Timer", "Prefab", "Instance"} {
		schemas["Roblox"+name+"Create"] = strictObject([]string{"baseVersion", "value"}, object{"baseVersion": robloxInteger(1, 9007199254740991), "value": ref("Roblox" + name)})
		schemas["Roblox"+name+"Patch"] = strictObject([]string{"baseVersion", "value"}, object{"baseVersion": robloxInteger(1, 9007199254740991), "value": ref("Roblox" + name + "Partial")})
		schemas["Roblox"+name+"Patch"].(object)["description"] = "Deep partial object merge: omitted fields preserve, arrays replace, null removes optional fields. A required field cannot be cleared and the route ID cannot change. Strict validation of the entire resolved game precedes saving."
		schemas["Roblox"+name+"Page"] = strictObject([]string{"diagramId", "baseVersion", "offset", "nextOffset", "total", "items"}, object{"diagramId": object{"type": "string", "format": "uuid"}, "baseVersion": robloxInteger(1, 9007199254740991), "offset": robloxInteger(0, 1000), "nextOffset": object{"type": "integer", "nullable": true, "minimum": 0, "maximum": 1000}, "total": robloxInteger(0, 1000), "items": object{"type": "array", "items": ref("Roblox" + name)}})
		schemas["Roblox"+name+"Snapshot"] = strictObject([]string{"diagramId", "baseVersion", "value"}, object{"diagramId": object{"type": "string", "format": "uuid"}, "baseVersion": robloxInteger(1, 9007199254740991), "value": ref("Roblox" + name)})
	}
	counts := object{}
	for _, collection := range robloxCollections {
		counts[collection] = robloxInteger(0, 1000)
	}
	schemas["RobloxMutationSummary"] = strictObject([]string{"diagramId", "baseVersion", "summary"}, object{"diagramId": object{"type": "string", "format": "uuid"}, "baseVersion": robloxInteger(1, 9007199254740991), "summary": strictObject(robloxCollections, counts)})
	report := clone(schemas["RobloxValidation"].(object))
	report["properties"].(object)["diagramId"] = object{"type": "string", "format": "uuid"}
	report["properties"].(object)["baseVersion"] = robloxInteger(1, 9007199254740991)
	report["required"] = []string{"diagramId", "baseVersion", "valid", "diagnostics"}
	schemas["RobloxValidationReport"] = report
}

func addRobloxCapabilities(schemas object) {
	limits := object{}
	for key, value := range map[string]int{"entities": 1000, "rules": 1000, "variables": 128, "items": 128, "quests": 128, "timers": 128, "prefabs": 128, "instances": 256, "actionsPerRule": 64, "expressionDepth": 12, "conditionDepth": 12, "textLength": 2000, "coordinate": 100000, "size": 2048, "actionBudget": 8192, "eventBudget": 256, "maxArtifactBytes": 16777216, "collectionPage": 200, "transportBytes": 524288, "previewSteps": 128, "previewPlayers": 16} {
		limits[key] = object{"type": "integer", "enum": []int{value}}
	}
	builds := object{}
	for key, value := range map[string]int{"active": 2, "retained": 4, "bytes": 33554432, "deadlineMs": 120000, "retentionMs": 900000, "chunkBytes": 65536} {
		builds[key] = object{"type": "integer", "enum": []int{value}}
	}
	buildRequired := []string{}
	for key := range builds {
		buildRequired = append(buildRequired, key)
	}
	limits["builds"] = strictObject(buildRequired, builds)
	sort.Strings(buildRequired)
	limitRequired := []string{}
	for key := range limits {
		limitRequired = append(limitRequired, key)
	}
	sort.Strings(limitRequired)
	stringsArray := func(values ...string) object { return object{"type": "array", "items": simEnum(values...)} }
	props := object{"capability": simEnum("roblox-game-builder-v1"), "schemaVersion": object{"type": "integer", "enum": []int{1}}, "engineVersion": simEnum("1.0.0"), "templateId": simEnum("roblox-game-builder"), "documentType": simEnum("flowchart"), "modelPath": simEnum("diagram.game"), "configurationPath": simEnum("/diagrams/{diagramId}/roblox/configuration"), "collections": stringsArray(robloxCollections...), "entityKinds": stringsArray("spawn", "platform", "checkpoint", "hazard", "collectible", "door", "goal", "npc", "zone", "decoration", "movingPlatform"), "events": stringsArray("playerJoin", "touch", "interact", "timer", "roundStart", "roundEnd"), "actions": stringsArray("setVariable", "addVariable", "giveItem", "removeItem", "startQuest", "completeQuest", "advanceQuest", "startTimer", "stopTimer", "setEntityEnabled", "setEntityVisible", "setEntityCollidable", "teleport", "setCheckpoint", "message", "damage", "heal", "win", "startRound", "endRound"), "permissions": strictObject([]string{"read", "write"}, object{"read": stringsArray("model", "configuration", "collections", "validate", "preview", "build", "build-result", "cancel-build"), "write": stringsArray("replace-model", "update-configuration", "collection-create", "collection-update", "collection-delete")}), "coordinates": strictObject([]string{"world", "rotation", "diagram"}, object{"world": simEnum("Roblox studs"), "rotation": simEnum("degrees"), "diagram": object{"type": "string"}}), "persistence": object{"type": "string"}, "collaboration": object{"type": "boolean", "enum": []bool{false}}, "limits": strictObject(limitRequired, limits), "artifacts": stringsArray("game.rbxlx", "game.json", "VisualNerve.server.luau", "VisualNerve.client.luau", "VisualNerveImporter.plugin.luau", "README.txt"), "publication": object{"type": "string"}, "preview": object{"type": "string"}, "unsupported": object{"type": "array", "items": object{"type": "string"}}}
	required := []string{}
	for key := range props {
		required = append(required, key)
	}
	sort.Strings(required)
	schemas["RobloxCapabilities"] = strictObject(required, props)
	schemas["RobloxCapabilities"].(object)["description"] = robloxPolicy
}

func addRobloxPreviewSchemas(schemas object) {
	steps := []any{}
	for _, kind := range []string{"join", "leave", "respawn"} {
		steps = append(steps, strictObject([]string{"kind", "playerId"}, object{"kind": simEnum(kind), "playerId": robloxID()}))
	}
	for _, kind := range []string{"touch", "interact"} {
		steps = append(steps, strictObject([]string{"kind", "playerId", "entityId"}, object{"kind": simEnum(kind), "playerId": robloxID(), "entityId": robloxReference()}))
	}
	steps = append(steps, strictObject([]string{"kind", "seconds"}, object{"kind": simEnum("advance"), "seconds": robloxNumber(0, 86400)}))
	schemas["RobloxPreviewInput"] = strictObject([]string{"steps"}, object{"steps": object{"type": "array", "maxItems": 128, "items": object{"oneOf": steps}}, "history": object{"type": "boolean", "default": false}})
	schemas["RobloxPreviewInput"].(object)["description"] = "At most 128 explicit input steps and 16 distinct players, within configured maxPlayers. Join before acting, leave before rejoining; referenced entities must exist after expansion. Total advanced time is at most 86400 seconds. Timer/round events arise from typed rules rather than request inputs. Same local deterministic rule engine as the UI; no Roblox physics/network simulation. Captured worker supports 2 active previews, a 30-second deadline and 8 MiB internal results, further bounded to 512 KiB for REST/MCP transport."
	record := func(item object) object { return object{"type": "object", "additionalProperties": item} }
	quest := strictObject([]string{"state", "progress"}, object{"state": simEnum("inactive", "active", "complete"), "progress": robloxNumber(0, 1e12)})
	player := strictObject([]string{"id", "variables", "inventory", "quests", "health", "position", "won", "messages"}, object{"id": robloxID(), "variables": record(ref("RobloxValue")), "inventory": record(robloxNumber(0, 1e12)), "quests": record(quest), "health": robloxNumber(0, 100), "position": robloxVector(-1e12, 1e12), "checkpoint": robloxReference(), "won": object{"type": "boolean"}, "messages": object{"type": "array", "items": object{"type": "string"}}})
	schemas["RobloxPreviewSnapshot"] = strictObject([]string{"time", "roundActive", "shared", "players", "entities", "notices"}, object{"time": robloxNumber(0, 86400), "roundActive": object{"type": "boolean"}, "shared": record(ref("RobloxValue")), "players": object{"type": "array", "maxItems": 16, "items": player}, "entities": record(strictObject([]string{"enabled", "visible", "collidable"}, object{"enabled": object{"type": "boolean"}, "visible": object{"type": "boolean"}, "collidable": object{"type": "boolean"}})), "notices": object{"type": "array", "items": object{"type": "string"}}})
	schemas["RobloxPreviewReport"] = strictObject([]string{"diagramId", "baseVersion", "snapshot"}, object{"diagramId": object{"type": "string", "format": "uuid"}, "baseVersion": robloxInteger(1, 9007199254740991), "snapshot": ref("RobloxPreviewSnapshot"), "history": object{"type": "array", "maxItems": 129, "items": ref("RobloxPreviewSnapshot"), "description": "When requested, initial snapshot followed by each accepted input step."}})
}

func addRobloxDiscovery(schemas, paths object) {
	schemas["Health"].(object)["properties"].(object)["robloxPublishing"] = ref("RobloxPublicationCapabilities")
	summary := strictObject([]string{"schemaVersion", "engineVersion", "entities", "rules", "prefabs", "instances"}, object{"schemaVersion": object{"type": "integer", "enum": []int{1}}, "engineVersion": simEnum("1.0.0"), "entities": robloxInteger(0, 1000), "rules": robloxInteger(0, 1000), "prefabs": robloxInteger(0, 128), "instances": robloxInteger(0, 256)})
	diagram := clone(schemas["Diagram"].(object))
	delete(diagram["properties"].(object), "game")
	diagram["properties"].(object)["gameSummary"] = summary
	diagram["required"] = []string{"name", "type", "gameSummary"}
	schemas["RobloxDiagramSummary"] = diagram
	addQuery(paths, "/diagrams", "roblox", simEnum("true"), false)
	op := paths["/diagrams"].(object)["get"].(object)
	op["description"] = "roblox=true filters Game Builder documents and returns compact gameSummary instead of the game AST. Read bounded /roblox/configuration plus all collection pages at matching baseVersion values to reconstruct even an unbuildable large draft, or read the bounded full model. Retry reads if any page version changes. Without that query, ordinary diagram listing retains its existing contract."
	op["responses"].(object)["200"].(object)["content"].(object)["application/json"].(object)["schema"] = object{"type": "array", "items": object{"anyOf": []any{ref("Diagram"), ref("RobloxDiagramSummary")}}}
}
