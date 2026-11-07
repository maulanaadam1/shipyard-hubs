package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

// aiRepairListTool reads the Repair List menu's data: every Job Order with
// its repair list state, and one Job Order's activities with their WOs.
func aiRepairListTool() aiTool {
	return aiTool{
		Name: "repair_list",
		Description: "The repair list of each Job Order from SIAGA: the customer's scope of work (activities with qty, unit and, with " +
			"Harga Penawaran, price) and the WOs that carry each activity. Version 1 is the main list; version 2 and up are additional " +
			"repair lists (tambahan), not revisions. Call this when the user asks what a Job Order's repair list contains, which " +
			"activities have or don't have a WO yet (belum di-WO-kan), the value not yet in a WO, additional repair lists, or whether " +
			"a Job Order's repair list has been fetched. Without jo_id it lists Job Orders matching query (every Job Order of the Job " +
			"Order menu, also those without a WO) with state: ok (fetched), pending (not fetched yet), none (no repair list in SIAGA), " +
			"failed. With jo_id, or when query matches one Job Order, it returns that Job Order's totals per version and its " +
			"activities, filtered by wo, version and activity. For margin and vendor cost use job_order_margin.",
		Schema: aiSchema(map[string]interface{}{
			"query":     aiString("Words in the Job Order code, ship or customer, e.g. \"BARAKUDA\" or \"DRG26DKP045\"."),
			"jo_id":     aiString("jo_id of one Job Order from a list result, for its activities."),
			"wo":        aiString("Activities only with a WO (with) or without one yet (without).", "with", "without"),
			"version":   aiInteger("Only this repair list version: 1 = main, 2 and up = additional.", 1, 50),
			"activity":  aiString("Words in the activity, its group or its work type, e.g. \"sandblasting\" or \"propeller\"."),
			"work_type": aiString("Words in the work type (jenis pekerjaan, as in Item Repair List), e.g. \"pengecatan\" or \"ganti baru plat\"."),
			"state":     aiString("List only Job Orders in this state.", "ok", "pending", "none", "failed"),
			"sort":      aiString("List order (default price, highest first; without_wo = most value without a WO).", "price", "without_wo", "progress"),
			"limit":     aiInteger("How many Job Orders (default 10) or activities (default 40) to return.", 1, 150),
		}),
		Resource: ResourceRepairList,
		Run:      runRepairList,
	}
}

type repairListInput struct {
	Query    string `json:"query"`
	JOID     string `json:"jo_id"`
	WO       string `json:"wo"`
	Version  int    `json:"version"`
	Activity string `json:"activity"`
	WorkType string `json:"work_type"`
	State    string `json:"state"`
	Sort     string `json:"sort"`
	Limit    int    `json:"limit"`
}

func runRepairList(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in repairListInput
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	for field, value := range map[string]string{"wo": in.WO, "state": in.State, "sort": in.Sort} {
		allowed := map[string][]string{"wo": {"with", "without"}, "state": {"ok", "pending", "none", "failed"}, "sort": {"price", "without_wo", "progress"}}[field]
		if err := oneOf(field, value, allowed...); err != nil {
			return nil, err
		}
	}
	if in.JOID != "" {
		return aiRepairListDetail(r, in.JOID, in)
	}
	res, err := aiCall(GetRepairLists, r, "/api/repair-lists", url.Values{})
	if err != nil {
		return nil, err
	}
	all, _ := res["job_orders"].([]interface{})
	q := strings.ToLower(strings.TrimSpace(in.Query))
	states := map[string]int{}
	var matched []map[string]interface{}
	for _, v := range all {
		jo, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		state, _ := jo["state"].(string)
		states[state]++
		if q != "" && !aiWordsIn(q, aiDataText(jo["jo_code"])+" "+aiDataText(jo["ship"])+" "+aiDataText(jo["customer"])) {
			continue
		}
		if in.State != "" && state != in.State {
			continue
		}
		matched = append(matched, jo)
	}
	if len(matched) == 1 {
		return aiRepairListDetail(r, aiDataText(matched[0]["jo_id"]), in)
	}
	num := func(jo map[string]interface{}, k string) float64 { f, _ := jo[k].(float64); return f }
	key := func(jo map[string]interface{}) float64 {
		switch in.Sort {
		case "without_wo":
			if _, priced := jo["total_price"]; priced {
				return num(jo, "total_price") - num(jo, "price_in_wo")
			}
			return num(jo, "items") - num(jo, "items_in_wo")
		case "progress":
			if num(jo, "items") == 0 {
				return 2 // nothing to do: last
			}
			return num(jo, "items_in_wo") / num(jo, "items")
		}
		if _, priced := jo["total_price"]; priced {
			return num(jo, "total_price")
		}
		return num(jo, "items")
	}
	sort.SliceStable(matched, func(i, j int) bool {
		if in.Sort == "progress" {
			return key(matched[i]) < key(matched[j])
		}
		return key(matched[i]) > key(matched[j])
	})
	limit := limitOr(in.Limit, 10, 50)
	out := []map[string]interface{}{}
	for i, jo := range matched {
		if i >= limit {
			break
		}
		row := map[string]interface{}{"jo_id": jo["jo_id"], "jo_code": jo["jo_code"], "ship": jo["ship"], "customer": jo["customer"],
			"job_type": jo["service"], "state": jo["state"]}
		if jo["state"] == "ok" {
			row["versions"], row["activities"], row["activities_with_wo"] = jo["version"], jo["items"], jo["items_in_wo"]
			if p, ok := jo["total_price"]; ok {
				row["total_price"], row["price_with_wo"], row["price_without_wo"] = p, jo["price_in_wo"], num(jo, "total_price")-num(jo, "price_in_wo")
			}
		}
		out = append(out, row)
	}
	result := map[string]interface{}{"job_orders": out, "matched": len(matched), "all_job_orders_by_state": states,
		"show_price": res["show_price"]}
	if len(matched) == 0 {
		result["note"] = "Tidak ada Job Order yang cocok; coba kata lain dari kode Job Order, nama kapal atau customer."
	}
	return result, nil
}

// aiRepairListDetail is one Job Order's repair list for the model: totals per
// version and the activities (leaves) that match the filters, each with its
// group so short names like "jasa" keep their meaning.
func aiRepairListDetail(r *http.Request, joID string, in repairListInput) (interface{}, error) {
	// GetRepairList reads the Job Order from its route parameter.
	withID := func(w http.ResponseWriter, req *http.Request) {
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", joID)
		GetRepairList(w, req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx)))
	}
	res, err := aiCall(withID, r, "/api/repair-lists/"+url.PathEscape(joID), url.Values{})
	if err != nil {
		return nil, err
	}
	summary, _ := res["summary"].(map[string]interface{})
	showPrice, _ := res["show_price"].(bool)
	items, _ := res["items"].([]interface{})

	type node struct {
		desc, parent string
		version      int
	}
	nodes := map[string]node{}
	var leaves []map[string]interface{}
	for _, v := range items {
		it, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		uniq, parent := aiDataText(it["uniqcode"]), aiDataText(it["parent"])
		n := node{desc: aiDataText(it["description"]), parent: parent, version: 1}
		if strings.HasPrefix(uniq, "version-") && parent == "" {
			n.version, _ = strconv.Atoi(strings.TrimPrefix(uniq, "version-"))
		} else if p, ok := nodes[parent]; ok {
			n.version = p.version
		}
		nodes[uniq] = n
		if leaf, _ := it["leaf"].(bool); leaf {
			leaves = append(leaves, it)
		}
	}
	group := func(parent string) string {
		var names []string
		for p := parent; p != ""; p = nodes[p].parent {
			if strings.HasPrefix(p, "version-") {
				break
			}
			names = append([]string{nodes[p].desc}, names...)
		}
		if len(names) > 3 {
			names = names[len(names)-3:]
		}
		return strings.Join(names, " > ")
	}

	type versionTotal struct {
		Version          int     `json:"version"`
		Activities       int     `json:"activities"`
		ActivitiesWithWO int     `json:"activities_with_wo"`
		TotalPrice       float64 `json:"total_price,omitempty"`
		PriceWithoutWO   float64 `json:"price_without_wo,omitempty"`
	}
	perVersion := map[int]*versionTotal{}
	words := strings.ToLower(strings.TrimSpace(in.Activity))
	workWords := strings.ToLower(strings.TrimSpace(in.WorkType))
	var picked []map[string]interface{}
	matchedTotal, matchedCount := 0.0, 0
	for _, it := range leaves {
		n := nodes[aiDataText(it["uniqcode"])]
		wos, _ := it["wos"].([]interface{})
		price, _ := it["total_price"].(float64)
		vt := perVersion[n.version]
		if vt == nil {
			vt = &versionTotal{Version: n.version}
			perVersion[n.version] = vt
		}
		vt.Activities++
		vt.TotalPrice += price
		if len(wos) > 0 {
			vt.ActivitiesWithWO++
		} else {
			vt.PriceWithoutWO += price
		}

		if in.Version > 0 && n.version != in.Version {
			continue
		}
		if (in.WO == "with" && len(wos) == 0) || (in.WO == "without" && len(wos) > 0) {
			continue
		}
		g := group(n.parent)
		work := aiDataText(it["work_type"])
		if words != "" && !aiWordsIn(words, n.desc+" "+g+" "+work) {
			continue
		}
		if workWords != "" && !aiWordsIn(workWords, work) {
			continue
		}
		matchedCount++
		matchedTotal += price
		row := map[string]interface{}{"no": it["path"], "activity": n.desc, "group": g, "work_type": work, "qty": it["quantity"], "unit": it["unit"], "version": n.version}
		if c := aiDataText(it["component"]); c != "" {
			row["part"] = c
		}
		if showPrice {
			row["unit_price"], row["total_price"] = it["unit_price"], price
		}
		var woNames []string
		for _, w := range wos {
			if m, ok := w.(map[string]interface{}); ok {
				name := aiDataText(m["wo_code"])
				if vendor := aiDataText(m["vendor"]); vendor != "" {
					name += " (" + vendor + ")"
				}
				woNames = append(woNames, name)
			}
		}
		row["wo"] = woNames
		picked = append(picked, row)
	}
	limit := limitOr(in.Limit, 40, 150)
	if len(picked) > limit {
		picked = picked[:limit]
	}
	versions := []*versionTotal{}
	for _, vt := range perVersion {
		if !showPrice {
			vt.TotalPrice, vt.PriceWithoutWO = 0, 0
		}
		versions = append(versions, vt)
	}
	sort.Slice(versions, func(i, j int) bool { return versions[i].Version < versions[j].Version })

	out := map[string]interface{}{"job_order": summary, "versions": versions, "activities": picked,
		"matching_activities": matchedCount, "show_price": showPrice}
	if showPrice {
		out["matching_total_price"] = matchedTotal
	}
	if matchedCount > len(picked) {
		out["note"] = "Daftar aktivitas dipotong; jumlah dan total di matching_* tetap untuk semua yang cocok. Persempit dengan activity atau version."
	}
	switch aiDataText(summary["state"]) {
	case "pending":
		out["note"] = "Repair list Job Order ini belum ditarik dari SIAGA; bisa ditarik dari menu Repair List (Tarik sekarang)."
	case "none":
		out["note"] = "SIAGA tidak punya repair list untuk Job Order ini."
	case "failed":
		out["note"] = "Penarikan repair list terakhir gagal: " + aiDataText(summary["error"])
	}
	return out, nil
}

// aiWordsIn reports whether every word of q appears in text (case-insensitive).
func aiWordsIn(q, text string) bool {
	text = strings.ToLower(text)
	for _, w := range strings.Fields(strings.ToLower(q)) {
		if !strings.Contains(text, w) {
			return false
		}
	}
	return true
}
