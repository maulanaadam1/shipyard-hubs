package workers

import (
	"encoding/json"
	"testing"
	"time"
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

// last_sync is local server time; on a UTC+7 server a 5-minute sync must be
// due 5 minutes later, not 7 hours and 5 minutes later.
func TestSyncDueUsesLocalTime(t *testing.T) {
	wib := time.FixedZone("WIB", 7*3600)
	now := time.Date(2026, 11, 3, 20, 4, 0, 0, wib)
	cases := []struct {
		last, typ string
		value     int
		want      bool
	}{
		{"2026-11-03 13:56:53", "minutes", 5, true},
		{"2026-11-03 20:01:00", "minutes", 5, false},
		{"2026-11-03 19:59:00", "minutes", 5, true},
		{"2026-11-03 17:08:31", "hours", 6, false},
		{"2026-11-01 23:19:53", "days", 5, false},
		{"", "minutes", 5, true},
		{"not a time", "minutes", 5, true},
	}
	for _, c := range cases {
		if got := syncDue(c.last, c.typ, c.value, now); got != c.want {
			t.Errorf("syncDue(%q, %s %d) = %v, want %v", c.last, c.typ, c.value, got, c.want)
		}
	}
}
