package itemparse

import (
	"testing"
)

// Real SIAGA descriptions checked by hand during the trial (Nov 2026).
func TestParseGeneral(t *testing.T) {
	cases := []struct {
		label, rules, work, size, qty, source string
	}{
		{`Ganti baru packing , bahan karet dia. 2" x 3 mm, jumlah 4 unit (supply dock)`,
			RulesGeneral, "Ganti baru packing karet", `Ø 2" x 3 mm`, "4 unit", "supply dock"},
		{`Ganti baru mur dan baut steel uk. 5/8" x 2", 16 pcs  (supply dock)`,
			RulesGeneral, "Ganti baru mur & baut steel", `5/8" x 2"`, "16 pcs", "supply dock"},
		// 2.5" and 2 1/2" are the same size.
		{`Ganti baru mur dan baut steel uk. 5/8"x2.5", 56 pcs (supply dock)`,
			RulesGeneral, "Ganti baru mur & baut steel", `5/8" x 2 1/2"`, "56 pcs", "supply dock"},
		{`Dilaksanakan press test gate valve uk. 6"- 10k, 2 unit  (material lama)`,
			RulesGeneral, "Press test gate valve", `6" 10K`, "2 unit", "material lama"},
		{`Bongkar pasang dan perawatan gate valve uk. 5K-65, 1 unit  (material lama)`,
			RulesGeneral, "Bongkar pasang & perawatan gate valve", "5K-65", "1 unit", "material lama"},
		// What a label says first is the main work: bolts, not the press test.
		{`Bongkar dan pasang mur dan baut valve seachest induk kanan dan kiri steel uk. 5/8"x2,5", 16 pcs Asistensi press test valve`,
			RulesGeneral, "Bongkar pasang mur & baut steel", `5/8" x 2 1/2"`, "16 pcs", ""},
		{`Ganti baru u-bolt dia. 1", 1 pcs (supply dock)`,
			RulesGeneral, "Ganti baru u-bolt", `Ø 1"`, "1 pcs", "supply dock"},
		{`cover pipa 2,5", 1 unit -`, RulesGeneral, "Wrapping / cover pipa", `Ø 2 1/2"`, "1 unit", ""},
		{`Dikerjakan hari kamis, 15/05/2025,(17:00-21:00) sebanyak 3 orang (fit up dan welding pipa 2")`,
			RulesGeneral, "Lembur (tenaga harian) tenaga kerja", "", "3 orang", ""},
		// Typo "rennew" is renew.
		{`rennew kabel grounding, 6 unit`, RulesGeneral, "Ganti baru kabel", "", "6 unit", ""},
		{`Bongkar dan pasang 5k50, 1 unit (material lama)`, RulesGeneral, "Bongkar pasang valve (lain)", "5K-50", "1 unit", "material lama"},
	}
	for _, c := range cases {
		p := Parse(c.label)
		if p.Rules != c.rules || p.WorkType != c.work || p.Size != c.size || p.Qty != c.qty || p.Source != c.source || !p.Recognized {
			t.Errorf("%q\n  got  rules=%q work=%q size=%q qty=%q source=%q recognized=%v\n  want rules=%q work=%q size=%q qty=%q source=%q",
				c.label, p.Rules, p.WorkType, p.Size, p.Qty, p.Source, p.Recognized, c.rules, c.work, c.size, c.qty, c.source)
		}
	}
}

func TestParsePipe(t *testing.T) {
	p := Parse(`Ganti baru pipa seamless sch. 40, Dia. 3", 1780 mm (material lama) Elbow, 3 unit (material lama) Flange, 2 unit (material lama)`)
	if p.WorkType != "Ganti baru pipa seamless" || p.Size != `Ø 3" sch 40` {
		t.Fatalf("work=%q size=%q", p.WorkType, p.Size)
	}
	if p.PipeMM == nil || *p.PipeMM != 1780 || p.Elbows == nil || *p.Elbows != 3 || p.Flanges == nil || *p.Flanges != 2 {
		t.Errorf("pipe details: %v %v %v", deref(p.PipeMM), derefInt(p.Elbows), derefInt(p.Flanges))
	}
	// Lengths written as a sum.
	p = Parse(`Ganti baru pipa sch. 40, dia. 1 1/2", uk. 100 mm + 200 mm + 300 mm, jumlah 1 unit, (supply dock)`)
	if p.PipeMM == nil || *p.PipeMM != 600 {
		t.Errorf("summed length = %v", deref(p.PipeMM))
	}
	// Plate dimensions are not a pipe length (and choose the hull rules).
	p = Parse(`Pasang Di pipa vent FO 3 [ P ] , Uk. 320 mm x 320 mm x 8 mm x 1 lbr = 6.43 Kg, (Plat untuk spil)`)
	if p.PipeMM != nil || p.Rules != RulesHull || p.Size != "plat 8 mm" {
		t.Errorf("plate on a pipe: rules=%q size=%q length=%v", p.Rules, p.Size, deref(p.PipeMM))
	}
}

func TestParseHull(t *testing.T) {
	cases := []struct {
		label, work, size, frame, side string
		weight                         float64
	}{
		{`Replating bilge kanan  , Fr. 0 -1/2 <br> Uk. 2000 mm x 820 mm x 12 mm x 1 lbr = 154.49 Kg, (supply dock)`,
			"Replating bilga", "plat 12 mm", "0-1/2", "kanan", 154.49},
		{`Replating side board kanan belakang  , Fr. 15/16-19/20 <br> Uk. 3400 mm x 910 mm x 8 mm x 1 lbr = 194.30 Kg, (supply dock)`,
			"Replating sideboard / lambung", "plat 8 mm", "15/16-19/20", "kanan", 194.30},
		{`Replating siku sideboard haluan kanan no 4 Uk. (100 + 100) mm x 2420 mm x 10 mm x 1 batang = 37.99 Kg`,
			"Replating siku", "L 100x100x10 mm", "", "kanan", 37.99},
		// Trapezoid plate: thickness is the last "x .. mm" before the weight.
		{`Replating bracket stoper jangkar Uk. ((550 + 80)/2) mm x 550 mm x 10 mm = 27.20 kg, jumlah 2 unit (supply dock)`,
			"Replating bracket", "plat 10 mm", "", "", 27.20},
		// No hull part named: plate work on the hull.
		{`Replating , Uk. 700 mm x 100 mm x 10 mm x 1 lbr = 5.50 Kg,`, "Replating plat (lain)", "plat 10 mm", "", "", 5.50},
		// No verb: still plate work.
		{`Doubling plat uk. 300 mm x 300 mm x 10 mm x 1 lbr = 7.07 Kg`, "Pekerjaan plat (tanpa kata kerja) doubling", "plat 10 mm", "", "", 7.07},
		{`Angkat dan geser plat, 4944.58 kg ()`, "Angkat & geser plat", "", "", "", 0},
	}
	for _, c := range cases {
		p := Parse(c.label)
		w := 0.0
		if p.WeightKg != nil {
			w = *p.WeightKg
		}
		if p.Rules != RulesHull || p.WorkType != c.work || p.Size != c.size || p.Frame != c.frame || p.Side != c.side || w != c.weight {
			t.Errorf("%q\n  got  rules=%q work=%q size=%q frame=%q side=%q weight=%v\n  want work=%q size=%q frame=%q side=%q weight=%v",
				c.label, p.Rules, p.WorkType, p.Size, p.Frame, p.Side, w, c.work, c.size, c.frame, c.side, c.weight)
		}
	}
	// "Bongkar ganti baru" without "dan" is still the replace work; abbreviations.
	if p := Parse(`Bongkar ganti baru handle small hatch km' mesin as dia 19mm x 150mm, 1 unit replating`); p.Action != "Bongkar & ganti baru" {
		t.Errorf("bongkar ganti baru: %q", p.Action)
	}
	if p := Parse(`G/B plat stoper lengan dewi2 atas, 3 unit -Uk 150 x 400 x 10mm x 3bh`); p.Action != "Ganti baru" {
		t.Errorf("g/b: %q (%q)", p.Action, p.WorkType)
	}
}

func TestUnrecognized(t *testing.T) {
	p := Parse(`Ultrasonic`)
	if p.Rules != RulesGeneral || p.Recognized {
		t.Errorf("nothing to recognize: %+v", p)
	}
	if p := Parse(""); p.Recognized || p.WorkType != "" {
		t.Errorf("empty label: %+v", p)
	}
}

func TestClean(t *testing.T) {
	got := Clean(`Ganti baru <span>packing</span>&nbsp;dia. ¾” x 3 mm, Ø 2'' ×`)
	if got != `Ganti baru packing dia. 3/4" x 3 mm, dia. 2" x` {
		t.Errorf("Clean = %q", got)
	}
}

func BenchmarkParse(b *testing.B) {
	labels := []string{
		`Ganti baru packing , bahan karet dia. 2" x 3 mm, jumlah 4 unit (supply dock)`,
		`Replating bilge kanan  , Fr. 0 -1/2 <br> Uk. 2000 mm x 820 mm x 12 mm x 1 lbr = 154.49 Kg, (supply dock)`,
		`Ganti baru pipa seamless sch. 40, Dia. 3", 1780 mm (material lama) Elbow, 3 unit (material lama)`,
		`Dikerjakan hari kamis, 15/05/2025,(17:00-21:00) sebanyak 3 orang`,
	}
	for i := 0; i < b.N; i++ {
		Parse(labels[i%len(labels)])
	}
}

func deref(f *float64) interface{} {
	if f == nil {
		return nil
	}
	return *f
}

func derefInt(n *int) interface{} {
	if n == nil {
		return nil
	}
	return *n
}
