package handlers

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAIWantsChart(t *testing.T) {
	for q, want := range map[string]bool{
		"Buatkan grafik tagihan per minggu":       true,
		"Visualisasikan jam kerja vendor":         true,
		"chart WO per status":                     true,
		"Tolong buat diagram lembur":              true,
		"Berapa tagihan minggu lalu?":             false,
		"Siapa vendor dengan nilai WO tertinggi?": false,
		"grafiknya":                               false, // whole word only
	} {
		if got := aiWantsChart(q); got != want {
			t.Errorf("%q: got %v, want %v", q, got, want)
		}
	}
	// The example in the reminder is a chart the app accepts.
	start := strings.Index(aiChartReminder, "```chart\n") + len("```chart\n")
	end := strings.Index(aiChartReminder[start:], "\n```") + start
	var spec struct {
		Type   string
		Unit   string
		X      []string
		Series []struct{ Values []float64 }
	}
	if err := json.Unmarshal([]byte(aiChartReminder[start:end]), &spec); err != nil || spec.Type != "line" || len(spec.Series[0].Values) != len(spec.X) {
		t.Errorf("reminder example: %v %+v", err, spec)
	}
}
