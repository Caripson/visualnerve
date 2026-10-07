package server

import (
	"strings"
	"testing"
)

func TestMCPDiscoversProcessSimulatorWithoutAConnectedBrowser(t *testing.T) {
	handler, openapi := bundledMCPServer(t)
	initialized := resultMCP(t, callMCP(t, handler, "initialize", nil))
	for _, phrase := range []string{"Process Simulator", "process-simulator", "schemaVersion:1", "same deterministic worker engine", "Headless/MAX", "browser must remain connected", "visualCapacity", "Counter 1/2/3", "anonymous capacity units"} {
		if !strings.Contains(initialized["instructions"].(string), phrase) {
			t.Fatal("missing simulation discovery", phrase)
		}
	}
	for _, phrase := range []string{"## Process Simulator", "/simulation/capabilities", "shared resources", "demandMultiplier", "simulation/compare", "durationSeconds", "no selected diagram", "visualCapacity", "sharedLogicalModel", "eight cards per bank", "3D retains the logical model"} {
		if !strings.Contains(mcpAPIGuide, phrase) {
			t.Fatal("missing semantic API guidance", phrase)
		}
	}
	for _, phrase := range []string{`"SimulationModel"`, `"SimulationScaling"`, `"SimulationResourceRequirement"`, `"SimulationResult"`, `"SimulationVisualCapacity"`, `"/simulation/capabilities"`, `"/diagrams/{diagramId}/simulation/runs"`} {
		if !strings.Contains(openapi, phrase) {
			t.Fatal("bundled schema missing simulation semantics", phrase)
		}
	}
	if len(handler.peers) != 0 {
		t.Fatal("documentation discovery unexpectedly opened a browser")
	}
}
