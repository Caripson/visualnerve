package model

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestRobloxGameDefinitionSurvivesDiagramDTO(t *testing.T) {
	payload := `{"schemaVersion":1,"id":"game","name":"Synthetic game","description":"","settings":{"maxPlayers":8,"gravity":196.2,"walkSpeed":16,"jumpPower":50,"respawnSeconds":5,"ambient":"#ABCDEF"},"entities":[],"variables":[{"id":"coins","name":"Coins","scope":"player","initial":0,"min":0}],"items":[],"quests":[],"timers":[],"prefabs":[],"instances":[],"rules":[{"id":"join","name":"Join","enabled":true,"event":{"kind":"playerJoin"},"actions":[{"kind":"setVariable","variableId":"coins","value":{"kind":"arithmetic","operator":"+","left":{"kind":"literal","value":1.5},"right":{"kind":"literal","value":2}}}],"cooldown":0,"oncePerPlayer":true}]}`
	var game Meta
	if err := json.Unmarshal([]byte(payload), &game); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(Graph{Diagram: Diagram{Game: game}})
	if err != nil {
		t.Fatal(err)
	}
	var restored Graph
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(game, restored.Diagram.Game) {
		t.Fatal("bridge DTO changed the portable game AST or finite fractional world values")
	}
}
