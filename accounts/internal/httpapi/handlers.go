package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/qcaas/accounts/internal/auth"
	"github.com/qcaas/accounts/internal/qcaas"
	"github.com/qcaas/accounts/internal/secrets"
	"github.com/qcaas/accounts/internal/store"
)

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name,omitempty"`
}

type authResponse struct {
	Token     string      `json:"token"`
	ExpiresAt time.Time   `json:"expires_at"`
	User      *store.User `json:"user"`
}

func (s *Server) issue(w http.ResponseWriter, status int, u *store.User) {
	tok, exp, err := auth.IssueToken(s.cfg.JWTSecret, u.ID, u.Email, u.Role, s.cfg.JWTTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token_error", "could not issue token")
		return
	}
	writeJSON(w, status, authResponse{Token: tok, ExpiresAt: exp, User: u})
}

// POST /auth/register
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if _, err := mail.ParseAddress(in.Email); err != nil || in.Email == "" {
		writeErr(w, http.StatusUnprocessableEntity, "invalid_email", "a valid email is required")
		return
	}
	if len(in.Password) < 8 || len(in.Password) > 200 {
		writeErr(w, http.StatusUnprocessableEntity, "weak_password", "password must be 8-200 characters")
		return
	}
	hash, err := auth.HashPassword(in.Password, s.cfg.BcryptCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash_error", "could not hash password")
		return
	}
	role := store.RoleCustomer
	if s.cfg.AdminEmails[in.Email] {
		role = store.RoleAdmin
	} else if n, err := s.store.CountAdmins(r.Context()); err == nil && n == 0 && len(s.cfg.AdminEmails) == 0 {
		role = store.RoleAdmin // bootstrap: the very first account becomes admin
	}
	u, err := s.store.CreateUser(r.Context(), in.Email, strings.TrimSpace(in.Name), hash, role)
	if err != nil {
		if errors.Is(err, store.ErrEmailTaken) {
			writeErr(w, http.StatusConflict, "email_taken", "email already registered")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", "could not create account")
		return
	}
	s.store.Audit(r.Context(), u.ID, "register", u.ID, role)
	s.issue(w, http.StatusCreated, u)
}

// POST /auth/login
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	u, err := s.store.UserByEmail(r.Context(), in.Email)
	if err != nil || !auth.CheckPassword(u.PasswordHash, in.Password) {
		writeErr(w, http.StatusUnauthorized, "invalid_credentials", "email or password is incorrect")
		return
	}
	if !u.Active {
		writeErr(w, http.StatusForbidden, "account_disabled", "account is disabled")
		return
	}
	s.store.Audit(r.Context(), u.ID, "login", u.ID, "")
	s.issue(w, http.StatusOK, u)
}

// GET /me
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	writeJSON(w, http.StatusOK, map[string]any{"user": u, "has_api_key": u.HasAPIKey()})
}

// PATCH /me {name}
func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name *string `json:"name"`
	}
	if err := decode(r, &in); err != nil || in.Name == nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "name is required")
		return
	}
	u, err := s.store.UpdateUser(r.Context(), userFrom(r).ID, nil, nil, in.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "could not update")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u, "has_api_key": u.HasAPIKey()})
}

// POST /me/api-key  – provision a QCaaS customer + key (idempotent: returns the existing key).
func (s *Server) handleProvisionKey(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	if u.HasAPIKey() {
		s.handleRevealKey(w, r)
		return
	}
	var in struct {
		Plan          string `json:"plan"`
		RetentionDays int    `json:"retention_days"`
	}
	if r.ContentLength > 0 {
		if err := decode(r, &in); err != nil {
			writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
			return
		}
	}
	if in.Plan == "" {
		in.Plan = "payg"
	}
	if in.RetentionDays <= 0 {
		in.RetentionDays = 30
	}
	name := u.Name
	if name == "" {
		name = u.Email
	}
	pc, err := s.qcaas.CreateCustomer(r.Context(), name, in.Plan, u.ID, in.RetentionDays)
	if err != nil {
		var apiErr *qcaas.APIError
		if errors.As(err, &apiErr) {
			s.log.Warn("provision failed", "status", apiErr.Status, "body", apiErr.Body)
		} else {
			s.log.Warn("provision failed", "err", err)
		}
		writeErr(w, http.StatusBadGateway, "provision_failed", "QCaaS API could not provision an API key")
		return
	}
	enc, err := secrets.Encrypt(s.cfg.EncryptionKey, []byte(pc.APIKey))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "crypto_error", "could not store key")
		return
	}
	if err := s.store.SetAPIKey(r.Context(), u.ID, pc.CustomerID, enc, pc.KeyPrefix); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "could not store key")
		return
	}
	s.store.Audit(r.Context(), u.ID, "provision_api_key", u.ID, pc.CustomerID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"api_key": pc.APIKey, "key_prefix": pc.KeyPrefix, "customer_id": pc.CustomerID, "plan": in.Plan, "created": true,
	})
}

// GET /me/api-key – reveal the stored key (the browser may still call the API directly).
func (s *Server) handleRevealKey(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	if !u.HasAPIKey() {
		writeErr(w, http.StatusNotFound, "no_api_key", "no API key provisioned yet; POST /me/api-key")
		return
	}
	key, err := s.decryptKey(u)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "crypto_error", "could not decrypt key")
		return
	}
	s.store.Audit(r.Context(), u.ID, "reveal_api_key", u.ID, "")
	writeJSON(w, http.StatusOK, map[string]any{
		"api_key": key, "key_prefix": u.APIKeyPrefix, "customer_id": u.QCaaSCustomerID, "created": false,
	})
}

// /proxy/v2/* – forward to the QCaaS API with the caller's own key.
func (s *Server) proxyHandler() http.Handler {
	proxy := s.qcaas.Proxy(func(r *http.Request) string {
		u := userFrom(r)
		if u == nil || !u.HasAPIKey() {
			return ""
		}
		key, err := s.decryptKey(u)
		if err != nil {
			return ""
		}
		return key
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !userFrom(r).HasAPIKey() {
			writeErr(w, http.StatusConflict, "no_api_key", "provision an API key first (POST /me/api-key)")
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

// ---- admin --------------------------------------------------------------------------

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "could not list users")
		return
	}
	if users == nil {
		users = []*store.User{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": users, "total": len(users)})
}

func (s *Server) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Role   *string `json:"role"`
		Active *bool   `json:"active"`
		Name   *string `json:"name"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if in.Role != nil && *in.Role != store.RoleAdmin && *in.Role != store.RoleCustomer {
		writeErr(w, http.StatusUnprocessableEntity, "invalid_role", "role must be admin or customer")
		return
	}
	actor := userFrom(r)
	if id == actor.ID && ((in.Active != nil && !*in.Active) || (in.Role != nil && *in.Role != store.RoleAdmin)) {
		writeErr(w, http.StatusUnprocessableEntity, "self_lockout", "an admin cannot disable or demote their own account")
		return
	}
	target, err := s.store.UserByID(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	u, err := s.store.UpdateUser(r.Context(), id, in.Role, in.Active, in.Name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "could not update user")
		return
	}
	// Mirror activation to the QCaaS customer so a disabled account's key stops working too.
	if in.Active != nil && target.QCaaSCustomerID != nil {
		if err := s.qcaas.SetCustomerActive(r.Context(), *target.QCaaSCustomerID, *in.Active); err != nil {
			s.log.Warn("could not mirror active flag to qcaas", "err", err)
		}
	}
	detail, _ := json.Marshal(in)
	s.store.Audit(r.Context(), actor.ID, "admin_update_user", id, string(detail))
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	total, withKey, err := s.store.CountUsers(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "could not count users")
		return
	}
	out := map[string]any{"users": total, "users_with_api_key": withKey}
	if raw, err := s.qcaas.Raw(r.Context(), "/internal/stats"); err == nil {
		out["qcaas"] = raw
	} else {
		out["qcaas_error"] = err.Error()
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleAdminJobs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.RawQuery
	path := "/internal/jobs"
	if q != "" {
		path += "?" + q
	}
	raw, err := s.qcaas.Raw(r.Context(), path)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "upstream_error", err.Error())
		return
	}
	// Enrich with account emails so the admin sees who ran what.
	users, _ := s.store.ListUsers(r.Context())
	byCustomer := map[string]string{}
	for _, u := range users {
		if u.QCaaSCustomerID != nil {
			byCustomer[*u.QCaaSCustomerID] = u.Email
		}
	}
	var page struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	if err := json.Unmarshal(raw, &page); err != nil {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(raw)
		return
	}
	for _, it := range page.Items {
		if cid, ok := it["customer_id"].(string); ok {
			it["account_email"] = byCustomer[cid]
		}
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleAdminAudit(w http.ResponseWriter, r *http.Request) {
	entries, err := s.store.RecentAudit(r.Context(), 200)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", "could not read audit log")
		return
	}
	if entries == nil {
		entries = []store.AuditEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": entries})
}
