package db

import "testing"

func TestStrongAdminPassword(t *testing.T) {
	for _, weak := range []string{"", "admin", "admin123", "ADMIN123", "password", "short"} {
		if strongAdminPassword(weak) {
			t.Errorf("%q should be rejected", weak)
		}
	}
	if !strongAdminPassword("a-much-longer-passphrase") {
		t.Error("long passphrase should be accepted")
	}
	if p := randomPassword(); !strongAdminPassword(p) {
		t.Errorf("generated password %q is not strong", p)
	}
	if randomPassword() == randomPassword() {
		t.Error("generated passwords must differ")
	}
}
