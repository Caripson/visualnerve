package main

import (
	"reflect"
	"testing"
)

func TestPresentationSchemasAndPaths(t *testing.T) {
	schemas := object{}
	addPresentationSchemas(schemas)
	definition := schemas["PresentationDefinition"].(object)
	if definition["additionalProperties"] != false || !reflect.DeepEqual(definition["required"], []string{"version", "nodeIds", "secondsPerNode", "transitionMs"}) {
		t.Fatal("exact saved contract required", definition)
	}
	ids := definition["properties"].(object)["nodeIds"].(object)
	if ids["maxItems"] != 20000 || ids["uniqueItems"] != true {
		t.Fatal("sequence must be bounded and unique", ids)
	}
	if schemas["PresentationEmptyInput"].(object)["additionalProperties"] != false {
		t.Fatal("actions must use exact empty body")
	}
	voice := schemas["PresentationVoiceId"].(object)
	if voice["default"] != "en_GB-alan-medium" || !reflect.DeepEqual(voice["enum"], []string{"en_GB-alan-medium", "en_US-ljspeech-high", "en_GB-cori-high", "sv_SE-nst-medium"}) {
		t.Fatal("British male default and existing selectable voices must agree", voice)
	}
	paths := map[string]string{}
	addPresentationPaths(func(method, path, summary, input, output, status string) { paths[method+" "+path] = input })
	if paths["PUT /diagrams/{diagramId}/presentation"] != "PresentationUpdate" || paths["PATCH /presentation"] != "PresentationOptions" || paths["POST /presentation/open"] != "PresentationOpenInput" {
		t.Fatal("required presentation routes missing", paths)
	}
	for _, action := range []string{"play", "pause", "rewind", "forward", "close", "preload"} {
		if paths["POST /presentation/"+action] != "PresentationEmptyInput" {
			t.Fatal("incorrect action body", action)
		}
	}
	if _, exists := paths["GET /presentation/voices"]; !exists {
		t.Fatal("voice discovery missing")
	}
	if input, exists := paths["GET /presentation/video"]; !exists || input != "" || paths["POST /presentation/video"] != "PresentationVideoInput" || paths["DELETE /presentation/video"] != "PresentationEmptyInput" {
		t.Fatal("video state, start or exact cancellation routes missing", paths)
	}
	videoInput := schemas["PresentationVideoInput"].(object)
	if videoInput["additionalProperties"] != false || len(videoInput["properties"].(object)) != 2 {
		t.Fatal("video options must accept only audio and subtitles", videoInput)
	}
	video := schemas["PresentationVideoState"].(object)
	if video["additionalProperties"] != false || !reflect.DeepEqual(video["required"], []string{"status", "progress", "nodeIndex", "total", "format", "message", "fileName"}) {
		t.Fatal("exact transient video state required", video)
	}
	properties := video["properties"].(object)
	if properties["progress"].(object)["maximum"] != 1 || properties["nodeIndex"].(object)["minimum"] != -1 || properties["format"].(object)["nullable"] != true || !reflect.DeepEqual(properties["format"].(object)["enum"], []any{"mp4", "webm", nil}) {
		t.Fatal("video progress, node index or nullable format schema invalid", properties)
	}
}
