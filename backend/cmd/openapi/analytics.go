package main

const analyticsPolicy = "Time Series & Signal Analysis is a versioned optional Diagram.analytics extension, not a separate document type or Process Simulator queue model. The unlocked browser and its encrypted IndexedDB are authoritative; UI, REST and MCP use the same deterministic local worker engine. Bridge capability analytics-v1 identifies software support, not a grant. Read the bundled guide with visual_nerve_api_docs document=guide, then endpoint/openapi for exact schemas; visual_nerve_request paths omit /api/v1. Read only permits exact unsaved preview/query/job routes and transient-job cancellation. Saved definitions, imports, archives and signal handling require Read + write and current baseVersion. POST alone does not determine permission. Lock, grant revocation and original-session loss cancel jobs and erase transient results; polling and analysis do not unlock or renew idle sessions. File import settings do not increase the 32 MiB HTTP/WebSocket envelope. Analytics responses have an independent 8 MiB budget; raw observation/result pages allow 1..1000 items. Import source text is CSV/JSON; XLSX is strict padded standard base64 with no formula, macro or external-link execution. Preview precedes confirmed import commit; create/replace/update are explicit. Missing data is not zero. Rates require compatible numerator/denominator semantics; temporal cohort churn is not inferred from pooled segments. Signal/backtest methods are causal unless explicitly described as retrospective; present-day revised data without publication history cannot prove past knowledge. No broker, trading orders, guaranteed forecasts, confidence score or server alarms when the browser is closed."

func analyticsID() object {
	return object{"type": "string", "minLength": 1, "maxLength": 128, "pattern": `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`, "description": "Stable semantic analysis identity; never a canvas position. A saved definition ID is immutable."}
}
func analyticsText() object   { return object{"type": "string"} }
func analyticsNumber() object { return object{"type": "number", "minimum": -1e15, "maximum": 1e15} }
func analyticsInt(min, max int) object {
	return object{"type": "integer", "minimum": min, "maximum": max}
}
func analyticsEnum(values ...string) object { return object{"type": "string", "enum": values} }
func analyticsRiskPopulation() object {
	field := analyticsEnum("opening-customers", "other")
	field["description"] = "When riskPopulation is opening-customers, semantics must be rate and unit.kind must be ratio; otherwise validation returns INVALID_RATE_DENOMINATOR. This customer-churn constraint does not impose a 0–100% limit on unrelated NRR or net-growth series."
	return field
}
func analyticsBool() object { return object{"type": "boolean"} }
func analyticsClock() object {
	return object{"type": "string", "format": "date-time", "pattern": `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$`, "description": "Canonical UTC ISO timestamp with milliseconds, matching Date.toISOString(). Imports normalize an explicitly selected date/time convention before storage."}
}
func analyticsNullableNumber() object { return object{"type": "number", "nullable": true} }
func analyticsArray(name string, maximum int) object {
	return object{"type": "array", "maxItems": maximum, "items": ref(name)}
}
func analyticsIDs(maximum int) object {
	return object{"type": "array", "maxItems": maximum, "items": analyticsID()}
}
func analyticsDimensions() object {
	return object{"type": "object", "additionalProperties": object{"type": "string"}}
}
func analyticsEntity(fields object, required ...string) object {
	fields["id"] = analyticsID()
	return strictObject(append([]string{"id"}, required...), fields)
}

// Deep object patches preserve omitted fields; null removes optional properties.
// Arrays remain full replacements, and recursive JSON AST references stay references.
func analyticsSchemaPatch(schema object, schemas object) object {
	var patch func(object, bool) object
	asObject := func(value any) object {
		if typed, ok := value.(object); ok {
			return typed
		}
		return object(value.(map[string]any))
	}
	patch = func(current object, optional bool) object {
		if reference, ok := current["$ref"].(string); ok {
			name := reference[len("#/components/schemas/"):]
			original := asObject(schemas[name])
			if original["type"] == "object" || original["oneOf"] != nil {
				partial := name + "Partial"
				if schemas[partial] == nil {
					schemas[partial] = object{}
					schemas[partial] = patch(original, false)
				}
				result := object{"type": "object", "allOf": []any{ref(partial)}}
				if optional {
					result["nullable"] = true
				}
				return result
			}
		}
		result := clone(current)
		if current["type"] == "object" {
			required := map[string]bool{}
			switch values := current["required"].(type) {
			case []string:
				for _, value := range values {
					required[value] = true
				}
			case []any:
				for _, value := range values {
					required[value.(string)] = true
				}
			}
			delete(result, "required")
			if raw := current["properties"]; raw != nil {
				properties := object{}
				for name, value := range asObject(raw) {
					properties[name] = patch(asObject(value), !required[name])
				}
				result["properties"] = properties
			}
		}
		if variants, ok := current["oneOf"].([]any); ok {
			partials := []any{}
			for _, variant := range variants {
				partials = append(partials, patch(asObject(variant), false))
			}
			delete(result, "oneOf")
			result["anyOf"] = partials
		}
		if optional {
			result["nullable"] = true
		}
		return result
	}
	return patch(schema, false)
}

func addAnalyticsSchemas(schemas object) {
	schemas["AnalyticsUnit"] = strictObject([]string{"kind", "label"}, object{"kind": analyticsEnum("count", "currency", "ratio", "number"), "label": analyticsText(), "currency": analyticsText()})
	schemas["AnalyticsOHLC"] = strictObject([]string{"open", "high", "low", "close"}, object{"open": analyticsNumber(), "high": analyticsNumber(), "low": analyticsNumber(), "close": analyticsNumber()})
	schemas["AnalyticsOHLC"].(object)["description"] = "Finite real observed OHLC only. low <= min(open,close), high >= max(open,close), low <= high. A single monthly scalar never fabricates wick variation."
	schemas["AnalyticsIssue"] = strictObject([]string{"code", "message", "severity"}, object{"code": analyticsText(), "message": analyticsText(), "severity": analyticsEnum("error", "warning"), "path": analyticsText(), "row": analyticsInt(1, 10000000), "column": analyticsText()})
	schemas["AnalyticsError"] = strictObject([]string{"error", "code", "issues"}, object{"error": analyticsText(), "code": analyticsText(), "issues": analyticsArray("AnalyticsIssue", 200000)})
	schemas["AnalyticsObservation"] = analyticsEntity(object{"seriesId": analyticsID(), "time": analyticsClock(), "periodEnd": analyticsClock(), "knownAt": analyticsClock(), "value": analyticsNullableNumber(), "numerator": analyticsNumber(), "denominator": analyticsNumber(), "ohlc": ref("AnalyticsOHLC"), "dimensions": analyticsDimensions(), "quality": analyticsEnum("valid", "missing", "incomplete"), "sourceRow": analyticsInt(1, 10000000)}, "seriesId", "time", "value", "dimensions", "quality")
	schemas["AnalyticsDatasetSource"] = strictObject([]string{"kind", "name"}, object{"kind": analyticsEnum("example", "csv", "xlsx", "json"), "name": analyticsText(), "illustrative": analyticsBool()})
	schemas["AnalyticsDataset"] = analyticsEntity(object{"name": analyticsText(), "version": analyticsInt(1, 1000000000), "source": ref("AnalyticsDatasetSource"), "observations": analyticsArray("AnalyticsObservation", 200000), "transformations": stringList(), "importedAt": analyticsClock(), "revisionHistory": analyticsEnum("unavailable", "point-in-time")}, "name", "version", "source", "observations", "transformations", "importedAt", "revisionHistory")
	datasetSummary := clone(schemas["AnalyticsDataset"].(object))
	delete(datasetSummary["properties"].(map[string]any), "observations")
	datasetSummary["properties"].(map[string]any)["observationCount"] = analyticsInt(0, 200000)
	datasetSummary["required"] = []string{"id", "name", "version", "source", "transformations", "importedAt", "revisionHistory", "observationCount"}
	schemas["AnalyticsDatasetSummary"] = datasetSummary
	schemas["AnalyticsDerivedExpression"] = strictObject([]string{"operation", "seriesIds"}, object{"operation": analyticsEnum("difference", "relative-change", "sum", "subtract", "multiply", "divide"), "seriesIds": analyticsIDs(10)})
	schemas["AnalyticsSeries"] = analyticsEntity(object{"version": object{"type": "integer", "minimum": 1, "maximum": 1000000000, "default": 1}, "name": analyticsText(), "datasetId": analyticsID(), "columnId": analyticsText(), "dimensions": analyticsDimensions(), "unit": ref("AnalyticsUnit"), "semantics": analyticsEnum("snapshot", "flow", "rate"), "provenance": analyticsEnum("observed", "derived"), "resolution": analyticsEnum("observation", "day", "week", "month", "quarter", "year"), "timezone": analyticsText(), "periodBoundary": analyticsEnum("start", "end"), "aggregation": analyticsEnum("sum", "first", "last", "ratio", "none"), "direction": analyticsEnum("higher-is-better", "lower-is-better", "neutral"), "riskPopulation": analyticsRiskPopulation(), "definition": analyticsText(), "derived": ref("AnalyticsDerivedExpression")}, "name", "datasetId", "dimensions", "unit", "semantics", "provenance", "resolution", "timezone", "periodBoundary", "aggregation", "direction", "definition")
	schemas["AnalyticsWaterfallComponent"] = strictObject([]string{"seriesId", "sign"}, object{"seriesId": analyticsID(), "sign": object{"type": "integer", "enum": []int{-1, 1}}})
	schemas["AnalyticsWaterfall"] = strictObject([]string{"openingSeriesId", "closingSeriesId", "components"}, object{"openingSeriesId": analyticsID(), "closingSeriesId": analyticsID(), "components": analyticsArray("AnalyticsWaterfallComponent", 100)})
	schemas["AnalyticsChart"] = analyticsEntity(object{"name": analyticsText(), "kind": analyticsEnum("line", "area", "bar", "candlestick", "waterfall"), "seriesIds": analyticsIDs(20), "dimensions": analyticsDimensions(), "resolution": analyticsEnum("observation", "day", "week", "month", "quarter", "year"), "normalized": analyticsBool(), "from": analyticsClock(), "to": analyticsClock(), "waterfall": ref("AnalyticsWaterfall")}, "name", "kind", "seriesIds", "resolution", "normalized")
	schemas["AnalyticsIndicator"] = analyticsEntity(object{"name": analyticsText(), "seriesId": analyticsID(), "kind": analyticsEnum("sma", "ema", "roc", "rolling-stddev", "bollinger", "macd", "rsi"), "window": analyticsInt(1, 10000), "alpha": object{"type": "number", "exclusiveMinimum": true, "minimum": 0, "maximum": 1}, "multiplier": analyticsNumber(), "shortWindow": analyticsInt(1, 10000), "longWindow": analyticsInt(1, 10000), "signalWindow": analyticsInt(1, 10000)}, "name", "seriesId", "kind", "window")
	schemas["AnalyticsDataPoint"] = strictObject([]string{"time", "value"}, object{"time": analyticsClock(), "value": analyticsNumber()})
	schemas["AnalyticsMeasurement"] = analyticsEntity(object{"name": analyticsText(), "kind": analyticsEnum("point-to-point", "time-range", "range-statistics", "trend-line", "regression", "compare-periods", "compare-series", "correlation", "annotation"), "seriesIds": analyticsIDs(100), "from": analyticsClock(), "to": analyticsClock(), "comparisonFrom": analyticsClock(), "comparisonTo": analyticsClock(), "points": analyticsArray("AnalyticsDataPoint", 2), "method": analyticsEnum("pearson", "spearman"), "lag": object{"type": "integer", "minimum": -10000, "maximum": 10000}, "normalized": analyticsBool(), "note": analyticsText(), "nodeId": object{"type": "string", "format": "uuid"}, "resultId": analyticsID(), "dimensions": analyticsDimensions()}, "name", "kind", "seriesIds", "from", "to")
	schemas["AnalyticsOperand"] = object{"oneOf": []any{
		strictObject([]string{"kind", "seriesId"}, object{"kind": analyticsEnum("series"), "seriesId": analyticsID()}),
		strictObject([]string{"kind", "indicatorId"}, object{"kind": analyticsEnum("indicator"), "indicatorId": analyticsID(), "component": analyticsEnum("value", "upper", "lower", "signal", "histogram")}),
		strictObject([]string{"kind", "value"}, object{"kind": analyticsEnum("constant"), "value": analyticsNumber()}),
	}}
	schemas["AnalyticsSignalExpression"] = object{"oneOf": []any{
		strictObject([]string{"kind", "left", "operator", "right"}, object{"kind": analyticsEnum("comparison"), "left": ref("AnalyticsOperand"), "operator": analyticsEnum(">", ">=", "<", "<=", "==", "!="), "right": ref("AnalyticsOperand")}),
		strictObject([]string{"kind", "children"}, object{"kind": analyticsEnum("and", "or"), "children": object{"type": "array", "minItems": 2, "maxItems": 16, "items": ref("AnalyticsSignalExpression")}}),
		strictObject([]string{"kind", "child"}, object{"kind": analyticsEnum("not"), "child": ref("AnalyticsSignalExpression")}),
		strictObject([]string{"kind", "periods", "child"}, object{"kind": analyticsEnum("sustained"), "periods": analyticsInt(1, 10000), "child": ref("AnalyticsSignalExpression")}),
		strictObject([]string{"kind", "operand", "operation", "periods", "operator", "threshold"}, object{"kind": analyticsEnum("window"), "operand": ref("AnalyticsOperand"), "operation": analyticsEnum("mean", "min", "max", "stddev", "roc"), "periods": analyticsInt(1, 10000), "operator": analyticsEnum(">", ">=", "<", "<=", "==", "!="), "threshold": analyticsNumber()}),
		strictObject([]string{"kind", "left", "right", "direction"}, object{"kind": analyticsEnum("crossing"), "left": ref("AnalyticsOperand"), "right": ref("AnalyticsOperand"), "direction": analyticsEnum("up", "down")}),
	}, "description": "Strict JSON AST, at most 8 levels and 64 conditions. No eval, functions or executable strings. Three-valued unknown propagates through AND/OR/NOT; gaps break consecutive confirmation."}
	schemas["AnalyticsRuleParameters"] = strictObject(nil, object{"comparator": analyticsEnum(">", ">=", "<", "<=", "==", "!="), "threshold": analyticsNumber(), "consecutive": analyticsInt(1, 10000), "cooldown": analyticsInt(0, 10000), "hysteresis": object{"type": "number", "minimum": 0}, "window": analyticsInt(1, 10000), "shortWindow": analyticsInt(1, 10000), "longWindow": analyticsInt(1, 10000), "average": analyticsEnum("sma", "ema"), "method": analyticsEnum("zscore", "mad"), "mu0": analyticsNumber(), "k": object{"type": "number", "minimum": 0}, "h": object{"type": "number", "exclusiveMinimum": true, "minimum": 0}, "reset": analyticsEnum("on-resolve", "on-detect"), "seasonLength": analyticsInt(2, 10000), "tolerance": object{"type": "number", "minimum": 0}, "direction": analyticsEnum("up", "down", "both")})
	schemas["AnalyticsRule"] = analyticsEntity(object{"version": analyticsInt(1, 1000000000), "name": analyticsText(), "enabled": analyticsBool(), "family": analyticsEnum("threshold", "sustained", "moving-average-crossover", "momentum", "anomaly", "variation-spike", "structural-change", "seasonality-deviation", "kpi-divergence", "custom"), "seriesId": analyticsID(), "secondSeriesId": analyticsID(), "severity": analyticsEnum("info", "warning", "critical"), "expression": ref("AnalyticsSignalExpression"), "parameters": ref("AnalyticsRuleParameters")}, "version", "name", "enabled", "family", "seriesId", "severity", "parameters")
	schemas["AnalyticsInterval"] = strictObject([]string{"from", "to"}, object{"from": analyticsClock(), "to": analyticsClock()})
	schemas["AnalyticsSignalEvidence"] = strictObject([]string{"observations", "missing"}, object{"observations": analyticsInt(0, 200000), "missing": analyticsInt(0, 200000), "exposure": analyticsNumber()})
	schemas["AnalyticsSignal"] = analyticsEntity(object{"episodeId": analyticsID(), "ruleId": analyticsID(), "ruleVersion": analyticsInt(1, 1000000000), "seriesId": analyticsID(), "dimensions": analyticsDimensions(), "dataVersion": analyticsInt(1, 1000000000), "interval": ref("AnalyticsInterval"), "observationTime": analyticsClock(), "detectedAt": analyticsClock(), "state": analyticsEnum("onset", "active", "resolved"), "value": analyticsNullableNumber(), "baseline": analyticsNullableNumber(), "threshold": analyticsNullableNumber(), "unit": ref("AnalyticsUnit"), "method": analyticsText(), "parameters": ref("AnalyticsRuleParameters"), "evidence": ref("AnalyticsSignalEvidence"), "quality": analyticsEnum("valid", "insufficient"), "explanation": analyticsText(), "severity": analyticsEnum("info", "warning", "critical"), "acknowledged": analyticsBool(), "muted": analyticsBool(), "measurementId": analyticsID(), "annotationId": analyticsID(), "nodeId": object{"type": "string", "format": "uuid"}, "scenarioId": analyticsID()}, "episodeId", "ruleId", "ruleVersion", "seriesId", "dimensions", "dataVersion", "interval", "observationTime", "detectedAt", "state", "value", "baseline", "threshold", "unit", "method", "parameters", "evidence", "quality", "explanation", "severity")
	signalProperties := schemas["AnalyticsSignal"].(object)["properties"].(object)
	signalProperties["expression"] = ref("AnalyticsSignalExpression")
	signalProperties["secondSeriesId"] = analyticsID()
	signalProperties["onsetTime"] = analyticsClock()
	signalProperties["seriesVersion"] = object{"type": "integer", "minimum": 1, "maximum": 1000000000, "default": 1}
	signalProperties["definitionFingerprint"] = object{"type": "string", "pattern": "^[a-f0-9]{16}$", "description": "ID-neutral fingerprint of captured rule, semantic source and calculation dependencies; older records without it remain historical evidence."}
	signalProperties["deviationMagnitude"] = analyticsNullableNumber()
	signalProperties["deviationUnit"] = analyticsText()
	signalProperties["thresholdUnit"] = analyticsText()
	schemas["AnalyticsSignal"].(object)["required"] = append(schemas["AnalyticsSignal"].(object)["required"].([]string), "deviationMagnitude", "deviationUnit", "thresholdUnit")
	schemas["AnalyticsSignalHandling"] = strictObject(nil, object{"acknowledged": analyticsBool(), "muted": analyticsBool(), "measurementId": analyticsID(), "annotationId": analyticsID(), "nodeId": object{"type": "string", "format": "uuid"}, "scenarioId": analyticsID()})
	schemas["AnalyticsOutcome"] = strictObject([]string{"seriesId", "comparator", "threshold", "horizon", "matching"}, object{"seriesId": analyticsID(), "comparator": analyticsEnum(">", ">=", "<", "<=", "==", "!="), "threshold": analyticsNumber(), "horizon": analyticsInt(1, 10000), "matching": analyticsEnum("first-unmatched")})
	schemas["AnalyticsBacktest"] = analyticsEntity(object{"name": analyticsText(), "ruleIds": analyticsIDs(100), "from": analyticsClock(), "to": analyticsClock(), "trainEnd": analyticsClock(), "validationEnd": analyticsClock(), "holdoutStart": analyticsClock(), "walkForwardPeriods": analyticsInt(1, 10000), "trials": analyticsInt(1, 10000), "baselineRuleId": analyticsID(), "outcome": ref("AnalyticsOutcome")}, "name", "ruleIds", "from", "to", "trainEnd", "validationEnd", "holdoutStart", "walkForwardPeriods", "trials")
	schemas["AnalyticsChurnAdjustment"] = strictObject([]string{"kind", "value"}, object{"kind": analyticsEnum("relative", "percentage-points"), "value": analyticsNumber()})
	schemas["AnalyticsGrowthAssumptions"] = strictObject([]string{"openingCustomers", "newCustomers", "reactivatedCustomers", "churnRate", "newCustomerGrowth", "openingMrc", "newMrc", "expansionMrc", "contractionMrc", "churnedMrc", "currency"}, object{"openingCustomers": simNumber(0), "newCustomers": simNumber(0), "reactivatedCustomers": simNumber(0), "churnRate": object{"type": "number", "minimum": 0, "maximum": 1}, "newCustomerGrowth": analyticsNumber(), "openingMrc": simNumber(0), "newMrc": simNumber(0), "expansionMrc": simNumber(0), "contractionMrc": simNumber(0), "churnedMrc": simNumber(0), "currency": analyticsText(), "revenuePerCustomer": simNumber(0), "churnAdjustment": ref("AnalyticsChurnAdjustment")})
	schemas["AnalyticsProcessLink"] = strictObject([]string{"diagramId", "scenarioId", "parameter", "unit", "resolution", "reviewed"}, object{"diagramId": object{"type": "string", "format": "uuid"}, "scenarioId": analyticsID(), "sourceSeriesId": analyticsID(), "nodeId": object{"type": "string", "format": "uuid"}, "parameter": analyticsText(), "unit": analyticsText(), "resolution": analyticsEnum("observation", "day", "week", "month", "quarter", "year"), "reviewed": analyticsBool()})
	schemas["AnalyticsScenario"] = analyticsEntity(object{"name": analyticsText(), "version": analyticsInt(1, 1000000000), "model": analyticsEnum("growth-churn"), "start": analyticsClock(), "periods": analyticsInt(1, 1200), "resolution": analyticsEnum("month"), "assumptions": ref("AnalyticsGrowthAssumptions"), "sourceSignalId": analyticsID(), "reviewed": analyticsBool(), "nodeId": object{"type": "string", "format": "uuid"}, "processLink": ref("AnalyticsProcessLink")}, "name", "version", "model", "start", "periods", "resolution", "assumptions", "reviewed")
	scenarioPoint := object{"time": analyticsClock(), "provenance": analyticsEnum("scenario"), "expectedCounts": object{"type": "boolean", "enum": []bool{true}}}
	pointRequired := []string{"time", "provenance", "expectedCounts"}
	for _, field := range []string{"openingCustomers", "newCustomers", "reactivatedCustomers", "lostCustomers", "closingCustomers", "openingMrc", "newMrc", "expansionMrc", "contractionMrc", "churnedMrc", "closingMrc"} {
		scenarioPoint[field] = analyticsNumber()
		pointRequired = append(pointRequired, field)
	}
	schemas["AnalyticsScenarioPoint"] = strictObject(pointRequired, scenarioPoint)
	schemas["AnalyticsMetric"] = strictObject([]string{"value"}, object{"value": analyticsNullableNumber(), "reason": analyticsText(), "explanation": analyticsText()})
	schemas["AnalyticsIndicatorPoint"] = strictObject([]string{"time", "value"}, object{"time": analyticsClock(), "value": analyticsNullableNumber(), "upper": analyticsNullableNumber(), "lower": analyticsNullableNumber(), "signal": analyticsNullableNumber(), "histogram": analyticsNullableNumber(), "reason": analyticsText()})
	schemas["AnalyticsMeasurementResult"] = strictObject([]string{"kind", "measurementId", "metrics", "notes"}, object{"kind": analyticsEnum("measurement"), "measurementId": analyticsID(), "metrics": object{"type": "object", "additionalProperties": ref("AnalyticsMetric")}, "values": analyticsArray("AnalyticsIndicatorPoint", 200000), "residuals": analyticsArray("AnalyticsDataPoint", 200000), "notes": stringList()})
	schemas["AnalyticsIndicatorResult"] = strictObject([]string{"kind", "indicatorId", "points", "notes"}, object{"kind": analyticsEnum("indicator"), "indicatorId": analyticsID(), "points": analyticsArray("AnalyticsIndicatorPoint", 200000), "notes": stringList()})
	schemas["AnalyticsSignalResult"] = strictObject([]string{"kind", "signals", "evaluated", "unknown", "notes", "totalEvents", "omittedEvents", "episodeCount"}, object{"kind": analyticsEnum("signals"), "signals": analyticsArray("AnalyticsSignal", 10000), "evaluated": analyticsInt(0, 20000000), "unknown": analyticsInt(0, 20000000), "totalEvents": analyticsInt(0, 20000000), "omittedEvents": analyticsInt(0, 20000000), "episodeCount": analyticsInt(0, 20000000), "notes": stringList()})
	schemas["AnalyticsBacktestRuleResult"] = strictObject([]string{"ruleId", "split", "signals", "episodes", "activePeriods", "exposedPeriods", "evaluablePeriods"}, object{"ruleId": analyticsID(), "split": analyticsEnum("train", "validation", "holdout"), "signals": analyticsInt(0, 200000), "episodes": analyticsInt(0, 200000), "activePeriods": analyticsInt(0, 200000), "exposedPeriods": analyticsInt(0, 200000), "evaluablePeriods": analyticsInt(0, 200000), "matchedSignals": analyticsInt(0, 200000), "matchedOutcomes": analyticsInt(0, 200000), "outcomeCount": analyticsInt(0, 200000), "precision": ref("AnalyticsMetric"), "recall": ref("AnalyticsMetric"), "falseAlarms": analyticsInt(0, 200000), "detectionDelay": ref("AnalyticsMetric")})
	schemas["AnalyticsBacktestResult"] = strictObject([]string{"kind", "configId", "results", "trials", "retrospective", "notes"}, object{"kind": analyticsEnum("backtest"), "configId": analyticsID(), "results": analyticsArray("AnalyticsBacktestRuleResult", 300), "selectedRuleId": analyticsID(), "trials": analyticsInt(1, 10000), "retrospective": analyticsBool(), "notes": stringList()})
	schemas["AnalyticsScenarioResult"] = strictObject([]string{"kind", "scenarioId", "currency", "points", "notes"}, object{"kind": analyticsEnum("scenario"), "scenarioId": analyticsID(), "currency": analyticsText(), "points": analyticsArray("AnalyticsScenarioPoint", 120), "notes": stringList()})
	schemas["AnalyticsResultContent"] = object{"oneOf": []any{ref("AnalyticsMeasurementResult"), ref("AnalyticsIndicatorResult"), ref("AnalyticsSignalResult"), ref("AnalyticsBacktestResult"), ref("AnalyticsScenarioResult")}}
	schemas["AnalyticsInputSnapshot"] = strictObject([]string{"datasets", "series", "rules", "indicators"}, object{"datasets": analyticsArray("AnalyticsDataset", 8), "series": analyticsArray("AnalyticsSeries", 100), "rules": analyticsArray("AnalyticsRule", 100), "indicators": analyticsArray("AnalyticsIndicator", 100)})
	schemas["AnalyticsResult"] = analyticsEntity(object{"engineVersion": analyticsText(), "dataVersions": object{"type": "object", "additionalProperties": analyticsInt(1, 1000000000)}, "modelVersion": analyticsInt(1, 9007199254740991), "createdAt": analyticsClock(), "interval": ref("AnalyticsInterval"), "parameters": object{"type": "object", "additionalProperties": true}, "inputSnapshot": ref("AnalyticsInputSnapshot"), "stale": analyticsBool(), "content": ref("AnalyticsResultContent")}, "engineVersion", "dataVersions", "modelVersion", "createdAt", "interval", "parameters", "inputSnapshot", "stale", "content")
	schemas["AnalyticsRetention"] = strictObject([]string{"results", "dataVersions"}, object{"results": analyticsInt(1, 12), "dataVersions": analyticsInt(1, 3)})
	schemas["AnalyticsScenarioView"] = strictObject(nil, object{"customerHistorySeriesId": analyticsID(), "mrcHistorySeriesId": analyticsID()})
	schemas["AnalyticsScenarioView"].(object)["description"] = "Optional visualization-only observed history sources for scenario comparison and SVG export. Select observed count/customer and matching-currency/MRC snapshots with UTC calendar, first/last monthly aggregation and observation/day/week/month resolution. No source is inferred. Queries preserve gaps and explicit source dimensions and stop before the projection-start boundary. This does not change scenario assumptions or historical observations."
	properties := object{"schemaVersion": object{"type": "integer", "enum": []int{1}}, "engineVersion": analyticsText(), "datasets": analyticsArray("AnalyticsDataset", 8), "series": analyticsArray("AnalyticsSeries", 100), "charts": analyticsArray("AnalyticsChart", 20), "indicators": analyticsArray("AnalyticsIndicator", 100), "measurements": analyticsArray("AnalyticsMeasurement", 200), "rules": analyticsArray("AnalyticsRule", 100), "signals": analyticsArray("AnalyticsSignal", 10000), "backtests": analyticsArray("AnalyticsBacktest", 30), "scenarios": analyticsArray("AnalyticsScenario", 30), "results": analyticsArray("AnalyticsResult", 12), "retention": ref("AnalyticsRetention")}
	properties["scenarioView"] = ref("AnalyticsScenarioView")
	required := []string{"schemaVersion", "engineVersion", "datasets", "series", "charts", "indicators", "measurements", "rules", "signals", "backtests", "scenarios", "results", "retention"}
	schemas["AnalyticsExtension"] = strictObject(required, properties)
	schemas["AnalyticsExtension"].(object)["description"] = analyticsPolicy + " Observation count is bounded to 200000 across all datasets; no new database or top-level document type is introduced. Immutable saved result snapshots retain their original input and are explicitly removed with the result."
	schemas["AnalyticsReplacement"] = strictObject([]string{"baseVersion", "value"}, object{"baseVersion": analyticsInt(1, 9007199254740991), "value": ref("AnalyticsExtension")})
	schemas["AnalyticsModelSnapshot"] = strictObject([]string{"diagramId", "baseVersion", "analytics"}, object{"diagramId": object{"type": "string", "format": "uuid"}, "baseVersion": analyticsInt(1, 9007199254740991), "analytics": object{"oneOf": []any{ref("AnalyticsExtension"), ref("AnalyticsSummary")}}})
	summaryProperties := clone(properties)
	summaryProperties["datasets"] = analyticsArray("AnalyticsDatasetSummary", 8)
	summaryProperties["signals"] = strictObject([]string{"count"}, object{"count": analyticsInt(0, 200000)})
	summaryProperties["results"] = analyticsArray("AnalyticsResultSummary", 12)
	schemas["AnalyticsSummary"] = strictObject(required, summaryProperties)
	resultSummary := clone(schemas["AnalyticsResult"].(object))
	rsp := resultSummary["properties"].(map[string]any)
	delete(rsp, "inputSnapshot")
	delete(rsp, "content")
	rsp["kind"] = analyticsEnum("measurement", "indicator", "signals", "backtest", "scenario")
	rsp["inputAvailable"] = analyticsBool()
	resultSummary["required"] = []string{"id", "engineVersion", "dataVersions", "modelVersion", "createdAt", "interval", "parameters", "stale", "kind", "inputAvailable"}
	schemas["AnalyticsResultSummary"] = resultSummary
	// Preserve the actual browser validator's independent collection limits.
	extension := schemas["AnalyticsExtension"].(object)["properties"].(object)
	for key, maximum := range map[string]int{"charts": 20, "measurements": 200, "signals": 10000, "backtests": 30, "scenarios": 30} {
		extension[key].(object)["maxItems"] = maximum
	}
	summary := schemas["AnalyticsSummary"].(object)["properties"].(object)
	for key, maximum := range map[string]int{"charts": 20, "measurements": 200, "backtests": 30, "scenarios": 30} {
		summary[key].(object)["maxItems"] = maximum
	}
	schemas["AnalyticsScenario"].(object)["properties"].(object)["periods"] = analyticsInt(1, 120)
	schemas["AnalyticsBacktest"].(object)["properties"].(object)["walkForwardPeriods"] = analyticsInt(1, 1000)
	schemas["AnalyticsOutcome"].(object)["properties"].(object)["horizon"] = analyticsInt(1, 120)
	schemas["AnalyticsMeasurement"].(object)["properties"].(object)["lag"] = object{"type": "integer", "minimum": -1000, "maximum": 1000}
	measurementSeries := schemas["AnalyticsMeasurement"].(object)["properties"].(object)["seriesIds"].(object)
	measurementSeries["minItems"] = 1
	measurementSeries["maxItems"] = 20
	schemas["AnalyticsIndicator"].(object)["properties"].(object)["multiplier"] = object{"type": "number", "minimum": 0, "maximum": 100}
	schemas["AnalyticsSeries"].(object)["properties"].(object)["columnId"] = object{"type": "string", "minLength": 1, "maxLength": 300}
	schemas["AnalyticsSeries"].(object)["description"] = "Observed and derived values remain distinct. Derived provenance requires an explicit validated expression referencing existing compatible series; a derived expression requires derived provenance. Aggregation must respect snapshot, flow or rate semantics. Optional columnId is a nonempty 1–300-character source column reference."
	schemas["AnalyticsRule"].(object)["description"] = "Custom rules require a validated expression; other families must omit expression. KPI divergence requires secondSeriesId; other families must omit it. References, parameter combinations, units, warm-up and expression complexity are validated against the authoritative model."
	addAnalyticsImportSchemas(schemas)
	addAnalyticsCommandSchemas(schemas)
}

func addAnalyticsImportSchemas(schemas object) {
	schemas["AnalyticsImportSource"] = object{"oneOf": []any{
		strictObject([]string{"kind", "name", "text"}, object{"kind": analyticsEnum("csv", "json"), "name": analyticsText(), "text": analyticsText()}),
		strictObject([]string{"kind", "name", "data"}, object{"kind": analyticsEnum("xlsx"), "name": analyticsText(), "data": object{"type": "string", "format": "byte", "description": "Strict padded standard base64 XLSX bytes; the full request must fit the separate 32 MiB transport envelope."}, "sheet": analyticsText()}),
	}}
	column := strictObject([]string{"column", "seriesId", "name", "unit", "semantics", "aggregation", "direction"}, object{"column": analyticsText(), "seriesId": analyticsID(), "name": analyticsText(), "unit": ref("AnalyticsUnit"), "semantics": analyticsEnum("snapshot", "flow", "rate"), "aggregation": analyticsEnum("sum", "first", "last", "ratio", "none"), "direction": analyticsEnum("higher-is-better", "lower-is-better", "neutral"), "riskPopulation": analyticsRiskPopulation()})
	schemas["AnalyticsImportColumn"] = column
	long := clone(column)
	lp := long["properties"].(map[string]any)
	delete(lp, "column")
	delete(lp, "seriesId")
	lp["id"] = analyticsID()
	long["required"] = []string{"id", "name", "unit", "semantics", "aggregation", "direction"}
	schemas["AnalyticsImportLongSeries"] = long
	schemas["AnalyticsImportMapping"] = strictObject([]string{"format", "timeColumn", "dimensions", "decimal", "percent", "dateFormat", "timezone", "resolution", "duplicatePolicy", "invalidRows", "missingValues"}, object{"format": analyticsEnum("wide", "long"), "timeColumn": analyticsText(), "valueColumns": analyticsArray("AnalyticsImportColumn", 100), "valueColumn": analyticsText(), "seriesColumn": analyticsText(), "dimensions": stringList(), "knownAtColumn": analyticsText(), "numeratorColumn": analyticsText(), "denominatorColumn": analyticsText(), "ohlcColumns": strictObject([]string{"open", "high", "low", "close"}, object{"open": analyticsText(), "high": analyticsText(), "low": analyticsText(), "close": analyticsText()}), "decimal": analyticsEnum(".", ","), "percent": analyticsEnum("ratio", "percent"), "dateFormat": analyticsEnum("iso", "dmy", "mdy", "excel-1900", "excel-1904"), "timezone": analyticsText(), "resolution": analyticsEnum("observation", "day", "week", "month", "quarter", "year"), "duplicatePolicy": analyticsEnum("reject", "first", "last", "keep"), "invalidRows": analyticsEnum("reject", "skip"), "missingValues": analyticsEnum("preserve", "reject"), "longSeries": analyticsArray("AnalyticsImportLongSeries", 100)})
	schemas["AnalyticsImportInput"] = strictObject([]string{"source", "mapping", "datasetId"}, object{"source": ref("AnalyticsImportSource"), "mapping": ref("AnalyticsImportMapping"), "datasetId": analyticsID()})
	schemas["AnalyticsImportInspectInput"] = strictObject([]string{"source"}, object{"source": ref("AnalyticsImportSource"), "seriesColumn": analyticsText()})
	schemas["AnalyticsImportInspection"] = strictObject([]string{"columns", "sample", "rows", "sheets"}, object{"columns": stringList(), "sample": object{"type": "array", "maxItems": 10, "items": object{"type": "object", "additionalProperties": true}}, "rows": analyticsInt(0, 10000000), "sheets": stringList(), "seriesNames": stringList()})
	schemas["AnalyticsImportPreview"] = strictObject([]string{"dataset", "series", "issues", "columns", "sample", "valid", "rows", "skippedRows"}, object{"dataset": ref("AnalyticsDataset"), "series": analyticsArray("AnalyticsSeries", 100), "issues": analyticsArray("AnalyticsIssue", 200000), "columns": stringList(), "sample": object{"type": "array", "maxItems": 100, "items": object{"type": "object", "additionalProperties": object{"oneOf": []any{analyticsText(), analyticsNumber(), object{"type": "string", "nullable": true, "enum": []any{nil}}}}}}, "valid": analyticsBool(), "rows": analyticsInt(0, 10000000), "skippedRows": analyticsInt(0, 10000000)})
	schemas["AnalyticsImportCommit"] = strictObject([]string{"baseVersion", "input", "mode", "confirmed"}, object{"baseVersion": analyticsInt(1, 9007199254740991), "input": ref("AnalyticsImportInput"), "mode": analyticsEnum("create", "replace", "update"), "confirmed": object{"type": "boolean", "enum": []bool{true}}})
}

func addAnalyticsCommandSchemas(schemas object) {
	for _, entry := range []struct{ kind, field, schema string }{{"Measurement", "measurement", "AnalyticsMeasurement"}, {"Indicator", "indicator", "AnalyticsIndicator"}, {"Backtest", "config", "AnalyticsBacktest"}, {"Scenario", "scenario", "AnalyticsScenario"}} {
		schemas["Analytics"+entry.kind+"Preview"] = object{"oneOf": []any{strictObject([]string{"id"}, object{"id": analyticsID()}), strictObject([]string{entry.field}, object{entry.field: ref(entry.schema)})}}
	}
	schemas["AnalyticsWaterfallPreview"] = object{"oneOf": []any{strictObject([]string{"id", "time"}, object{"id": analyticsID(), "time": analyticsClock()}), strictObject([]string{"chart", "time"}, object{"chart": ref("AnalyticsChart"), "time": analyticsClock()})}}
	schemas["AnalyticsWaterfallResult"] = strictObject([]string{"opening", "closing", "components", "residual", "reconciled", "unit"}, object{"opening": analyticsNumber(), "closing": analyticsNumber(), "components": object{"type": "array", "maxItems": 100, "items": strictObject([]string{"seriesId", "name", "value"}, object{"seriesId": analyticsID(), "name": analyticsText(), "value": analyticsNumber()})}, "residual": analyticsNumber(), "reconciled": analyticsBool(), "unit": ref("AnalyticsUnit")})
	schemas["AnalyticsSignalPreview"] = strictObject(nil, object{"ruleIds": analyticsIDs(100), "from": analyticsClock(), "to": analyticsClock()})
	schemas["AnalyticsQuery"] = strictObject([]string{"seriesId"}, object{"seriesId": analyticsID(), "from": analyticsClock(), "to": analyticsClock(), "resolution": analyticsEnum("observation", "day", "week", "month", "quarter", "year"), "dimensions": analyticsDimensions(), "cutoff": analyticsClock(), "ohlc": analyticsBool()})
	variants := []any{}
	for _, entry := range []struct{ kind, input string }{{"measurement", "AnalyticsMeasurementPreview"}, {"indicator", "AnalyticsIndicatorPreview"}, {"signals", "AnalyticsSignalPreview"}, {"backtest", "AnalyticsBacktestPreview"}, {"scenario", "AnalyticsScenarioPreview"}, {"import", "AnalyticsImportInput"}, {"query", "AnalyticsQuery"}, {"inspect-import", "AnalyticsImportInspectInput"}, {"waterfall", "AnalyticsWaterfallPreview"}} {
		variants = append(variants, strictObject([]string{"kind", "input"}, object{"kind": analyticsEnum(entry.kind), "input": ref(entry.input)}))
	}
	schemas["AnalyticsJobInput"] = object{"oneOf": variants}
	schemas["AnalyticsJobState"] = strictObject([]string{"jobId", "diagramId", "kind", "state", "progress", "createdAt"}, object{"jobId": object{"type": "string", "format": "uuid"}, "diagramId": object{"type": "string", "format": "uuid"}, "kind": analyticsEnum("measurement", "indicator", "signals", "backtest", "scenario", "import", "query", "inspect-import", "waterfall"), "state": analyticsEnum("running", "succeeded", "failed", "cancelled"), "progress": analyticsInt(0, 100), "createdAt": analyticsClock(), "error": strictObject([]string{"code", "message"}, object{"code": analyticsText(), "message": analyticsText()})})
	schemas["AnalyticsJobArchive"] = strictObject([]string{"baseVersion"}, object{"baseVersion": analyticsInt(1, 9007199254740991), "mode": analyticsEnum("create", "replace", "update"), "confirmed": object{"type": "boolean", "enum": []bool{true}}})
	schemas["AnalyticsPage"] = strictObject([]string{"offset", "nextOffset", "total", "complete", "items"}, object{"offset": analyticsInt(0, 20000000), "nextOffset": analyticsInt(0, 20000000), "total": analyticsInt(0, 20000000), "complete": analyticsBool(), "items": object{"type": "array", "maxItems": 1000, "items": object{}}})
	schemas["AnalyticsQueryPage"] = clone(schemas["AnalyticsPage"].(object))
	schemas["AnalyticsQueryPage"].(object)["properties"].(map[string]any)["seriesId"] = analyticsID()
	schemas["AnalyticsQueryPage"].(object)["required"] = []string{"seriesId", "offset", "nextOffset", "total", "complete", "items"}
	schemas["AnalyticsJobPage"] = object{"type": "object", "required": []string{"jobId", "kind", "summary", "offset", "nextOffset", "total", "complete", "items"}, "properties": object{"jobId": object{"type": "string", "format": "uuid"}, "kind": analyticsText(), "summary": object{"type": "object", "additionalProperties": true}, "itemKey": analyticsText(), "offset": analyticsInt(0, 20000000), "nextOffset": analyticsInt(0, 20000000), "total": analyticsInt(0, 20000000), "complete": analyticsBool(), "items": object{"type": "array", "maxItems": 1000, "items": object{}}}, "additionalProperties": false}
	schemas["AnalyticsCapabilities"] = object{"type": "object", "description": "Discover the actual frontend engine methods, defaults, warm-up, units, limits and permission effects. This public software metadata contains no workspace data.", "additionalProperties": true}
	schemas["AnalyticsScenarioComparisonInput"] = strictObject([]string{"scenarioIds"}, object{"scenarioIds": object{"type": "array", "minItems": 2, "maxItems": 20, "uniqueItems": true, "items": analyticsID()}})
	schemas["AnalyticsScenarioComparison"] = strictObject([]string{"scenarioIds", "results", "interpretation"}, object{"scenarioIds": analyticsIDs(20), "results": analyticsArray("AnalyticsScenarioResult", 20), "interpretation": analyticsText()})
	schemas["AnalyticsSvgOptions"] = strictObject(nil, object{"width": analyticsInt(320, 4096), "height": analyticsInt(240, 4096), "appearance": analyticsEnum("light", "dark"), "from": analyticsClock(), "to": analyticsClock(), "time": analyticsClock(), "threshold": analyticsNumber(), "dimensions": analyticsDimensions(), "maxPoints": analyticsInt(100, 10000)})
	schemas["AnalyticsSvgOptions"].(object)["properties"].(object)["dimensions"].(object)["description"] = "Chart segment filter; regression must retain its measurement filter. Scenario SVG rejects this override and uses the selected canonical history series dimensions."
	for _, field := range []string{"customerHistorySeriesId", "mrcHistorySeriesId"} {
		option := analyticsID()
		option["nullable"] = true
		option["description"] = "Scenario SVG only: override this explicitly saved observed history source; null omits it for this export. Omission uses analytics.scenarioView. Selected MRC currency must match the scenario."
		schemas["AnalyticsSvgOptions"].(object)["properties"].(object)[field] = option
	}
	schemas["AnalyticsDataExportInput"] = strictObject([]string{"scope", "format"}, object{"scope": analyticsEnum("observations", "measurement", "signals", "scenario"), "id": analyticsID(), "format": analyticsEnum("json", "csv")})
	schemas["AnalyticsSvgExportInput"] = strictObject([]string{"scope", "id", "format"}, object{"scope": analyticsEnum("chart", "indicator", "scenario", "measurement"), "id": analyticsID(), "format": analyticsEnum("svg"), "options": ref("AnalyticsSvgOptions")})
	schemas["AnalyticsExportInput"] = object{"oneOf": []any{ref("AnalyticsDataExportInput"), ref("AnalyticsSvgExportInput")}}
	schemas["AnalyticsSvgResult"] = strictObject([]string{"scope", "format", "mimeType", "data", "sourcePoints", "renderedPoints", "sampled", "warnings"}, object{"scope": analyticsEnum("chart", "indicator", "scenario", "measurement"), "format": analyticsEnum("svg"), "mimeType": analyticsEnum("image/svg+xml"), "data": analyticsText(), "sourcePoints": analyticsInt(0, 20000000), "renderedPoints": analyticsInt(0, 10000), "sampled": analyticsBool(), "warnings": stringList()})
	schemas["AnalyticsDataExportResult"] = strictObject([]string{"scope", "format", "offset", "nextOffset", "total", "complete", "data", "warnings"}, object{"scope": analyticsText(), "format": analyticsEnum("json", "csv"), "offset": analyticsInt(0, 20000000), "nextOffset": analyticsInt(0, 20000000), "total": analyticsInt(0, 20000000), "complete": analyticsBool(), "data": object{"oneOf": []any{analyticsText(), object{"type": "array", "items": object{"type": "object", "additionalProperties": true}}}}, "warnings": stringList()})
	schemas["AnalyticsResultInputSummary"] = strictObject([]string{"resultId", "inputSnapshot"}, object{"resultId": analyticsID(), "inputSnapshot": strictObject([]string{"datasets", "series", "rules", "indicators"}, object{"datasets": analyticsArray("AnalyticsDatasetSummary", 8), "series": analyticsArray("AnalyticsSeries", 100), "rules": analyticsArray("AnalyticsRule", 100), "indicators": analyticsArray("AnalyticsIndicator", 100)})})
	schemas["AnalyticsResultInputPage"] = object{"type": "object", "required": []string{"resultId", "datasetId", "dataVersion", "offset", "nextOffset", "total", "complete", "items"}, "properties": object{"resultId": analyticsID(), "datasetId": analyticsID(), "dataVersion": analyticsInt(1, 1000000000), "offset": analyticsInt(0, 20000000), "nextOffset": analyticsInt(0, 20000000), "total": analyticsInt(0, 20000000), "complete": analyticsBool(), "items": analyticsArray("AnalyticsObservation", 1000)}, "additionalProperties": false}
	schemas["AnalyticsResultInputResponse"] = object{"oneOf": []any{ref("AnalyticsResultInputSummary"), ref("AnalyticsResultInputPage")}}
	schemas["AnalyticsArchivedResultPage"] = clone(schemas["AnalyticsJobPage"].(object))
	arp := schemas["AnalyticsArchivedResultPage"].(object)["properties"].(map[string]any)
	delete(arp, "jobId")
	arp["resultId"] = analyticsID()
	schemas["AnalyticsArchivedResultPage"].(object)["required"] = []string{"resultId", "kind", "summary", "offset", "nextOffset", "total", "complete", "items"}
	schemas["AnalyticsExportResult"] = object{"oneOf": []any{ref("AnalyticsDataExportResult"), ref("AnalyticsSvgResult")}}
	for _, entry := range []struct{ name, schema string }{{"Dataset", "AnalyticsDataset"}, {"Series", "AnalyticsSeries"}, {"Chart", "AnalyticsChart"}, {"Indicator", "AnalyticsIndicator"}, {"Measurement", "AnalyticsMeasurement"}, {"Rule", "AnalyticsRule"}, {"Backtest", "AnalyticsBacktest"}, {"Scenario", "AnalyticsScenario"}, {"SignalHandling", "AnalyticsSignalHandling"}} {
		schemas[entry.schema+"Patch"] = analyticsSchemaPatch(schemas[entry.schema].(object), schemas)
		schemas["Analytics"+entry.name+"Create"] = strictObject([]string{"baseVersion", "value"}, object{"baseVersion": analyticsInt(1, 9007199254740991), "value": ref(entry.schema)})
		schemas["Analytics"+entry.name+"Update"] = strictObject([]string{"baseVersion", "value"}, object{"baseVersion": analyticsInt(1, 9007199254740991), "value": ref(entry.schema + "Patch")})
	}
	for _, field := range []string{"acknowledged", "muted"} {
		delete(schemas["AnalyticsSignalHandlingPatch"].(object)["properties"].(object)[field].(object), "nullable")
	}

}

func addAnalyticsPaths(add func(string, string, string, string, string, string), paths object) {
	add("GET", "/analytics/capabilities", "Discover Time Series & Signal Analysis methods and limits", "", "AnalyticsCapabilities", "200")
	base := "/diagrams/{diagramId}/analytics"
	add("GET", base, "Inspect semantic analysis configuration; compact summaries by default", "", "AnalyticsModelSnapshot", "200")
	addQuery(paths, base, "full", analyticsBool(), false)
	add("PUT", base, "Replace the complete analytics extension at current baseVersion", "AnalyticsReplacement", "AnalyticsModelSnapshot", "200")
	for _, entry := range []struct{ path, name, schema string }{{"datasets", "Dataset", "AnalyticsDatasetSummary"}, {"series", "Series", "AnalyticsSeries"}, {"charts", "Chart", "AnalyticsChart"}, {"indicators", "Indicator", "AnalyticsIndicator"}, {"measurements", "Measurement", "AnalyticsMeasurement"}, {"rules", "Rule", "AnalyticsRule"}, {"backtests", "Backtest", "AnalyticsBacktest"}, {"scenarios", "Scenario", "AnalyticsScenario"}} {
		path := base + "/" + entry.path
		add("GET", path, "List saved analytics "+entry.path, "", entry.schema+"[]", "200")
		add("POST", path, "Create a saved analytics definition; write access required", "Analytics"+entry.name+"Create", "AnalyticsModelSnapshot", "201")
		entity := path + "/{entityId}"
		add("GET", entity, "Inspect one saved semantic analytics definition", "", entry.schema, "200")
		add("PATCH", entity, "Update one definition without changing its identity; write access required", "Analytics"+entry.name+"Update", "AnalyticsModelSnapshot", "200")
		add("DELETE", entity, "Delete one unreferenced analytics definition at current baseVersion", "", "", "204")
		analyticsQuery(paths, entity, "delete", "baseVersion", analyticsInt(1, 1000000000), true)
		for _, method := range []string{"get", "patch", "delete"} {
			analyticsSemanticParameter(paths[entity].(object)[method].(object), "entityId")
		}
	}
	for _, entry := range []struct{ path, input, result string }{{"measure", "AnalyticsMeasurementPreview", "AnalyticsMeasurementResult"}, {"indicator", "AnalyticsIndicatorPreview", "AnalyticsIndicatorResult"}, {"evaluate", "AnalyticsSignalPreview", "AnalyticsSignalResult"}, {"validate", "AnalyticsBacktestPreview", "AnalyticsBacktestResult"}, {"project", "AnalyticsScenarioPreview", "AnalyticsScenarioResult"}, {"waterfall", "AnalyticsWaterfallPreview", "AnalyticsWaterfallResult"}} {
		add("POST", base+"/"+entry.path, "Calculate unsaved "+entry.path+" preview with Read only access", entry.input, entry.result, "200")
	}
	add("POST", base+"/compare", "Compare saved scenarios over an identical currency/time horizon; Read only access", "AnalyticsScenarioComparisonInput", "AnalyticsScenarioComparison", "200")
	add("POST", base+"/export", "Export bounded semantic JSON/CSV pages or a DOM-free chart/indicator/scenario/regression SVG with separate unit panels; Read only access", "AnalyticsExportInput", "AnalyticsExportResult", "200")
	add("POST", base+"/import/inspect", "Inspect local columns, sample and sheets before choosing a mapping; Read only access", "AnalyticsImportInspectInput", "AnalyticsImportInspection", "200")
	add("POST", base+"/import/preview", "Preview mapped CSV/XLSX/JSON with Read only access", "AnalyticsImportInput", "AnalyticsImportPreview", "200")
	add("POST", base+"/import/commit", "Commit explicitly reviewed import atomically at current baseVersion", "AnalyticsImportCommit", "AnalyticsModelSnapshot", "200")
	add("POST", base+"/query", "Query full-resolution or explicitly aggregated data in bounded pages; Read only access", "AnalyticsQuery", "AnalyticsQueryPage", "200")
	for _, path := range []string{base + "/query", base + "/signals", base + "/results", base + "/jobs/{jobId}/result"} {
		if paths[path] == nil {
			paths[path] = object{}
		}
	}
	add("GET", base+"/signals", "Inspect computed signal history in bounded pages", "", "AnalyticsPage", "200")
	add("GET", base+"/signals/{entityId}", "Inspect one semantic signal and its evidence", "", "AnalyticsSignal", "200")
	add("PATCH", base+"/signals/{entityId}", "Change handling/link fields without changing computed evidence", "AnalyticsSignalHandlingUpdate", "AnalyticsModelSnapshot", "200")
	add("GET", base+"/results", "Inspect retained immutable result archives in bounded pages", "", "AnalyticsPage", "200")
	add("GET", base+"/results/{entityId}", "Inspect one immutable result summary; content/input use separate pages", "", "AnalyticsResultSummary", "200")
	add("DELETE", base+"/results/{entityId}", "Remove a result and its retained original input; write access required", "", "", "204")
	analyticsQuery(paths, base+"/results/{entityId}", "delete", "baseVersion", analyticsInt(1, 1000000000), true)
	add("GET", base+"/results/{entityId}/content", "Read immutable archived numerical content in bounded pages", "", "AnalyticsArchivedResultPage", "200")
	add("GET", base+"/results/{entityId}/input", "Discover retained original input or page one original dataset", "", "AnalyticsResultInputResponse", "200")
	analyticsQuery(paths, base+"/results/{entityId}/input", "get", "datasetId", analyticsID(), false)
	add("POST", base+"/jobs", "Start an unsaved cancellable local worker job; Read only access", "AnalyticsJobInput", "AnalyticsJobState", "201")
	add("GET", base+"/jobs/{jobId}", "Inspect transient job status/progress with original session and grant", "", "AnalyticsJobState", "200")
	add("DELETE", base+"/jobs/{jobId}", "Cancel and erase transient job without mutating a document; Read only access", "", "AnalyticsJobState", "200")
	add("GET", base+"/jobs/{jobId}/result", "Retrieve a transient worker result in bounded pages", "", "AnalyticsJobPage", "200")
	add("POST", base+"/jobs/{jobId}/archive", "Archive a completed result at current baseVersion; write access required", "AnalyticsJobArchive", "AnalyticsModelSnapshot", "200")
	for _, path := range []string{base + "/query", base + "/export", base + "/signals", base + "/results", base + "/jobs/{jobId}/result", base + "/results/{entityId}/content", base + "/results/{entityId}/input"} {
		method := "get"
		if path == base+"/query" || path == base+"/export" {
			method = "post"
		}
		analyticsQuery(paths, path, method, "offset", analyticsInt(0, 20000000), false)
		analyticsQuery(paths, path, method, "limit", analyticsInt(1, 1000), false)
	}
	for path, raw := range paths {
		if path != "/analytics/capabilities" && len(path) >= len(base) && path[:len(base)] != base {
			continue
		}
		if path != "/analytics/capabilities" && len(path) < len(base) {
			continue
		}
		for _, operation := range raw.(object) {
			op := operation.(object)
			op["description"] = analyticsPolicy
			if path == base+"/signals/{entityId}" || path == base+"/results/{entityId}" {
				analyticsSemanticParameter(op, "entityId")
			}
		}
	}
}
func analyticsQuery(paths object, path, method, name string, definition object, required bool) {
	op := paths[path].(object)[method].(object)
	parameters, _ := op["parameters"].([]any)
	op["parameters"] = append(parameters, object{"name": name, "in": "query", "required": required, "schema": definition})
}
func analyticsSemanticParameter(operation object, name string) {
	if parameters, ok := operation["parameters"].([]any); ok {
		for _, raw := range parameters {
			parameter := raw.(object)
			if parameter["name"] == name {
				parameter["schema"] = analyticsID()
			}
		}
	}
}
func addAnalyticsErrorResponses(paths object) {
	for path, raw := range paths {
		if path != "/analytics/capabilities" && !(len(path) >= len("/diagrams/") && path[:len("/diagrams/")] == "/diagrams/" && containsAnalyticsPath(path)) {
			continue
		}
		for _, operation := range raw.(object) {
			op := operation.(object)
			responses := op["responses"].(object)
			responses["413"] = object{"description": "Analytics import, response, archive or retained job budget exceeded; use bounded pages or a smaller interval/batch", "content": object{"application/json": object{"schema": object{"anyOf": []any{ref("AnalyticsError"), ref("Error")}}}}}
			responses["422"] = object{"description": "Structured analytics validation error with row/column-localized issues, or existing operation-id validation error", "content": object{"application/json": object{"schema": object{"anyOf": []any{ref("AnalyticsError"), ref("Error"), ref("OperationError")}}}}}
		}
	}
}
func containsAnalyticsPath(path string) bool {
	for index := 0; index+len("/analytics") <= len(path); index++ {
		if path[index:index+len("/analytics")] == "/analytics" {
			return true
		}
	}
	return false
}

// Compact discovery avoids transferring observations/archives while finding analysis documents.
func addAnalyticsDiscovery(schemas, paths object) {
	compact := clone(schemas["Diagram"].(object))
	props := compact["properties"].(map[string]any)
	delete(props, "analytics")
	props["analyticsSummary"] = strictObject([]string{"schemaVersion", "engineVersion", "datasets", "series"}, object{"schemaVersion": object{"type": "integer", "enum": []int{1}}, "engineVersion": analyticsText(), "datasets": analyticsInt(0, 8), "series": analyticsInt(0, 100)})
	schemas["AnalyticsDiagramSummary"] = compact
	addQuery(paths, "/diagrams", "analytics", object{"type": "boolean", "enum": []bool{true}}, false)
	op := paths["/diagrams"].(object)["get"].(object)
	op["description"] = "Use ?analytics=true to discover only Time Series & Signal Analysis diagrams with compact analyticsSummary metadata. Observations and archives are omitted in this mode. The legacy default returns full diagrams and can exceed the independent transport envelope on large workspaces. " + analyticsPolicy
	response := op["responses"].(object)["200"].(object)
	response["content"].(object)["application/json"].(object)["schema"] = object{"anyOf": []any{object{"type": "array", "items": ref("Diagram")}, object{"type": "array", "items": ref("AnalyticsDiagramSummary")}}}
}
