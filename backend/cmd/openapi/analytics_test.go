package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func analyticsContract(t *testing.T) object {
	t.Helper()
	previous := os.Args
	os.Args = []string{"openapi", filepath.Join(t.TempDir(), "openapi.json")}
	t.Cleanup(func() { os.Args = previous })
	main()
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		t.Fatal(err)
	}
	var document object
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	return document
}
func TestAnalyticsContractKeepsOptionalTypedExtensionAndCanonicalTemplate(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	diagram := schemas["Diagram"].(map[string]any)["properties"].(map[string]any)
	if diagram["analytics"].(map[string]any)["$ref"] != "#/components/schemas/AnalyticsExtension" {
		t.Fatal("optional typed extension missing", diagram)
	}
	for _, kind := range diagram["type"].(map[string]any)["enum"].([]any) {
		if kind == "time-series-analysis" {
			t.Fatal("analytics must not be a new top-level diagram type")
		}
	}
	input := schemas["DiagramInput"].(map[string]any)["properties"].(map[string]any)
	if input["template"].(map[string]any)["enum"].([]any)[0] != "time-series-analysis" || input["mode"] == nil {
		t.Fatal("first-class template creation is undiscoverable")
	}
	patch := schemas["DiagramPatch"].(map[string]any)["properties"].(map[string]any)
	if patch["analytics"] != nil {
		t.Fatal("generic diagram PATCH must not bypass versioned analysis actions")
	}
	extension := schemas["AnalyticsExtension"].(map[string]any)
	if extension["additionalProperties"] != false || extension["properties"].(map[string]any)["schemaVersion"].(map[string]any)["enum"].([]any)[0] != float64(1) {
		t.Fatal("extension must be strict/versioned")
	}
}
func TestAnalyticsContractRoutesDescribeActualReadPreviewWriteAndSemanticIDs(t *testing.T) {
	doc := analyticsContract(t)
	paths := doc["paths"].(map[string]any)
	base := "/diagrams/{diagramId}/analytics"
	for _, route := range []struct{ path, method, input, output string }{
		{"/analytics/capabilities", "get", "", "AnalyticsCapabilities"},
		{base, "get", "", "AnalyticsModelSnapshot"},
		{base, "put", "AnalyticsReplacement", "AnalyticsModelSnapshot"},
		{base + "/import/inspect", "post", "AnalyticsImportInspectInput", "AnalyticsImportInspection"},
		{base + "/import/preview", "post", "AnalyticsImportInput", "AnalyticsImportPreview"},
		{base + "/import/commit", "post", "AnalyticsImportCommit", "AnalyticsModelSnapshot"},
		{base + "/measure", "post", "AnalyticsMeasurementPreview", "AnalyticsMeasurementResult"},
		{base + "/waterfall", "post", "AnalyticsWaterfallPreview", "AnalyticsWaterfallResult"},
		{base + "/evaluate", "post", "AnalyticsSignalPreview", "AnalyticsSignalResult"},
		{base + "/validate", "post", "AnalyticsBacktestPreview", "AnalyticsBacktestResult"},
		{base + "/compare", "post", "AnalyticsScenarioComparisonInput", "AnalyticsScenarioComparison"},
		{base + "/jobs", "post", "AnalyticsJobInput", "AnalyticsJobState"},
		{base + "/jobs/{jobId}/archive", "post", "AnalyticsJobArchive", "AnalyticsModelSnapshot"},
		{base + "/results/{entityId}/input", "get", "", "AnalyticsResultInputResponse"},
		{base + "/results/{entityId}/content", "get", "", "AnalyticsArchivedResultPage"},
	} {
		raw, ok := paths[route.path].(map[string]any)
		if !ok {
			t.Fatal("missing route", route)
		}
		op, ok := raw[route.method].(map[string]any)
		if !ok {
			t.Fatal("missing method", route)
		}
		if op["description"] == nil {
			t.Fatal("missing method/permission policy", route)
		}
		if route.input != "" && op["requestBody"].(map[string]any)["content"].(map[string]any)["application/json"].(map[string]any)["schema"].(map[string]any)["$ref"] != "#/components/schemas/"+route.input {
			t.Fatal("wrong input", route)
		}
		found := false
		for _, raw := range op["responses"].(map[string]any) {
			response := raw.(map[string]any)
			if content, ok := response["content"].(map[string]any); ok {
				if schema, ok := content["application/json"].(map[string]any)["schema"].(map[string]any); ok && schema["$ref"] == "#/components/schemas/"+route.output {
					found = true
				}
			}
		}
		if !found {
			t.Fatal("wrong result schema", route)
		}
	}
	entity := paths[base+"/rules/{entityId}"].(map[string]any)
	for _, method := range []string{"get", "patch", "delete"} {
		op := entity[method].(map[string]any)
		for _, raw := range op["parameters"].([]any) {
			parameter := raw.(map[string]any)
			schema := parameter["schema"].(map[string]any)
			if parameter["name"] == "entityId" && schema["format"] != nil {
				t.Fatal("semantic analytics IDs must not be UUID constrained")
			}
			if parameter["name"] == "baseVersion" && method != "delete" {
				t.Fatal("delete version query leaked to reads/PATCH")
			}
		}
	}
	query := paths[base+"/query"].(map[string]any)["post"].(map[string]any)
	queryParameters := map[string]bool{}
	for _, raw := range query["parameters"].([]any) {
		parameter := raw.(map[string]any)
		if parameter["in"] == "query" {
			queryParameters[parameter["name"].(string)] = true
		}
	}
	if !queryParameters["offset"] || !queryParameters["limit"] || len(queryParameters) != 2 {
		t.Fatal("query paging not attached to POST", query)
	}
}

func TestAnalyticsContractUsesCanonicalTimesAndFullSignalCountMetadata(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	observation := schemas["AnalyticsObservation"].(map[string]any)["properties"].(map[string]any)
	if observation["time"].(map[string]any)["pattern"] == nil {
		t.Fatal("canonical UTC ISO milliseconds must be discoverable")
	}
	signal := schemas["AnalyticsSignal"].(map[string]any)["properties"].(map[string]any)
	for _, field := range []string{"deviationMagnitude", "deviationUnit", "thresholdUnit", "expression", "secondSeriesId", "onsetTime", "seriesVersion", "definitionFingerprint"} {
		if signal[field] == nil {
			t.Fatal("signal score semantics missing", field)
		}
	}
	series := schemas["AnalyticsSeries"].(map[string]any)["properties"].(map[string]any)
	if series["version"].(map[string]any)["default"] != float64(1) || signal["seriesVersion"].(map[string]any)["default"] != float64(1) {
		t.Fatal("legacy semantic version defaults must remain discoverable")
	}
	if signal["definitionFingerprint"].(map[string]any)["pattern"] != "^[a-f0-9]{16}$" {
		t.Fatal("captured dependency fingerprint must have a bounded canonical representation")
	}
	result := schemas["AnalyticsSignalResult"].(map[string]any)["properties"].(map[string]any)
	for _, field := range []string{"totalEvents", "omittedEvents", "episodeCount"} {
		if result[field] == nil {
			t.Fatal("full signal counts missing", field)
		}
	}
	discovery := doc["paths"].(map[string]any)["/diagrams"].(map[string]any)["get"].(map[string]any)
	for _, raw := range discovery["parameters"].([]any) {
		parameter := raw.(map[string]any)
		if parameter["name"] == "analytics" && parameter["schema"].(map[string]any)["enum"].([]any)[0] != true {
			t.Fatal("compact analytics discovery must use explicit true")
		}
	}
}

func TestAnalyticsPatchesPreserveDeepPartialFieldsAndOptionalDeletion(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	series := schemas["AnalyticsSeriesPatch"].(map[string]any)
	if series["required"] != nil {
		t.Fatal("patch must allow omitted top-level fields")
	}
	unit := schemas["AnalyticsUnitPartial"].(map[string]any)
	if unit["required"] != nil || unit["additionalProperties"] != false {
		t.Fatal("nested patch must preserve strict fields without requiring unchanged fields")
	}
	properties := unit["properties"].(map[string]any)
	if properties["currency"].(map[string]any)["nullable"] != true || properties["kind"].(map[string]any)["nullable"] != nil {
		t.Fatal("null removes optional currency but must not clear required unit kind")
	}
	measurement := schemas["AnalyticsMeasurementPatch"].(map[string]any)["properties"].(map[string]any)
	if measurement["dimensions"] == nil {
		t.Fatal("saved measurements must expose segment selection")
	}
	fields := schemas["AnalyticsSignalHandlingPatch"].(map[string]any)["properties"].(map[string]any)
	if fields["acknowledged"].(map[string]any)["nullable"] != nil || fields["scenarioId"].(map[string]any)["nullable"] != true {
		t.Fatal("handling booleans are explicit; optional links can be detached")
	}
}

func TestAnalyticsNumericalConfigurationLimitsMatchBrowserValidation(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	measurement := schemas["AnalyticsMeasurement"].(map[string]any)["properties"].(map[string]any)
	series := measurement["seriesIds"].(map[string]any)
	if series["minItems"] != float64(1) || series["maxItems"] != float64(20) {
		t.Fatal("saved measurements accept one through twenty semantic series")
	}
	indicator := schemas["AnalyticsIndicator"].(map[string]any)["properties"].(map[string]any)
	multiplier := indicator["multiplier"].(map[string]any)
	if multiplier["minimum"] != float64(0) || multiplier["maximum"] != float64(100) {
		t.Fatal("indicator multiplier must match the browser's zero through one hundred bound")
	}
	seriesSchema := schemas["AnalyticsSeries"].(map[string]any)
	column := seriesSchema["properties"].(map[string]any)["columnId"].(map[string]any)
	if column["minLength"] != float64(1) || column["maxLength"] != float64(300) {
		t.Fatal("optional column references must match the browser's one through three hundred character bound")
	}
	if !strings.Contains(seriesSchema["description"].(string), "Derived provenance requires") || !strings.Contains(schemas["AnalyticsRule"].(map[string]any)["description"].(string), "other families must omit expression") {
		t.Fatal("conditional source and rule invariants must be discoverable")
	}
}

func TestAnalyticsCustomerChurnRiskPopulationContractMatchesSemanticValidation(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	for _, name := range []string{"AnalyticsSeries", "AnalyticsSeriesPatch", "AnalyticsImportColumn", "AnalyticsImportLongSeries"} {
		population := schemas[name].(map[string]any)["properties"].(map[string]any)["riskPopulation"].(map[string]any)
		description, ok := population["description"].(string)
		if !ok {
			t.Fatal("missing customer-churn semantic condition", name)
		}
		for _, phrase := range []string{"opening-customers", "semantics must be rate", "unit.kind must be ratio", "INVALID_RATE_DENOMINATOR", "unrelated NRR or net-growth"} {
			if !strings.Contains(description, phrase) {
				t.Fatal("incomplete customer-churn condition", name, phrase)
			}
		}
		values := population["enum"].([]any)
		if len(values) != 2 || values[0] != "opening-customers" || values[1] != "other" {
			t.Fatal("documentation correction must preserve population choices", name)
		}
	}
}

func TestAnalyticalSvgExportIsDiscoverableAndBounded(t *testing.T) {
	doc := analyticsContract(t)
	schemas := doc["components"].(map[string]any)["schemas"].(map[string]any)
	input := schemas["AnalyticsSvgExportInput"].(map[string]any)["properties"].(map[string]any)
	if input["options"].(map[string]any)["$ref"] != "#/components/schemas/AnalyticsSvgOptions" {
		t.Fatal("SVG options missing")
	}
	measurement := false
	for _, scope := range input["scope"].(map[string]any)["enum"].([]any) {
		if scope == "measurement" {
			measurement = true
		}
	}
	if !measurement {
		t.Fatal("regression measurement SVG scope missing")
	}
	result := schemas["AnalyticsSvgResult"].(map[string]any)["properties"].(map[string]any)
	for _, field := range []string{"sourcePoints", "renderedPoints", "sampled", "mimeType"} {
		if result[field] == nil {
			t.Fatal("SVG sampling metadata missing", field)
		}
	}
	if result["renderedPoints"].(map[string]any)["maximum"] != float64(10000) {
		t.Fatal("unbounded vector object count")
	}
	chart := schemas["AnalyticsChart"].(map[string]any)["properties"].(map[string]any)
	if chart["dimensions"] == nil {
		t.Fatal("persisted visual segment filter missing")
	}
}
