package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/qcaas/accounts/internal/config"
	"github.com/qcaas/accounts/internal/qcaas"
	"github.com/qcaas/accounts/internal/store"
)

// fakeQCaaS stands in for the Python API: /internal/customers, /internal/stats and /v2/jobs.
func fakeQCaaS(t *testing.T) (*httptest.Server, *[]string) {
	t.Helper()
	var seenKeys []string
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"status":"ok"}`)) })
	mux.HandleFunc("POST /internal/customers", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Admin-Token") != "admin-token" {
			w.WriteHeader(401)
			return
		}
		w.WriteHeader(201)
		_ = json.NewEncoder(w).Encode(map[string]any{"customer_id": "cust1", "api_key": "qc_secret_key_123", "key_prefix": "qc_secre", "name": "x", "plan": "payg"})
	})
	mux.HandleFunc("PATCH /internal/customers/{id}", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200); _, _ = w.Write([]byte(`{}`)) })
	mux.HandleFunc("GET /internal/stats", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"customers":1}`)) })
	mux.HandleFunc("GET /internal/jobs", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"items":[{"job_id":"j1","customer_id":"cust1"}],"total":1}`))
	})
	mux.HandleFunc("GET /v2/jobs", func(w http.ResponseWriter, r *http.Request) {
		seenKeys = append(seenKeys, r.Header.Get("X-API-Key"))
		if r.Header.Get("Authorization") != "" {
			w.WriteHeader(500)
			return
		}
		_, _ = w.Write([]byte(`{"items":[],"total":0}`))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, &seenKeys
}

func newTestServer(t *testing.T) (*httptest.Server, *[]string) {
	t.Helper()
	up, keys := fakeQCaaS(t)
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	cfg := config.Config{
		Addr: ":0", Environment: "test", JWTSecret: []byte("test-secret"), JWTTTL: time.Hour,
		EncryptionKey: bytes.Repeat([]byte("k"), 32), QCaaSURL: up.URL, QCaaSAdminToken: "admin-token",
		CORSOrigins: []string{"http://localhost:3000"}, AdminEmails: map[string]bool{}, BcryptCost: 4,
	}
	s := New(cfg, st, qcaas.New(up.URL, "admin-token"), slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return srv, keys
}

func call(t *testing.T, srv *httptest.Server, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, srv.URL+path, rdr)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func register(t *testing.T, srv *httptest.Server, email string) (string, map[string]any) {
	code, out := call(t, srv, "POST", "/auth/register", "", map[string]string{"email": email, "password": "password123", "name": "N"})
	if code != 201 {
		t.Fatalf("register %s: %d %v", email, code, out)
	}
	return out["token"].(string), out["user"].(map[string]any)
}

func TestBootstrapAdminThenCustomer(t *testing.T) {
	srv, _ := newTestServer(t)
	_, admin := register(t, srv, "admin@example.com")
	if admin["role"] != "admin" {
		t.Fatalf("first user should be admin, got %v", admin["role"])
	}
	_, cust := register(t, srv, "cust@example.com")
	if cust["role"] != "customer" {
		t.Fatalf("second user should be customer, got %v", cust["role"])
	}
	code, out := call(t, srv, "POST", "/auth/register", "", map[string]string{"email": "cust@example.com", "password": "password123"})
	if code != 409 || out["code"] != "email_taken" {
		t.Fatalf("duplicate: %d %v", code, out)
	}
	code, out = call(t, srv, "POST", "/auth/register", "", map[string]string{"email": "bad", "password": "password123"})
	if code != 422 {
		t.Fatalf("bad email: %d %v", code, out)
	}
	code, _ = call(t, srv, "POST", "/auth/register", "", map[string]string{"email": "x@y.io", "password": "short"})
	if code != 422 {
		t.Fatalf("weak password: %d", code)
	}
}

func TestLoginMeAndRoles(t *testing.T) {
	srv, _ := newTestServer(t)
	register(t, srv, "admin@example.com")
	register(t, srv, "cust@example.com")

	code, out := call(t, srv, "POST", "/auth/login", "", map[string]string{"email": "cust@example.com", "password": "password123"})
	if code != 200 {
		t.Fatalf("login: %d %v", code, out)
	}
	tok := out["token"].(string)
	code, out = call(t, srv, "POST", "/auth/login", "", map[string]string{"email": "cust@example.com", "password": "wrong"})
	if code != 401 {
		t.Fatalf("bad login: %d %v", code, out)
	}
	code, out = call(t, srv, "GET", "/me", tok, nil)
	if code != 200 || out["has_api_key"] != false {
		t.Fatalf("me: %d %v", code, out)
	}
	if code, _ = call(t, srv, "GET", "/me", "", nil); code != 401 {
		t.Fatalf("me without token: %d", code)
	}
	if code, _ = call(t, srv, "GET", "/me", "garbage", nil); code != 401 {
		t.Fatalf("me with bad token: %d", code)
	}
	if code, _ = call(t, srv, "GET", "/admin/users", tok, nil); code != 403 {
		t.Fatalf("customer on admin route: %d", code)
	}
}

func TestProvisionKeyAndProxy(t *testing.T) {
	srv, keys := newTestServer(t)
	register(t, srv, "admin@example.com")
	tok, _ := register(t, srv, "cust@example.com")

	// proxy before a key exists -> 409
	if code, out := call(t, srv, "GET", "/proxy/v2/jobs", tok, nil); code != 409 || out["code"] != "no_api_key" {
		t.Fatalf("proxy without key: %d %v", code, out)
	}
	code, out := call(t, srv, "POST", "/me/api-key", tok, nil)
	if code != 201 || out["api_key"] != "qc_secret_key_123" || out["created"] != true {
		t.Fatalf("provision: %d %v", code, out)
	}
	// idempotent
	code, out = call(t, srv, "POST", "/me/api-key", tok, nil)
	if code != 200 || out["created"] != false || out["api_key"] != "qc_secret_key_123" {
		t.Fatalf("re-provision: %d %v", code, out)
	}
	code, out = call(t, srv, "GET", "/me", tok, nil)
	if code != 200 || out["has_api_key"] != true {
		t.Fatalf("me after key: %d %v", code, out)
	}
	user := out["user"].(map[string]any)
	if user["api_key_prefix"] != "qc_secre" || user["qcaas_customer_id"] != "cust1" {
		t.Fatalf("user fields: %v", user)
	}
	if _, has := user["password_hash"]; has {
		t.Fatal("password hash leaked")
	}
	// proxy injects the key and strips Authorization
	code, out = call(t, srv, "GET", "/proxy/v2/jobs?limit=1", tok, nil)
	if code != 200 || out["total"] != float64(0) {
		t.Fatalf("proxy: %d %v", code, out)
	}
	if len(*keys) != 1 || (*keys)[0] != "qc_secret_key_123" {
		t.Fatalf("upstream saw keys %v", *keys)
	}
}

func TestAdminEndpoints(t *testing.T) {
	srv, _ := newTestServer(t)
	adminTok, admin := register(t, srv, "admin@example.com")
	custTok, cust := register(t, srv, "cust@example.com")
	call(t, srv, "POST", "/me/api-key", custTok, nil)

	code, out := call(t, srv, "GET", "/admin/users", adminTok, nil)
	if code != 200 || out["total"] != float64(2) {
		t.Fatalf("list users: %d %v", code, out)
	}
	code, out = call(t, srv, "GET", "/admin/stats", adminTok, nil)
	if code != 200 || out["users"] != float64(2) || out["users_with_api_key"] != float64(1) {
		t.Fatalf("stats: %d %v", code, out)
	}
	code, out = call(t, srv, "GET", "/admin/jobs?limit=10", adminTok, nil)
	if code != 200 {
		t.Fatalf("jobs: %d %v", code, out)
	}
	items := out["items"].([]any)
	if items[0].(map[string]any)["account_email"] != "cust@example.com" {
		t.Fatalf("jobs not enriched: %v", items)
	}
	// disable the customer -> login refused, token refused
	active := false
	code, out = call(t, srv, "PATCH", "/admin/users/"+cust["id"].(string), adminTok, map[string]any{"active": active})
	if code != 200 || out["active"] != false {
		t.Fatalf("disable: %d %v", code, out)
	}
	if code, _ = call(t, srv, "GET", "/me", custTok, nil); code != 401 {
		t.Fatalf("disabled user token still works: %d", code)
	}
	if code, out = call(t, srv, "POST", "/auth/login", "", map[string]string{"email": "cust@example.com", "password": "password123"}); code != 403 {
		t.Fatalf("disabled login: %d %v", code, out)
	}
	// self-lockout guard
	if code, _ = call(t, srv, "PATCH", "/admin/users/"+admin["id"].(string), adminTok, map[string]any{"role": "customer"}); code != 422 {
		t.Fatalf("self demote should be 422, got %d", code)
	}
	// promote
	code, out = call(t, srv, "PATCH", "/admin/users/"+cust["id"].(string), adminTok, map[string]any{"role": "admin", "active": true})
	if code != 200 || out["role"] != "admin" {
		t.Fatalf("promote: %d %v", code, out)
	}
	if code, out = call(t, srv, "GET", "/admin/audit", adminTok, nil); code != 200 || len(out["items"].([]any)) == 0 {
		t.Fatalf("audit: %d %v", code, out)
	}
}

func TestCORSPreflight(t *testing.T) {
	srv, _ := newTestServer(t)
	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/auth/login", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 204 || resp.Header.Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Fatalf("preflight: %d %v", resp.StatusCode, resp.Header)
	}
	req.Header.Set("Origin", "https://evil.example")
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unknown origin must not be allowed")
	}
}
