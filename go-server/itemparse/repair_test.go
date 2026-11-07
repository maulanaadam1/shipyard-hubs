package itemparse

import "testing"

// Shapes of SIAGA repair list lines (Nov 2026): the work is often named by the
// groups, not the line.
func TestParseRepair(t *testing.T) {
	cases := []struct {
		name, desc, unit string
		qty              float64
		groups           []string
		work, component  string
		fromGroup        bool
	}{
		{"line names the work", "Ganti baru pipa 2\" seamless", "m", 6, []string{"Perpipaan"}, "Ganti baru pipa seamless", "", false},
		{"jasa line takes its group's work", "jasa", "m2", 65, []string{"Bangunan Atas", "Tiang Navigasi", "Lakukan pengecatan 2 layer"},
			"Pengecatan tiang / mast", ComponentService, true},
		{"material line by brand", "Jotafix PU Warna Putih / material", "Ltr", 30, []string{"Bangunan Atas", "Tiang Navigasi", "Lakukan pengecatan 2 layer"},
			"Pengecatan tiang / mast", ComponentMaterial, true},
		{"action only, object from the group", "a. Lakukan pengecatan 2 layer", "m2", 50, []string{"Fly Bridge", "Dinding luar wheel house"},
			"Pengecatan dinding", "", true},
		{"surface preparation word", "a. Lakukan Amplashing", "m2", 65, []string{"Lambung"}, "Persiapan permukaan (per m2)", "", false},
		{"surface preparation on a named part", "Lakukan power tooling", "m2", 5, []string{"Bulwark", "Dinding luar"}, "Persiapan permukaan dinding", "", true},
		{"surface work on an area with no part named", "Lakukan pengecatan 2 layer", "m2", 120, nil, "Pengecatan permukaan (per m2)", "", false},
		{"docking line", "Docking", "ls", 1, []string{"Pelayanan Umum"}, "Biaya / jasa docking & undocking", "", false},
		{"new building package", "Barge 300 feet - S0999", "unit", 1, nil, "Paket pembangunan kapal baru", "", false},
		{"new building contract", "Pembangunan 1 unit kapal baru tug boat 2 x 1000 HP", "unit", 1, nil, "Paket pembangunan kapal baru", "", false},
	}
	for _, c := range cases {
		p := ParseRepair(c.desc, c.unit, c.qty, c.groups)
		if !p.Recognized || p.WorkType != c.work || p.Component != c.component || p.FromActivity != c.fromGroup {
			t.Errorf("%s: %q -> work %q, component %q, from group %v, recognized %v; want %q, %q, %v",
				c.name, c.desc, p.WorkType, p.Component, p.FromActivity, p.Recognized, c.work, c.component, c.fromGroup)
		}
	}
	// A cost heading is never the work of the lines under it.
	if p := ParseRepair("jasa", "ls", 1, []string{"Labour cost"}); p.Recognized {
		t.Errorf("jasa under a cost heading: %+v", p)
	}
}
