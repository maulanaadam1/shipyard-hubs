package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"

	"shipyard/db"
)

// noVendorLabel is what the dashboard shows (and sends back as a filter) for
// work orders whose vendor_name is empty.
const noVendorLabel = "Tanpa Vendor"

var joYearPattern = regexp.MustCompile(`\b(20\d{2})\b`)

type projectFacet struct {
	Name       string `json:"name"`
	Count      int    `json:"count"`
	LatestDate string `json:"latestDate"`
}

type vendorProjectFacet struct {
	Key          string  `json:"key"`
	VendorName   string  `json:"vendorName"`
	ProjectName  string  `json:"projectName"`
	Count        int     `json:"count"`
	Cost         float64 `json:"cost"`
	LatestWOID   int64   `json:"latestWOId"`
	LatestWOCode string  `json:"latestWOCode"`
	LatestWODate string  `json:"latestWODate"`
}

func vendorLabel(name string) string {
	if name == "" {
		return noVendorLabel
	}
	return name
}

// withoutFilters copies the query and drops the given filter keys, so a card can
// be narrowed by every active filter except the one it controls.
func withoutFilters(q url.Values, keys ...string) url.Values {
	out := url.Values{}
	for k, v := range q {
		out[k] = append([]string{}, v...)
	}
	for _, k := range keys {
		out.Del(k)
	}
	return out
}

// GetWorkOrderFacets returns dashboard aggregates computed over the whole
// work_order_summary table rather than the current table page:
//   - projects: project card, filtered by everything except project
//   - vendorProjects: vendor-per-project card, filtered by everything except vendor
//   - with scope=global (and nothing else): latestDate, dropdown options and unfiltered stats
func GetWorkOrderFacets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	result := map[string]interface{}{}

	if q.Get("scope") == "global" {
		if err := addGlobalFacets(result); err != nil {
			http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
		return
	}

	projectWhere, projectArgs, _, _ := workOrderSummaryFiltersFromQuery(withoutFilters(q, "project", "trend_date", "group"))
	projects := []projectFacet{}
	rows, err := db.Query(`
		SELECT COALESCE(project_name, ''), COUNT(*), MAX(COALESCE(created_source_at, ''))
		FROM work_order_summary
		WHERE `+projectWhere+`
		GROUP BY project_name
		ORDER BY 3 DESC
	`, projectArgs...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	for rows.Next() {
		var p projectFacet
		if rows.Scan(&p.Name, &p.Count, &p.LatestDate) == nil && p.Name != "" {
			projects = append(projects, p)
		}
	}
	rows.Close()
	result["projects"] = projects

	vendorWhere, vendorArgs, _, _ := workOrderSummaryFiltersFromQuery(withoutFilters(q, "vendor", "trend_date", "group"))
	rows, err = db.Query(`
		SELECT COALESCE(vendor_name, ''), COALESCE(project_name, ''), wo_id, COALESCE(wo_code, ''),
			COALESCE(created_source_at, ''), COALESCE(total_cost, 0)
		FROM work_order_summary
		WHERE `+vendorWhere, vendorArgs...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	vendorProjects := map[string]*vendorProjectFacet{}
	for rows.Next() {
		var vendor, project, woID, woCode, createdAt string
		var cost float64
		if rows.Scan(&vendor, &project, &woID, &woCode, &createdAt, &cost) != nil {
			continue
		}
		vendor = vendorLabel(vendor)
		key := vendor + "::" + project
		vp := vendorProjects[key]
		if vp == nil {
			vp = &vendorProjectFacet{Key: key, VendorName: vendor, ProjectName: project}
			vendorProjects[key] = vp
		}
		vp.Count++
		vp.Cost += cost
		if id, err := strconv.ParseInt(woID, 10, 64); err == nil && id > vp.LatestWOID {
			vp.LatestWOID = id
			vp.LatestWOCode = woCode
			vp.LatestWODate = createdAt
		}
	}
	rows.Close()
	vpList := make([]vendorProjectFacet, 0, len(vendorProjects))
	for _, vp := range vendorProjects {
		vpList = append(vpList, *vp)
	}
	sort.Slice(vpList, func(i, j int) bool { return vpList[i].LatestWOID > vpList[j].LatestWOID })
	result["vendorProjects"] = vpList

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// addGlobalFacets aggregates in SQL so only small result sets leave the database.
func addGlobalFacets(result map[string]interface{}) error {
	var latestDate string
	_ = db.QueryRow("SELECT COALESCE(MAX(latest_date), '') FROM work_order_summary WHERE latest_date <> ''").Scan(&latestDate)
	result["latestDate"] = latestDate

	// Latest approval day in the daily ledger, so the UI can explain an empty
	// trend range (stored details may be older than the latest WO activity).
	var latestApproval string
	_ = db.QueryRow("SELECT COALESCE(MAX(cost_date), '') FROM work_order_daily_costs").Scan(&latestApproval)
	result["latestApprovalDate"] = latestApproval

	// Projects: newest first for the dropdown, plus the year used by projectYearsStats.
	rows, err := db.Query(`
		SELECT project_name, MAX(COALESCE(jo_code, '')), MAX(COALESCE(created_source_at, ''))
		FROM work_order_summary
		WHERE COALESCE(project_name, '') <> ''
		GROUP BY project_name
		ORDER BY 3 DESC, 1
	`)
	if err != nil {
		return err
	}
	projectOptions := []string{}
	projectYearsStats := map[string]int{}
	projectYearList := map[string][]string{}
	for rows.Next() {
		var name, joCode, createdAt string
		if rows.Scan(&name, &joCode, &createdAt) != nil {
			continue
		}
		projectOptions = append(projectOptions, name)
		year := "Unknown"
		if m := joYearPattern.FindStringSubmatch(joCode); m != nil {
			year = m[1]
		} else if len(createdAt) >= 4 {
			year = createdAt[:4]
		}
		projectYearsStats[year]++
		projectYearList[year] = append(projectYearList[year], name)
	}
	rows.Close()

	rows, err = db.Query(`SELECT DISTINCT COALESCE(vendor_name, '') FROM work_order_summary`)
	if err != nil {
		return err
	}
	vendorOptions := []string{}
	totalVendors := 0
	for rows.Next() {
		var name string
		if rows.Scan(&name) != nil {
			continue
		}
		if name != "" {
			totalVendors++
		}
		vendorOptions = append(vendorOptions, vendorLabel(name))
	}
	rows.Close()
	sort.Strings(vendorOptions)

	var totalWOs, totalJOs int
	var sumTotal, sumSebelumnya, sumSaatIni, sumPending float64
	err = db.QueryRow(`
		SELECT COUNT(*),
			COUNT(DISTINCT CASE WHEN COALESCE(jo_code, '') NOT IN ('', 'N/A') THEN jo_code END),
			COALESCE(SUM(total_cost), 0), COALESCE(SUM(previous_cost), 0),
			COALESCE(SUM(latest_cost), 0), COALESCE(SUM(pending_cost), 0)
		FROM work_order_summary
	`).Scan(&totalWOs, &totalJOs, &sumTotal, &sumSebelumnya, &sumSaatIni, &sumPending)
	if err != nil {
		return err
	}

	approvalCounts := map[string]int{
		"Waiting":          0,
		"Approval Level 1": 0,
		"Approval Level 2": 0,
		"Approval Level 3": 0,
		"Approval Level 4": 0,
		"Approval Level 5": 0,
	}
	rows, err = db.Query(`SELECT COALESCE(derived_status, ''), COUNT(*) FROM work_order_summary GROUP BY 1`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var status string
		var count int
		if rows.Scan(&status, &count) == nil {
			approvalCounts[status] += count
		}
	}
	rows.Close()

	projectTypeCounts := map[string]int{"internal": 0, "external": 0}
	if rows, err := db.Query(`SELECT CASE WHEN project_type = 'internal' THEN 'internal' ELSE 'external' END, COUNT(*) FROM work_order_summary GROUP BY 1`); err == nil {
		for rows.Next() {
			var t string
			var n int
			if rows.Scan(&t, &n) == nil {
				projectTypeCounts[t] = n
			}
		}
		rows.Close()
	}
	result["projectTypeCounts"] = projectTypeCounts

	result["projectOptions"] = projectOptions
	result["vendorOptions"] = vendorOptions
	result["globalStats"] = map[string]interface{}{
		"totalWOs":          totalWOs,
		"totalJOs":          totalJOs,
		"totalVendors":      totalVendors,
		"totalProjects":     len(projectOptions),
		"totalCostValue":    sumSaatIni,
		"sumTotal":          sumTotal,
		"sumSebelumnya":     sumSebelumnya,
		"sumSaatIni":        sumSaatIni,
		"sumPending":        sumPending,
		"approvalCounts":    approvalCounts,
		"projectYearsStats": projectYearsStats,
		"projectYearList":   projectYearList,
	}
	return nil
}
