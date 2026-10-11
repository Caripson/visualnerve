package main

const collaborationDocumentPolicy = "Portable collaboration work is optional diagram.collaboration with its own schemaVersion:1; old diagrams remain valid without migration. It contains stable per-document profiles, comment threads, node-linked tasks and the latest 500 informational activity events. Profiles are unverified display labels, distinct from global responsibility Owner records and live device credentials. Names, colors and optional tiny raster avatars are public shared document content. Profile creation without a color or with null selects the first unused eight-color palette entry, then balances color reuse; names and initials also distinguish participants. A profile color patch of null removes its explicit color. No credentials, device IDs, keys or room associations are persisted in this schema. GET /diagrams/{diagramId}/collaboration/document returns {diagramId,baseVersion,document}; an absent payload returns an empty version-1 document. POST /diagrams/{diagramId}/collaboration/actions accepts exactly {baseVersion,action}, rejects query parameters and hashes, and returns the saved Graph. Full graph replacement inherits omitted document work and rejects an explicitly changed collaboration payload; Diagram PATCH cannot write this namespace. Use versioned actions to change existing work. The browser adapter supplies the acting profile, role and source; never send authorId, profileId, role, timestamp, source or credentials in the action. Document work is available locally without a configured relay. Writes need Read + write; viewers cannot mutate. Owner provisions/removes profiles; editors update only their own display fields. Comment text is editable only by its author; owner can moderate by deletion. Only the thread author or owner resolves/reopens threads. Editors can create and update node tasks, assignees, status and dates independently of process responsibility ownership. Referenced profiles cannot be removed; explicitly clear a task assignee first when that is its only reference. New or relinked targets must exist; deleted-node work remains with its UUID and last title snapshot. Strict action validation returns 422, missing entities/targets 404, denied roles/authorship 403, stale baseVersion 409, locked workspace 423 and unavailable browser 503. The 500-event history retains logical append sequence with UUID ties, uses writer clock timestamps and generic semantic summaries, and skips camera/layout-only edits. Native JSON, backups, duplication and history preserve document work and remap node references. Activity and authorship are editable information, not a signed or immutable security audit: approved editors of the existing shared CRDT can edit document content. The adapter checks UI/API actions without asserting cryptographic author provenance."

func collaborationText(maximum int, optional bool) object {
	value := object{"type": "string", "maxLength": maximum}
	if !optional {
		value["minLength"] = 1
	}
	return value
}

func collaborationClock() object {
	return object{"type": "string", "format": "date-time", "description": "ISO writer-clock value; not a trusted server or security-audit timestamp."}
}

func collaborationEntity(fields object) object {
	result := object{"id": svgExportIdentity(), "createdAt": collaborationClock(), "updatedAt": collaborationClock()}
	for key, value := range fields {
		result[key] = value
	}
	return result
}

func collaborationNullable(value object) object {
	result := clone(value)
	result["nullable"] = true
	return result
}

func collaborationProfileFields(nullable bool) object {
	color := object{"type": "string", "pattern": `^#[0-9a-fA-F]{6}$`, "description": "Safe display color. Profile creation with omitted/null color automatically picks the first unused palette color, then balances reuse after eight colors; a null update removes the explicit color."}
	avatar := object{"type": "string", "maxLength": 87416, "pattern": `^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$`, "description": "Canonical base64 raster data URI only. PNG/JPEG/WebP container/header validation limits decoded payload to 64 KiB and dimensions to 256 × 256; animated PNG/WebP, SVG and external URLs are rejected. UI decode/re-encode canonicalizes uploads. All document avatars together are limited to 2 MiB decoded."}
	if nullable {
		color = collaborationNullable(color)
		avatar = collaborationNullable(avatar)
	}
	return object{"name": collaborationText(80, false), "color": color, "avatarDataUrl": avatar}
}

func collaborationTaskFields(nullable bool) object {
	assignee := svgExportIdentity()
	due := object{"type": "string", "format": "date", "description": "Valid calendar YYYY-MM-DD value."}
	description := collaborationText(4000, true)
	if nullable {
		assignee = collaborationNullable(assignee)
		due = collaborationNullable(due)
		description = collaborationNullable(description)
	}
	return object{"nodeId": svgExportIdentity(), "title": collaborationText(300, false), "description": description, "assigneeId": assignee, "status": object{"type": "string", "enum": []string{"todo", "in-progress", "done"}}, "dueDate": due}
}

func addCollaborationDocumentSchemas(schemas object) {
	profile := collaborationProfileFields(false)
	schemas["ParticipantProfile"] = strictObject([]string{"id", "name", "createdAt", "updatedAt"}, collaborationEntity(profile))
	schemas["ParticipantProfile"].(object)["description"] = "Stable UUID within one document. Unverified participant display label; no role, credentials, live device identity or relationship to process Owner records."
	logicalSequence := object{"type": "integer", "minimum": 0, "maximum": 9007199254740991, "description": "Editable logical append counter; UUID resolves concurrent equal counters. Independent of writer-clock timestamps."}
	schemas["CommentMessage"] = strictObject([]string{"id", "sequence", "authorId", "text", "createdAt", "updatedAt"}, collaborationEntity(object{"sequence": logicalSequence, "authorId": svgExportIdentity(), "text": collaborationText(4000, false)}))
	schemas["CommentThread"] = strictObject([]string{"id", "authorId", "resolved", "createdAt", "updatedAt", "messages"}, collaborationEntity(object{
		"nodeId": svgExportIdentity(), "nodeTitle": collaborationText(1000, true), "authorId": svgExportIdentity(), "resolved": object{"type": "boolean"}, "resolvedBy": svgExportIdentity(), "resolvedAt": collaborationClock(),
		"messages": object{"type": "array", "minItems": 1, "maxItems": 2000, "items": ref("CommentMessage"), "description": "At most 2000 messages across all threads and at most 4,000,000 total comment UTF-16 code units. Resolved threads require resolvedBy/resolvedAt; open threads omit those fields."},
	}))
	schemas["CommentThread"].(object)["description"] = "Optional diagram/node thread. Historical node UUID and last title remain when a node is deleted. Author/resolver IDs reference existing document profiles."
	schemas["CommentThread"].(object)["allOf"] = []any{object{"oneOf": []any{
		object{"properties": object{"resolved": collaborationBoolean(true)}, "required": []string{"resolvedBy", "resolvedAt"}},
		object{"properties": object{"resolved": collaborationBoolean(false)}, "not": object{"anyOf": []any{object{"required": []string{"resolvedBy"}}, object{"required": []string{"resolvedAt"}}}}},
	}}}
	task := collaborationTaskFields(false)
	task["authorId"] = svgExportIdentity()
	task["nodeTitle"] = collaborationText(1000, true)
	schemas["CollaborationTask"] = strictObject([]string{"id", "nodeId", "title", "authorId", "status", "createdAt", "updatedAt"}, collaborationEntity(task))
	schemas["CollaborationTask"].(object)["description"] = "Node work assignment separate from graph responsibility ownership. Author/assignee IDs reference document profiles. Deleted targets remain as orphan work with the last title."
	schemas["CollaborationActivity"] = strictObject([]string{"id", "sequence", "kind", "source", "timestamp", "summary"}, object{
		"sequence": logicalSequence,
		"id":       svgExportIdentity(), "kind": object{"type": "string", "enum": []string{"profile.created", "profile.updated", "profile.removed", "comment.created", "comment.replied", "comment.edited", "comment.removed", "comment.resolved", "comment.reopened", "task.created", "task.updated", "task.removed", "diagram.updated", "nodes.created", "nodes.updated", "nodes.removed", "connections.created", "connections.updated", "connections.removed", "owners.updated", "simulation.updated", "data.updated"}},
		"source": object{"type": "string", "enum": []string{"ui", "api", "mcp", "import", "collaboration"}}, "authorId": svgExportIdentity(), "timestamp": collaborationClock(), "summary": collaborationText(300, false), "nodeIds": object{"type": "array", "maxItems": 32, "uniqueItems": true, "items": svgExportIdentity()}, "entityId": svgExportIdentity(),
	})
	schemas["CollaborationActivity"].(object)["description"] = "Informational editable semantic history. Logical sequence and UUID ties handle clock skew; timestamps and profile IDs do not prove trusted or immutable authorship. IDs may reference removed document objects."
	schemas["CollaborationDocument"] = strictObject([]string{"schemaVersion", "profiles", "comments", "tasks", "activity"}, object{
		"schemaVersion": svgExportConstant(1, "Independent optional Diagram.collaboration schema version; native graph/vault versions do not change."),
		"profiles":      object{"type": "array", "maxItems": 128, "items": ref("ParticipantProfile")}, "comments": object{"type": "array", "maxItems": 2000, "items": ref("CommentThread")}, "tasks": object{"type": "array", "maxItems": 1000, "items": ref("CollaborationTask")}, "activity": object{"type": "array", "maxItems": 500, "items": ref("CollaborationActivity")},
	})
	schemas["CollaborationDocument"].(object)["description"] = collaborationDocumentPolicy + " Total serialized UTF-8 document size is limited to 16 MiB. All entity/message IDs are globally unique within the collaboration payload; profile references must resolve."
	schemas["CollaborationDocumentSnapshot"] = strictObject([]string{"diagramId", "baseVersion", "document"}, object{"diagramId": svgExportIdentity(), "baseVersion": object{"type": "integer", "minimum": 1}, "document": ref("CollaborationDocument")})
	schemas["ProfileCreateInput"] = strictObject([]string{"name"}, collaborationProfileFields(true))
	schemas["ProfileUpdateInput"] = strictObject(nil, collaborationProfileFields(true))
	schemas["CollaborationTaskCreateInput"] = strictObject([]string{"nodeId", "title"}, collaborationTaskFields(true))
	schemas["CollaborationTaskUpdateInput"] = strictObject(nil, collaborationTaskFields(true))
	variants := []any{}
	for _, variant := range []struct {
		name       string
		required   []string
		properties object
	}{
		{"profile.create", []string{"profile"}, object{"profile": ref("ProfileCreateInput")}},
		{"profile.update", []string{"id", "patch"}, object{"id": svgExportIdentity(), "patch": ref("ProfileUpdateInput")}},
		{"profile.remove", []string{"id"}, object{"id": svgExportIdentity()}},
		{"comment.create", []string{"text"}, object{"nodeId": svgExportIdentity(), "text": collaborationText(4000, false)}},
		{"comment.reply", []string{"id", "text"}, object{"id": svgExportIdentity(), "text": collaborationText(4000, false)}},
		{"comment.edit", []string{"id", "messageId", "text"}, object{"id": svgExportIdentity(), "messageId": svgExportIdentity(), "text": collaborationText(4000, false)}},
		{"comment.remove", []string{"id"}, object{"id": svgExportIdentity(), "messageId": svgExportIdentity()}},
		{"comment.resolve", []string{"id", "resolved"}, object{"id": svgExportIdentity(), "resolved": object{"type": "boolean"}}},
		{"task.create", []string{"task"}, object{"task": ref("CollaborationTaskCreateInput")}},
		{"task.update", []string{"id", "patch"}, object{"id": svgExportIdentity(), "patch": ref("CollaborationTaskUpdateInput")}},
		{"task.remove", []string{"id"}, object{"id": svgExportIdentity()}},
	} {
		variant.properties["type"] = collaborationString(variant.name)
		variants = append(variants, strictObject(append([]string{"type"}, variant.required...), variant.properties))
	}
	schemas["CollaborationAction"] = object{"oneOf": variants, "description": "Exactly one supported typed action. Adapter supplies role, actor, source, IDs and timestamps; no authors or credentials are accepted. Null avatarDataUrl/description/assigneeId/dueDate clears that optional field. Profile color null on creation chooses an automatic palette color; null in a profile update clears its explicit color."}
	schemas["CollaborationActionInput"] = strictObject([]string{"baseVersion", "action"}, object{"baseVersion": object{"type": "integer", "minimum": 1}, "action": ref("CollaborationAction")})
	schemas["CollaborationActionInput"].(object)["description"] = collaborationDocumentPolicy
}

func addCollaborationDocumentPaths(add func(string, string, string, string, string, string), paths object) {
	add("GET", "/diagrams/{diagramId}/collaboration/document", "Inspect portable profiles, threads, node tasks and informational activity", "", "CollaborationDocumentSnapshot", "200")
	add("POST", "/diagrams/{diagramId}/collaboration/actions", "Apply one versioned document collaboration action using the adapter's actor", "CollaborationActionInput", "Graph", "200")
	for _, path := range []string{"/diagrams/{diagramId}/collaboration/document", "/diagrams/{diagramId}/collaboration/actions"} {
		for _, operation := range paths[path].(object) {
			operation.(object)["description"] = collaborationDocumentPolicy
		}
	}
}
