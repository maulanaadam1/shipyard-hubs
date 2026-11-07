package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// A search that matches nothing must still answer with lists: the page maps
// over rows and units, and null there blanked the whole app.
func TestMarketingPriceReferenceNoMatchIsList(t *testing.T) {
	rec := httptest.NewRecorder()
	GetMarketingPriceReference(rec, httptest.NewRequest("GET", "/api/marketing-price-reference?search=tidak-ada-yang-cocok-sama-sekali", nil))
	var out map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	for _, key := range []string{"rows", "units"} {
		if _, ok := out[key].([]interface{}); !ok {
			t.Errorf("%s is not a list: %v", key, out[key])
		}
	}
}
