package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// openTestStore returns a SQLite store, or a PostgreSQL one when ACCOUNTS_TEST_DB_URL is set
// (e.g. postgres://postgres:pg@localhost:15432/qcaas). Run both in CI when a DB is available.
func openTestStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("ACCOUNTS_TEST_DB_URL")
	if dsn == "" {
		dsn = filepath.Join(t.TempDir(), "t.db")
	}
	s, err := Open(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if s.Dialect() == DialectPostgres {
		// isolate: wipe tables between runs
		_, _ = s.db.Exec(`DELETE FROM audit_log`)
		_, _ = s.db.Exec(`DELETE FROM users`)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestDialectFor(t *testing.T) {
	if DialectFor("postgres://u:p@h/db") != DialectPostgres || DialectFor("postgresql://h/db") != DialectPostgres {
		t.Fatal("postgres dsn not detected")
	}
	if DialectFor("./data/x.db") != DialectSQLite || DialectFor(":memory:") != DialectSQLite {
		t.Fatal("sqlite dsn not detected")
	}
}

func TestPlaceholderRewrite(t *testing.T) {
	s := &Store{dialect: DialectPostgres}
	if got := s.q("a = ? AND b = ?"); got != "a = $1 AND b = $2" {
		t.Fatalf("got %q", got)
	}
	s.dialect = DialectSQLite
	if got := s.q("a = ?"); got != "a = ?" {
		t.Fatalf("got %q", got)
	}
}

func TestUserLifecycle(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "  A@B.io ", "Ann", "hash", RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != "a@b.io" {
		t.Fatalf("email not normalised: %q", u.Email)
	}
	if _, err := s.CreateUser(ctx, "a@b.io", "dup", "hash", RoleCustomer); err != ErrEmailTaken {
		t.Fatalf("expected ErrEmailTaken, got %v", err)
	}
	got, err := s.UserByEmail(ctx, "A@B.IO")
	if err != nil || got.ID != u.ID || !got.Active || got.HasAPIKey() {
		t.Fatalf("lookup: %v %+v", err, got)
	}
	if n, _ := s.CountAdmins(ctx); n != 1 {
		t.Fatalf("admins = %d", n)
	}
	if err := s.SetAPIKey(ctx, u.ID, "cust1", []byte{1, 2, 3}, "qc_abc"); err != nil {
		t.Fatal(err)
	}
	got, _ = s.UserByID(ctx, u.ID)
	if !got.HasAPIKey() || *got.APIKeyPrefix != "qc_abc" || *got.QCaaSCustomerID != "cust1" || got.APIKeyCreatedAt == nil {
		t.Fatalf("api key fields: %+v", got)
	}
	total, withKey, _ := s.CountUsers(ctx)
	if total != 1 || withKey != 1 {
		t.Fatalf("counts %d %d", total, withKey)
	}
	inactive := false
	role := RoleCustomer
	name := "Ann B"
	got, err = s.UpdateUser(ctx, u.ID, &role, &inactive, &name)
	if err != nil || got.Active || got.Role != RoleCustomer || got.Name != "Ann B" {
		t.Fatalf("update: %v %+v", err, got)
	}
	if err := s.SetAPIKey(ctx, "nope", "c", []byte{1}, "p"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
	s.Audit(ctx, u.ID, "test", u.ID, "d")
	entries, err := s.RecentAudit(ctx, 10)
	if err != nil || len(entries) != 1 || entries[0].Action != "test" {
		t.Fatalf("audit: %v %+v", err, entries)
	}
	users, _ := s.ListUsers(ctx)
	if len(users) != 1 {
		t.Fatalf("list: %d", len(users))
	}
}
