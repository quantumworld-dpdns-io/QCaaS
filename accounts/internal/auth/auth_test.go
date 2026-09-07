package auth

import (
	"testing"
	"time"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	h, err := HashPassword("correct horse", 4)
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(h, "correct horse") {
		t.Fatal("valid password rejected")
	}
	if CheckPassword(h, "wrong") {
		t.Fatal("wrong password accepted")
	}
}

func TestTokenRoundTripAndTamper(t *testing.T) {
	secret := []byte("s3cret")
	tok, exp, err := IssueToken(secret, "u1", "a@b.io", "admin", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if time.Until(exp) < 59*time.Minute {
		t.Fatalf("unexpected expiry %v", exp)
	}
	c, err := ParseToken(secret, tok)
	if err != nil || c.Subject != "u1" || c.Role != "admin" || c.Email != "a@b.io" {
		t.Fatalf("parse: %v %+v", err, c)
	}
	if _, err := ParseToken([]byte("other"), tok); err == nil {
		t.Fatal("token accepted with wrong secret")
	}
	if _, err := ParseToken(secret, tok+"x"); err == nil {
		t.Fatal("tampered token accepted")
	}
	expired, _, _ := IssueToken(secret, "u1", "a@b.io", "admin", -time.Minute)
	if _, err := ParseToken(secret, expired); err == nil {
		t.Fatal("expired token accepted")
	}
}
