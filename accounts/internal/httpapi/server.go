// Package httpapi wires routes, middleware and handlers.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/qcaas/accounts/internal/auth"
	"github.com/qcaas/accounts/internal/config"
	"github.com/qcaas/accounts/internal/oauth"
	"github.com/qcaas/accounts/internal/qcaas"
	"github.com/qcaas/accounts/internal/secrets"
	"github.com/qcaas/accounts/internal/store"
)

type Server struct {
	cfg    config.Config
	store  *store.Store
	qcaas  *qcaas.Client
	log    *slog.Logger
	vercel *regexp.Regexp
	oauth  *oauth.Registry
}

func New(cfg config.Config, st *store.Store, client *qcaas.Client, log *slog.Logger) *Server {
	return &Server{
		cfg:    cfg,
		store:  st,
		qcaas:  client,
		log:    log,
		vercel: regexp.MustCompile(`^https://[a-z0-9-]+\.vercel\.app$`),
		oauth: oauth.NewRegistry(oauth.Config{
			GoogleClientID:     cfg.GoogleClientID,
			GoogleClientSecret: cfg.GoogleClientSecret,
			GitHubClientID:     cfg.GitHubClientID,
			GitHubClientSecret: cfg.GitHubClientSecret,
		}),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)

	// API docs (OpenAPI 3 + Swagger UI).
	mux.HandleFunc("GET /openapi.json", s.handleOpenAPI)
	mux.HandleFunc("GET /docs", s.handleSwaggerUI)

	mux.HandleFunc("POST /auth/register", s.handleRegister)
	mux.HandleFunc("POST /auth/login", s.handleLogin)

	// SSO (Google / GitHub). No-ops gracefully when a provider is not configured.
	mux.HandleFunc("GET /auth/providers", s.handleAuthProviders)
	mux.HandleFunc("GET /auth/oauth/{provider}", s.handleOAuthStart)
	mux.HandleFunc("GET /auth/oauth/{provider}/callback", s.handleOAuthCallback)

	mux.Handle("GET /me", s.requireAuth(http.HandlerFunc(s.handleMe)))
	mux.Handle("PATCH /me", s.requireAuth(http.HandlerFunc(s.handleUpdateMe)))
	mux.Handle("POST /me/api-key", s.requireAuth(http.HandlerFunc(s.handleProvisionKey)))
	mux.Handle("GET /me/api-key", s.requireAuth(http.HandlerFunc(s.handleRevealKey)))
	mux.Handle("/proxy/v2/", s.requireAuth(s.proxyHandler()))

	mux.Handle("GET /admin/users", s.requireRole(store.RoleAdmin, http.HandlerFunc(s.handleAdminListUsers)))
	mux.Handle("PATCH /admin/users/{id}", s.requireRole(store.RoleAdmin, http.HandlerFunc(s.handleAdminUpdateUser)))
	mux.Handle("GET /admin/stats", s.requireRole(store.RoleAdmin, http.HandlerFunc(s.handleAdminStats)))
	mux.Handle("GET /admin/jobs", s.requireRole(store.RoleAdmin, http.HandlerFunc(s.handleAdminJobs)))
	mux.Handle("GET /admin/audit", s.requireRole(store.RoleAdmin, http.HandlerFunc(s.handleAdminAudit)))

	return s.cors(s.logging(mux))
}

// ---- helpers ------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"error": msg, "code": code})
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

type ctxKey int

const userKey ctxKey = 1

func userFrom(r *http.Request) *store.User {
	u, _ := r.Context().Value(userKey).(*store.User)
	return u
}

// ---- middleware ---------------------------------------------------------------------

func (s *Server) logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		s.log.Info("req", "method", r.Method, "path", r.URL.Path, "ms", time.Since(start).Milliseconds())
	})
}

func (s *Server) allowOrigin(origin string) bool {
	for _, o := range s.cfg.CORSOrigins {
		if o == origin || o == "*" {
			return true
		}
	}
	return !s.cfg.IsProduction() && s.vercel.MatchString(origin)
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && s.allowOrigin(origin) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Payload-Key")
			h.Set("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After")
			h.Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authenticate(r *http.Request) (*store.User, string) {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return nil, "missing bearer token"
	}
	claims, err := auth.ParseToken(s.cfg.JWTSecret, strings.TrimPrefix(h, "Bearer "))
	if err != nil {
		return nil, "invalid or expired token"
	}
	u, err := s.store.UserByID(r.Context(), claims.Subject)
	if err != nil || !u.Active {
		return nil, "account not found or disabled"
	}
	return u, ""
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, why := s.authenticate(r)
		if u == nil {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeErr(w, http.StatusUnauthorized, "unauthorized", why)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	})
}

func (s *Server) requireRole(role string, next http.Handler) http.Handler {
	return s.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if userFrom(r).Role != role {
			writeErr(w, http.StatusForbidden, "forbidden", "requires role "+role)
			return
		}
		next.ServeHTTP(w, r)
	}))
}

// ---- health -------------------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	out := map[string]any{"status": "ok", "service": "qcaas-accounts", "environment": s.cfg.Environment}
	if _, err := s.qcaas.Health(ctx); err != nil {
		out["qcaas_api"] = "unreachable"
	} else {
		out["qcaas_api"] = "ok"
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- key helpers --------------------------------------------------------------------

func (s *Server) decryptKey(u *store.User) (string, error) {
	pt, err := secrets.Decrypt(s.cfg.EncryptionKey, u.APIKeyEnc)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
