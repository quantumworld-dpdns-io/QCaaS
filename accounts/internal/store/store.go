// Package store is the SQLite persistence layer (pure-Go driver, no cgo).
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	RoleCustomer = "customer"
	RoleAdmin    = "admin"
)

var ErrNotFound = errors.New("not found")
var ErrEmailTaken = errors.New("email already registered")

type User struct {
	ID              string     `json:"id"`
	Email           string     `json:"email"`
	Name            string     `json:"name"`
	Role            string     `json:"role"`
	Active          bool       `json:"active"`
	CreatedAt       time.Time  `json:"created_at"`
	QCaaSCustomerID *string    `json:"qcaas_customer_id,omitempty"`
	APIKeyPrefix    *string    `json:"api_key_prefix,omitempty"`
	APIKeyCreatedAt *time.Time `json:"api_key_created_at,omitempty"`
	PasswordHash    string     `json:"-"`
	APIKeyEnc       []byte     `json:"-"`
}

func (u User) HasAPIKey() bool { return len(u.APIKeyEnc) > 0 }

type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			return nil, err
		}
	}
	dsn := path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite: serialise writers
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL DEFAULT '',
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'customer',
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  qcaas_customer_id  TEXT,
  api_key_enc        BLOB,
  api_key_prefix     TEXT,
  api_key_created_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target_id  TEXT,
  detail     TEXT
);`)
	return err
}

func NewID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

const userCols = `id, email, name, password_hash, role, active, created_at, qcaas_customer_id, api_key_enc, api_key_prefix, api_key_created_at`

func scanUser(row interface{ Scan(dest ...any) error }) (*User, error) {
	var u User
	var created string
	var active int
	var cust, prefix, keyAt sql.NullString
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Role, &active, &created, &cust, &u.APIKeyEnc, &prefix, &keyAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	u.Active = active == 1
	u.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	if cust.Valid {
		u.QCaaSCustomerID = &cust.String
	}
	if prefix.Valid {
		u.APIKeyPrefix = &prefix.String
	}
	if keyAt.Valid {
		t, _ := time.Parse(time.RFC3339Nano, keyAt.String)
		u.APIKeyCreatedAt = &t
	}
	return &u, nil
}

func (s *Store) CreateUser(ctx context.Context, email, name, passwordHash, role string) (*User, error) {
	u := &User{ID: NewID(), Email: strings.ToLower(strings.TrimSpace(email)), Name: name, PasswordHash: passwordHash, Role: role, Active: true, CreatedAt: time.Now().UTC()}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO users (id, email, name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`,
		u.ID, u.Email, u.Name, u.PasswordHash, u.Role, u.CreatedAt.Format(time.RFC3339Nano))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, ErrEmailTaken
		}
		return nil, err
	}
	return u, nil
}

func (s *Store) UserByEmail(ctx context.Context, email string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE email = ?`, strings.ToLower(strings.TrimSpace(email))))
}

func (s *Store) UserByID(ctx context.Context, id string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE id = ?`, id))
}

func (s *Store) ListUsers(ctx context.Context) ([]*User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+userCols+` FROM users ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) CountAdmins(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE role = ? AND active = 1`, RoleAdmin).Scan(&n)
	return n, err
}

func (s *Store) CountUsers(ctx context.Context) (total, withKey int, err error) {
	err = s.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(CASE WHEN api_key_enc IS NOT NULL THEN 1 ELSE 0 END), 0) FROM users`).Scan(&total, &withKey)
	return
}

func (s *Store) UpdateUser(ctx context.Context, id string, role *string, active *bool, name *string) (*User, error) {
	if role != nil {
		if _, err := s.db.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, *role, id); err != nil {
			return nil, err
		}
	}
	if active != nil {
		v := 0
		if *active {
			v = 1
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE users SET active = ? WHERE id = ?`, v, id); err != nil {
			return nil, err
		}
	}
	if name != nil {
		if _, err := s.db.ExecContext(ctx, `UPDATE users SET name = ? WHERE id = ?`, *name, id); err != nil {
			return nil, err
		}
	}
	return s.UserByID(ctx, id)
}

func (s *Store) SetAPIKey(ctx context.Context, id, customerID string, enc []byte, prefix string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE users SET qcaas_customer_id = ?, api_key_enc = ?, api_key_prefix = ?, api_key_created_at = ? WHERE id = ?`,
		customerID, enc, prefix, time.Now().UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) Audit(ctx context.Context, actorID, action, targetID, detail string) {
	_, _ = s.db.ExecContext(ctx, `INSERT INTO audit_log (at, actor_id, action, target_id, detail) VALUES (?, ?, ?, ?, ?)`,
		time.Now().UTC().Format(time.RFC3339Nano), actorID, action, targetID, detail)
}

type AuditEntry struct {
	ID      int64  `json:"id"`
	At      string `json:"at"`
	ActorID string `json:"actor_id"`
	Action  string `json:"action"`
	Target  string `json:"target_id"`
	Detail  string `json:"detail"`
}

func (s *Store) RecentAudit(ctx context.Context, limit int) ([]AuditEntry, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, at, COALESCE(actor_id,''), action, COALESCE(target_id,''), COALESCE(detail,'') FROM audit_log ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.At, &e.ActorID, &e.Action, &e.Target, &e.Detail); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
