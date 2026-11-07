package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"shipyard/db"
	"shipyard/itemparse"
)

// ResourceMarketingPriceReference is the RBAC resource of the Harga Acuan
// Marketing menu: reference unit prices offered to customers, from the repair
// lists, per work type, size, unit and part (jasa / material). The menu is
// about customer prices, so its own permission is enough to see them.
const ResourceMarketingPriceReference = "Harga Acuan Marketing"

// marketingPrice is one priced repair list activity.
type marketingPrice struct {
	workType, size, unit, component string
	joID, joCode, ship, customer    string
	service, start                  string
	activity, group                 string
	qty, price                      float64
}

// marketingUnit groups spellings of a unit ("M2", "m²" and "m2").
func marketingUnit(u string) string {
	u = unitKey(u)
	switch u {
	case "m²", "meter persegi", "mtr2", "m^2":
		return "m2"
	case "ltr", "liter", "lt":
		return "ltr"
	case "pcs", "pc", "bh", "buah":
		return "pcs"
	}
	return u
}

// marketingPrices reads the priced activities with a recognized work type,
// filtered by months (by the Job Order's planned start; 0 = all), service,
// customer and component. Whole-vessel packages are left out: they have no
// unit price to compare.
func marketingPrices(r *http.Request) ([]marketingPrice, error) {
	q := r.URL.Query()
	where := " AND COALESCE(i.recognized, false) AND COALESCE(i.unit_price, 0) > 0 AND COALESCE(i.rules, '') <> ? AND COALESCE(i.work_type, '') <> ''"
	args := []interface{}{itemparse.RulesPackage}
	months, err := strconv.Atoi(q.Get("months"))
	if err != nil {
		months = 24
	}
	if months > 0 {
		where += " AND COALESCE(jo.est_start, '') >= ?"
		args = append(args, time.Now().AddDate(0, -months, 0).Format("2006-01-02"))
	}
	if s := q.Get("service"); s != "" {
		where += " AND COALESCE(jo.service, '') = ?"
		args = append(args, s)
	}
	if c := q.Get("customer"); c != "" {
		where += " AND COALESCE(jo.customer, '') = ?"
		args = append(args, c)
	}
	switch q.Get("component") {
	case "jasa", "material":
		where += " AND COALESCE(i.component, '') = ?"
		args = append(args, q.Get("component"))
	case "none":
		where += " AND COALESCE(i.component, '') = ''"
	}
	rows, err := db.Query(strings.Replace(repairItemsBase, "%s", `COALESCE(i.work_type, ''), COALESCE(i.size, ''), COALESCE(i.unit, ''),
		COALESCE(i.component, ''), i.jo_id, COALESCE(jo.code, ''), COALESCE(jo.ship, ''), COALESCE(jo.customer, ''), COALESCE(jo.service, ''),
		COALESCE(jo.est_start, ''), COALESCE(i.description, ''), COALESCE(i.full_name, ''), COALESCE(i.quantity, 0), COALESCE(i.unit_price, 0)`, 1)+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []marketingPrice
	for rows.Next() {
		var p marketingPrice
		var full string
		if rows.Scan(&p.workType, &p.size, &p.unit, &p.component, &p.joID, &p.joCode, &p.ship, &p.customer, &p.service, &p.start,
			&p.activity, &full, &p.qty, &p.price) != nil {
			continue
		}
		p.unit = marketingUnit(p.unit)
		p.group = repairItemGroup(full)
		out = append(out, p)
	}
	return out, rows.Err()
}

type marketingReference struct {
	WorkType  string  `json:"work_type"`
	Size      string  `json:"size"`
	Unit      string  `json:"unit"`
	Component string  `json:"component"`
	N         int     `json:"n"`
	JobOrders int     `json:"job_orders"`
	P25       float64 `json:"p25"`
	Median    float64 `json:"median"`
	P75       float64 `json:"p75"`
	Min       float64 `json:"min"`
	Max       float64 `json:"max"`
	DateFrom  string  `json:"date_from"`
	DateTo    string  `json:"date_to"`
	Last      float64 `json:"last_price"`
	LastJO    string  `json:"last_job_order"`
}

func marketingKey(p marketingPrice) string {
	return p.workType + "\x00" + p.size + "\x00" + p.unit + "\x00" + p.component
}

// summarizeMarketing turns a group's prices into its reference.
func summarizeMarketing(list []marketingPrice) marketingReference {
	prices := make([]float64, len(list))
	jos := map[string]bool{}
	ref := marketingReference{WorkType: list[0].workType, Size: list[0].size, Unit: list[0].unit, Component: list[0].component, N: len(list)}
	for i, p := range list {
		prices[i] = p.price
		jos[p.joID] = true
		if p.start != "" && (ref.DateFrom == "" || p.start < ref.DateFrom) {
			ref.DateFrom = p.start
		}
		if p.start >= ref.DateTo {
			ref.DateTo, ref.Last, ref.LastJO = p.start, p.price, strings.TrimSpace(p.joCode+" "+p.ship)
		}
	}
	sort.Float64s(prices)
	ref.JobOrders = len(jos)
	ref.P25, ref.Median, ref.P75 = quantile(prices, 0.25), quantile(prices, 0.5), quantile(prices, 0.75)
	ref.Min, ref.Max = prices[0], prices[len(prices)-1]
	return ref
}

// GetMarketingPriceReference lists the reference offer prices. Query: search
// (every word in the work type or size), unit, months (default 24; 0 = all),
// service, customer, component (jasa, material, none), min_n, sort (n,
// job_orders, median, work_type), dir, page, limit.
func GetMarketingPriceReference(w http.ResponseWriter, r *http.Request) {
	prices, err := marketingPrices(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	q := r.URL.Query()
	groups := map[string][]marketingPrice{}
	unitCount := map[string]int{}
	for _, p := range prices {
		groups[marketingKey(p)] = append(groups[marketingKey(p)], p)
	}
	words := strings.Fields(strings.ToLower(q.Get("search")))
	unit := marketingUnit(q.Get("unit"))
	minN, _ := strconv.Atoi(q.Get("min_n"))
	refs := []marketingReference{}
	for _, list := range groups {
		ref := summarizeMarketing(list)
		text := strings.ToLower(ref.WorkType + " " + ref.Size)
		ok := true
		for _, w := range words {
			if !strings.Contains(text, w) {
				ok = false
				break
			}
		}
		if !ok || ref.N < minN {
			continue
		}
		unitCount[ref.Unit]++
		if unit != "" && unit != "all" && ref.Unit != unit {
			continue
		}
		refs = append(refs, ref)
	}
	desc := q.Get("dir") != "asc"
	value := func(x marketingReference) float64 {
		switch q.Get("sort") {
		case "median":
			return x.Median
		case "job_orders":
			return float64(x.JobOrders)
		}
		return float64(x.N)
	}
	sort.SliceStable(refs, func(i, j int) bool {
		if q.Get("sort") == "work_type" {
			return strings.ToLower(refs[i].WorkType+" "+refs[i].Size) < strings.ToLower(refs[j].WorkType+" "+refs[j].Size)
		}
		if desc {
			return value(refs[i]) > value(refs[j])
		}
		return value(refs[i]) < value(refs[j])
	})
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 5000 {
		limit = 50
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	total := len(refs)
	from := (page - 1) * limit
	if from > total {
		from = total
	}
	to := from + limit
	if to > total {
		to = total
	}
	units := make([]map[string]interface{}, 0, len(unitCount))
	for u, n := range unitCount {
		units = append(units, map[string]interface{}{"unit": u, "count": n})
	}
	sort.Slice(units, func(i, j int) bool { return units[i]["count"].(int) > units[j]["count"].(int) })
	writeJSON(w, http.StatusOK, map[string]interface{}{"rows": refs[from:to], "total": total, "page": page, "limit": limit,
		"units": units, "prices": len(prices)})
}

// GetMarketingPriceReferenceDetail is one reference's spread: per year, per
// customer and the activities behind it (newest first). Query: work_type,
// size, unit, component plus the list filters.
func GetMarketingPriceReferenceDetail(w http.ResponseWriter, r *http.Request) {
	prices, err := marketingPrices(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	q := r.URL.Query()
	key := q.Get("work_type") + "\x00" + q.Get("size") + "\x00" + marketingUnit(q.Get("unit")) + "\x00" + q.Get("component")
	var list []marketingPrice
	for _, p := range prices {
		if marketingKey(p) == key {
			list = append(list, p)
		}
	}
	if len(list) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "harga acuan tidak ditemukan"})
		return
	}
	spread := func(by func(marketingPrice) string, label string) []map[string]interface{} {
		parts := map[string][]float64{}
		for _, p := range list {
			parts[by(p)] = append(parts[by(p)], p.price)
		}
		out := make([]map[string]interface{}, 0, len(parts))
		for k, v := range parts {
			sort.Float64s(v)
			out = append(out, map[string]interface{}{label: k, "n": len(v), "median": quantile(v, 0.5), "min": v[0], "max": v[len(v)-1]})
		}
		return out
	}
	years := spread(func(p marketingPrice) string {
		if len(p.start) >= 4 {
			return p.start[:4]
		}
		return ""
	}, "year")
	sort.Slice(years, func(i, j int) bool { return years[i]["year"].(string) > years[j]["year"].(string) })
	customers := spread(func(p marketingPrice) string { return p.customer }, "customer")
	sort.Slice(customers, func(i, j int) bool { return customers[i]["n"].(int) > customers[j]["n"].(int) })
	sort.SliceStable(list, func(i, j int) bool { return list[i].start > list[j].start })
	items := []map[string]interface{}{}
	for i, p := range list {
		if i >= 200 {
			break
		}
		items = append(items, map[string]interface{}{"jo_id": p.joID, "jo_code": p.joCode, "ship": p.ship, "customer": p.customer,
			"service": p.service, "est_start": p.start, "activity": p.activity, "group": p.group, "quantity": p.qty, "unit_price": p.price})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"reference": summarizeMarketing(list), "years": years, "customers": customers, "items": items})
}

// aiMarketingPriceTool gives the AI Assistant the Harga Acuan Marketing data.
func aiMarketingPriceTool() aiTool {
	return aiTool{
		Name: "marketing_price_reference",
		Description: "Reference unit prices OFFERED TO CUSTOMERS (harga penawaran / harga marketing), from the Job Orders' repair lists, " +
			"per work type, size, unit and part (whole job, jasa or material): median, fair range p25-p75, min-max, number of prices and " +
			"Job Orders, latest price. Call this when the user asks what price is usually offered or quoted to customers for some work, " +
			"e.g. \"harga penawaran sandblasting per m2 biasanya berapa\". This is not vendor cost: for vendor prices use price_reference " +
			"(Harga Acuan Jasa). Default period: Job Orders planned to start in the last 24 months.",
		Schema: aiSchema(map[string]interface{}{
			"search":   aiString("Words in the work type or size, e.g. \"sandblasting\", \"ganti baru plat\", \"pipa 2\"."),
			"unit":     aiString("Only this unit, e.g. \"m2\", \"kg\", \"ltr\", \"pcs\", \"m\"."),
			"part":     aiString("Only whole jobs (none), jasa lines or material lines.", "none", "jasa", "material"),
			"months":   aiInteger("Period in months by the Job Order's planned start (default 24; 0 = all).", 0, 120),
			"job_type": aiString("Only Job Orders of this type, e.g. \"DOCKING REPAIR\"."),
			"customer": aiString("Only this customer (exact name)."),
			"limit":    aiInteger("How many references to return (default 10).", 1, 50),
		}),
		Resource: ResourceMarketingPriceReference,
		Run: func(r *http.Request, input json.RawMessage) (interface{}, error) {
			var in struct {
				Search   string `json:"search"`
				Unit     string `json:"unit"`
				Part     string `json:"part"`
				Months   *int   `json:"months"`
				JobType  string `json:"job_type"`
				Customer string `json:"customer"`
				Limit    int    `json:"limit"`
			}
			if err := decodeAIInput(input, &in); err != nil {
				return nil, err
			}
			if err := oneOf("part", in.Part, "none", "jasa", "material"); err != nil {
				return nil, err
			}
			q := url.Values{"limit": {strconv.Itoa(limitOr(in.Limit, 10, 50))}}
			setIf(q, "search", in.Search)
			setIf(q, "unit", in.Unit)
			setIf(q, "component", in.Part)
			setIf(q, "service", in.JobType)
			setIf(q, "customer", in.Customer)
			if in.Months != nil {
				q.Set("months", strconv.Itoa(*in.Months))
			}
			res, err := aiCall(GetMarketingPriceReference, r, "/api/marketing-price-reference", q)
			if err != nil {
				return nil, err
			}
			delete(res, "units")
			if rows, _ := res["rows"].([]interface{}); len(rows) == 0 {
				res["note"] = "Tidak ada harga acuan marketing yang cocok; coba kata lain, satuan lain, atau months: 0 (semua periode)."
			}
			return res, nil
		},
	}
}
