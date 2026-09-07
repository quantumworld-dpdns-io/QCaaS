package secrets

import (
	"bytes"
	"testing"
)

func TestEncryptDecrypt(t *testing.T) {
	key := bytes.Repeat([]byte("k"), 32)
	ct, err := Encrypt(key, []byte("qc_key"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(ct, []byte("qc_key")) {
		t.Fatal("ciphertext leaks plaintext")
	}
	pt, err := Decrypt(key, ct)
	if err != nil || string(pt) != "qc_key" {
		t.Fatalf("decrypt: %v %q", err, pt)
	}
	ct2, _ := Encrypt(key, []byte("qc_key"))
	if bytes.Equal(ct, ct2) {
		t.Fatal("nonce reuse: identical ciphertexts")
	}
	if _, err := Decrypt(bytes.Repeat([]byte("x"), 32), ct); err == nil {
		t.Fatal("decrypt with wrong key succeeded")
	}
	ct[len(ct)-1] ^= 0xff
	if _, err := Decrypt(key, ct); err == nil {
		t.Fatal("tampered ciphertext accepted")
	}
	if _, err := Decrypt(key, []byte("short")); err == nil {
		t.Fatal("short ciphertext accepted")
	}
	if _, err := Encrypt([]byte("bad"), []byte("x")); err == nil {
		t.Fatal("bad key length accepted")
	}
}
