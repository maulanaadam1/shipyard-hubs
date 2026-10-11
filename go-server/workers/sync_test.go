package workers

import (
	"encoding/json"
	"testing"
)

func TestMergeSyncResponsesTagsProjectScope(t *testing.T) {
	external := []byte(`{"data": [{"id": 1, "project": "external"}, {"id": 2, "project": "external"}]}`)
	internal := []byte(`{"data": [{"id": 3, "project": "internal"}, {"id": 4, "project": "external"}, {"id": 2, "project": "external"}]}`)
	body, err := mergeSyncResponses([][]byte{external, internal}, []string{
		"https://x/api/v2/work-orders?sort=updated_at%7Cdesc",
		"https://x/api/v2/work-orders?sort=updated_at%7Cdesc&project=internal",
	})
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Data []map[string]interface{} `json:"data"`
	}
	json.Unmarshal(body, &out)
	if len(out.Data) != 4 {
		t.Fatalf("want 4 unique WOs, got %d", len(out.Data))
	}
	scope := map[float64]interface{}{}
	for _, row := range out.Data {
		scope[row["id"].(float64)] = row["_project_scope"]
	}
	if scope[1] != nil {
		t.Errorf("WO 1 came only from the default list, scope = %v", scope[1])
	}
	// WO 4 is flagged "external" by SIAGA but belongs to the internal list.
	for _, id := range []float64{3, 4, 2} {
		if scope[id] != "internal" {
			t.Errorf("WO %v should be tagged internal, got %v", id, scope[id])
		}
	}
}

func TestProjectScope(t *testing.T) {
	if got := projectScope("https://x/api?sort=a&project=Internal"); got != "internal" {
		t.Errorf("got %q", got)
	}
	if got := projectScope("https://x/api?sort=a"); got != "" {
		t.Errorf("got %q", got)
	}
}
