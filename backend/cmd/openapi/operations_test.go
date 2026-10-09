package main

import (
	"reflect"
	"testing"
)

func TestOperationContractPreservesOpaqueIdentityAndExistingCommandBodies(t *testing.T) {
	schemas := object{}
	addOperationSchemas(schemas)
	schemas["Health"] = object{"properties": object{"version": object{"type": "string"}}}
	paths := object{}
	add := func(method, path, summary, input, output, status string) {
		if paths[path] == nil {
			paths[path] = object{}
		}
		op := object{"responses": object{status: object{"content": object{"application/json": object{"schema": ref(output)}}}}}
		if input != "" {
			op["requestBody"] = object{"content": object{"application/json": object{"schema": ref(input)}}}
		}
		paths[path].(object)[map[string]string{"GET": "get", "POST": "post"}[method]] = op
	}
	add("POST", "/diagrams", "create", "DiagramInput", "Diagram", "201")
	add("GET", "/health", "health", "", "Health", "200")
	addOperationPaths(add, paths, schemas)
	reservation := schemas["OperationReservationInput"].(object)
	if reservation["additionalProperties"] != false || len(reservation["properties"].(object)) != 0 {
		t.Fatal("reservation must accept exactly an empty object", reservation)
	}
	status := schemas["OperationStatus"].(object)
	if !reflect.DeepEqual(status["required"], []string{"operationId", "state", "resultAvailable"}) {
		t.Fatal("status must describe the real browser receipt", status)
	}
	properties := status["properties"].(object)
	if properties["operationId"].(object)["format"] != nil || properties["resultAvailable"].(object)["type"] != "boolean" {
		t.Fatal("operation ID must stay opaque and result retention explicit", properties)
	}
	statusOperation := paths["/operations/{operationId}"].(object)["get"].(object)
	parameters := statusOperation["parameters"].([]any)
	if len(parameters) != 1 || parameters[0].(object)["schema"].(object)["format"] != nil {
		t.Fatal("operation path must not acquire canonical UUID validation", parameters)
	}
	create := paths["/diagrams"].(object)["post"].(object)
	response := create["responses"].(object)["201"].(object)
	if !reflect.DeepEqual(response["content"].(object)["application/json"].(object)["schema"], ref("Diagram")) {
		t.Fatal("operations must not wrap the original write response", response)
	}
	if response["headers"].(object)["X-Visual-Nerve-Operation-Id"] == nil || create["parameters"].([]any)[0].(object)["name"] != "X-Visual-Nerve-Operation-Id" {
		t.Fatal("operation identity must be discoverable as transport metadata", create)
	}
	for _, code := range []string{"409", "410", "422", "426", "429", "502", "503", "504"} {
		if create["responses"].(object)[code] == nil || statusOperation["responses"].(object)[code] == nil {
			t.Fatal("recovery errors must be discoverable", code)
		}
		if create["responses"].(object)[code].(object)["$ref"] != "#/components/responses/"+operationResponseNames[code] || bridgeResponses()[operationResponseNames[code]] == nil {
			t.Fatal("operation responses must share complete reusable components", code)
		}
	}
	if paths["/health"].(object)["get"].(object)["parameters"] != nil {
		t.Fatal("static reads must not accept operation IDs")
	}
	health := schemas["Health"].(object)["properties"].(object)
	if health["tools"] == nil || health["capabilities"] == nil || health["workspaceId"] != nil || health["accessGrantId"] != nil {
		t.Fatal("health should discover bridge software without private authority", health)
	}
}
