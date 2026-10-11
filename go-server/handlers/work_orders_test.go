package handlers

import "testing"

func TestApprovalStatusText(t *testing.T) {
	cases := []struct {
		level  float64
		status string
		want   string
	}{
		{0, "", "Waiting"},
		{2, "", "Approval Level 2"},
		{4, "waiting", "Approval Level 4"},
		{5, "", "Approval Level 5"},
		{0, "Approved", "Approval Level 5"},
		{1, "approved level 5", "Approval Level 5"},
	}
	for _, c := range cases {
		if got := approvalStatusText(c.level, c.status); got != c.want {
			t.Errorf("approvalStatusText(%v, %q) = %q, want %q", c.level, c.status, got, c.want)
		}
	}
}

func TestTimelineKey(t *testing.T) {
	cases := []struct {
		value, group, want string
	}{
		{"2026-10-08 09:47:37", "day", "2026-10-08"},
		{"2026-10-08T09:47:37", "day", "2026-10-08"},
		{"2026-10-08", "week", "2026-10-05"}, // Thursday -> Monday
		{"2026-10-11", "week", "2026-10-05"}, // Sunday belongs to the week starting Monday
		{"2026-10-08", "month", "2026-10"},
		{"2026-10-08", "quarter", "2026-Q4"},
		{"2026-10-08", "year", "2026"},
		{"", "day", ""},
	}
	for _, c := range cases {
		if got := timelineKey(c.value, c.group); got != c.want {
			t.Errorf("timelineKey(%q, %q) = %q, want %q", c.value, c.group, got, c.want)
		}
	}
}

func TestSummaryFromWorkOrderListItem(t *testing.T) {
	s := summaryFromWorkOrderListItem(map[string]interface{}{
		"id":                 float64(14760),
		"code":               "WO26080021/YWTS",
		"jo_code":            "DRP26DKN039/YWTS",
		"m_ship_name":        "sadewa-231",
		"m_vendor_name":      "MASKURI",
		"min_approval_level": float64(2),
		"total_cost":         9686300.0,
		"created_at":         "2026-08-03 12:37:29",
		"updated_at":         "2026-09-30 16:28:35",
	})
	if s.WOID != "14760" || s.WOCode != "WO26080021/YWTS" {
		t.Fatalf("unexpected id/code: %+v", s)
	}
	if s.ProjectName != "DRP26DKN039/YWTS - SADEWA-231" || s.ShipName != "SADEWA-231" {
		t.Errorf("project/ship not normalised: %q / %q", s.ProjectName, s.ShipName)
	}
	if s.DerivedStatus != "Approval Level 2" {
		t.Errorf("DerivedStatus = %q", s.DerivedStatus)
	}
	if s.LatestDate != "2026-09-30" || s.UpdatedSourceAt != "2026-09-30 16:28:35" {
		t.Errorf("dates: latest=%q updated=%q", s.LatestDate, s.UpdatedSourceAt)
	}
	if s.TotalCost != 9686300 {
		t.Errorf("TotalCost = %v", s.TotalCost)
	}
}

func TestApplyFinancialsFromDetail(t *testing.T) {
	raw := []byte(`{"data": {
		"id": 1, "code": "WO-1", "min_approval_level": 2,
		"created_at": "2026-09-01 08:00:00", "updated_at": "2026-10-01 10:00:00",
		"repair_list": [{"id": "act-test", "path": "1", "parameter": {"path_name": "TEST > Activity"}, "material": [
			{"price": "1000", "volume": 2, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-10-01 10:00:00"},
			{"price": "500", "volume": 1, "approved_level": 0, "status_approval": "waiting", "date_approval": "2026-09-20 10:00:00"},
			{"total_price": 300, "approved_level": 0, "status_approval": "rejected", "date_approval": "2026-09-21 10:00:00"}
		]}]
	}}`)
	s := applyFinancialsFromDetail(workOrderSummary{WOID: "1"}, raw)
	if s.FinalCost != 2000 {
		t.Errorf("FinalCost = %v, want 2000", s.FinalCost)
	}
	if s.PendingCost != 500 {
		t.Errorf("PendingCost = %v, want 500", s.PendingCost)
	}
	if s.RejectedCost != 300 {
		t.Errorf("RejectedCost = %v, want 300", s.RejectedCost)
	}
	if s.LatestDate != "2026-10-01" || s.LatestCost != 2000 || s.PreviousCost != 0 {
		t.Errorf("latest: date=%q cost=%v previous=%v", s.LatestDate, s.LatestCost, s.PreviousCost)
	}
}
