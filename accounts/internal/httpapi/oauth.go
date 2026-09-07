package httpapi

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/qcaas/accounts/internal/auth"
	"github.com/qcaas/accounts/internal/store"
)

const oauthStateCookie = "qcaas_oauth_state"

// redirectURI is the provider callback this service exposes. It must match exactly what
// is registered in the Google/GitHub OAuth app. Prefer the configured public URL; fall
// back to the request's forwarded scheme+host (correct behind the Caddy TLS proxy).
func (s *Server) redirectURI(r *http.Request, provider string) string {
	base := s.cfg.PublicURL
	if base == "" {
		scheme := "https"
		if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
			scheme = p
		} else if r.TLS == nil {
			scheme = "http"
		}
		base = scheme + "://" + r.Host
	}
	return base + "/auth/oauth/" + provider + "/callback"
}

func (s *Server) ssoError(w http.ResponseWriter, r *http.Request, code string) {
	dest := s.cfg.WebURL + "/login?sso_error=" + url.QueryEscape(code)
	http.Redirect(w, r, dest, http.StatusSeeOther)
}

// GET /auth/providers – which SSO providers are configured (so the UI shows only those).
func (s *Server) handleAuthProviders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"providers": s.oauth.Enabled()})
}

// GET /auth/oauth/{provider} – begin the authorization-code flow.
func (s *Server) handleOAuthStart(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("provider")
	p := s.oauth.Get(name)
	if !p.Enabled() {
		s.ssoError(w, r, "provider_unavailable")
		return
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		s.ssoError(w, r, "state_error")
		return
	}
	state := hex.EncodeToString(b)
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookie,
		Value:    state,
		Path:     "/auth/oauth",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   s.cfg.IsProduction(),
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, p.AuthCodeURL(state, s.redirectURI(r, name)), http.StatusSeeOther)
}

// GET /auth/oauth/{provider}/callback – exchange the code, sign the user in, redirect to the SPA.
func (s *Server) handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("provider")
	p := s.oauth.Get(name)
	if !p.Enabled() {
		s.ssoError(w, r, "provider_unavailable")
		return
	}
	// CSRF: the state in the query must match the one we set in the cookie.
	cookie, err := r.Cookie(oauthStateCookie)
	state := r.URL.Query().Get("state")
	if err != nil || state == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 {
		s.ssoError(w, r, "state_mismatch")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: oauthStateCookie, Value: "", Path: "/auth/oauth", MaxAge: -1})

	if e := r.URL.Query().Get("error"); e != "" {
		s.ssoError(w, r, "provider_denied")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		s.ssoError(w, r, "missing_code")
		return
	}

	token, err := p.Exchange(r.Context(), code, s.redirectURI(r, name))
	if err != nil {
		s.log.Warn("oauth exchange failed", "provider", name, "err", err)
		s.ssoError(w, r, "exchange_failed")
		return
	}
	info, err := p.FetchUser(r.Context(), token)
	if err != nil || info.Email == "" {
		s.log.Warn("oauth userinfo failed", "provider", name, "err", err)
		s.ssoError(w, r, "userinfo_failed")
		return
	}
	if !info.Verified {
		s.ssoError(w, r, "email_unverified")
		return
	}

	email := strings.ToLower(strings.TrimSpace(info.Email))
	u, err := s.store.UserByEmail(r.Context(), email)
	if errors.Is(err, store.ErrNotFound) {
		role := store.RoleCustomer
		if s.cfg.AdminEmails[email] {
			role = store.RoleAdmin
		} else if n, err := s.store.CountAdmins(r.Context()); err == nil && n == 0 && len(s.cfg.AdminEmails) == 0 {
			role = store.RoleAdmin // bootstrap: the first account becomes admin
		}
		u, err = s.store.CreateOAuthUser(r.Context(), email, info.Name, role)
		if err != nil {
			s.log.Warn("oauth create user failed", "err", err)
			s.ssoError(w, r, "signup_failed")
			return
		}
		s.store.Audit(r.Context(), u.ID, "oauth_register", u.ID, name+":"+role)
	} else if err != nil {
		s.ssoError(w, r, "db_error")
		return
	}
	if !u.Active {
		s.ssoError(w, r, "account_disabled")
		return
	}

	tok, exp, err := auth.IssueToken(s.cfg.JWTSecret, u.ID, u.Email, u.Role, s.cfg.JWTTTL)
	if err != nil {
		s.ssoError(w, r, "token_error")
		return
	}
	s.store.Audit(r.Context(), u.ID, "oauth_login", u.ID, name)

	// Token goes back in the URL fragment so it never lands in server/referrer logs.
	dest := s.cfg.WebURL + "/auth/callback#token=" + url.QueryEscape(tok) +
		"&expires_at=" + strconv.FormatInt(exp.Unix(), 10)
	http.Redirect(w, r, dest, http.StatusSeeOther)
}
