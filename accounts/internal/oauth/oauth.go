// Package oauth implements the OAuth2 authorization-code flow for Google and GitHub
// with the standard library only (no golang.org/x/oauth2), so the distroless build
// stays tiny and the dependency surface small. A provider is "configured" only when
// both its client id and secret are set; otherwise Enabled() is false and the HTTP
// layer reports it as unavailable.
package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// UserInfo is the normalised identity returned by every provider.
type UserInfo struct {
	Email    string
	Name     string
	Verified bool // the provider asserts the email address is verified
}

// Provider is one OAuth2 identity provider.
type Provider struct {
	Name         string
	clientID     string
	clientSecret string
	authURL      string
	tokenURL     string
	scopes       string
	// fetchUser turns an access token into a UserInfo (each API differs).
	fetchUser func(ctx context.Context, hc *http.Client, accessToken string) (UserInfo, error)
}

func (p *Provider) Enabled() bool { return p != nil && p.clientID != "" && p.clientSecret != "" }

// AuthCodeURL is where the browser is redirected to begin sign-in.
func (p *Provider) AuthCodeURL(state, redirectURI string) string {
	v := url.Values{
		"client_id":     {p.clientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		"scope":         {p.scopes},
		"state":         {state},
	}
	if p.Name == "google" {
		v.Set("access_type", "online")
		v.Set("prompt", "select_account")
	}
	return p.authURL + "?" + v.Encode()
}

var httpClient = &http.Client{Timeout: 15 * time.Second}

// Exchange swaps an authorization code for an access token.
func (p *Provider) Exchange(ctx context.Context, code, redirectURI string) (string, error) {
	form := url.Values{
		"client_id":     {p.clientID},
		"client_secret": {p.clientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"grant_type":    {"authorization_code"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json") // GitHub returns form-encoded otherwise
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token endpoint %s: status %d", p.Name, resp.StatusCode)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", fmt.Errorf("token endpoint %s: %w", p.Name, err)
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("token endpoint %s: no access_token (%s)", p.Name, tok.Error)
	}
	return tok.AccessToken, nil
}

// FetchUser returns the verified identity behind an access token.
func (p *Provider) FetchUser(ctx context.Context, accessToken string) (UserInfo, error) {
	return p.fetchUser(ctx, httpClient, accessToken)
}

func getJSON(ctx context.Context, hc *http.Client, urlStr, token string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "qcaas-accounts")
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: status %d", urlStr, resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}

// Registry holds the configured providers, keyed by name.
type Registry struct {
	providers map[string]*Provider
}

// Config carries the four OAuth client credentials.
type Config struct {
	GoogleClientID, GoogleClientSecret string
	GitHubClientID, GitHubClientSecret string
}

func NewRegistry(cfg Config) *Registry {
	google := &Provider{
		Name:         "google",
		clientID:     cfg.GoogleClientID,
		clientSecret: cfg.GoogleClientSecret,
		authURL:      "https://accounts.google.com/o/oauth2/v2/auth",
		tokenURL:     "https://oauth2.googleapis.com/token",
		scopes:       "openid email profile",
		fetchUser: func(ctx context.Context, hc *http.Client, tok string) (UserInfo, error) {
			var u struct {
				Email    string `json:"email"`
				Verified bool   `json:"email_verified"`
				Name     string `json:"name"`
			}
			if err := getJSON(ctx, hc, "https://openidconnect.googleapis.com/v1/userinfo", tok, &u); err != nil {
				return UserInfo{}, err
			}
			return UserInfo{Email: u.Email, Name: u.Name, Verified: u.Verified}, nil
		},
	}
	github := &Provider{
		Name:         "github",
		clientID:     cfg.GitHubClientID,
		clientSecret: cfg.GitHubClientSecret,
		authURL:      "https://github.com/login/oauth/authorize",
		tokenURL:     "https://github.com/login/oauth/access_token",
		scopes:       "read:user user:email",
		fetchUser: func(ctx context.Context, hc *http.Client, tok string) (UserInfo, error) {
			var profile struct {
				Name  string `json:"name"`
				Login string `json:"login"`
				Email string `json:"email"` // the user's public email, if any (verified by GitHub)
			}
			if err := getJSON(ctx, hc, "https://api.github.com/user", tok, &profile); err != nil {
				return UserInfo{}, err
			}
			name := profile.Name
			if name == "" {
				name = profile.Login
			}
			// Preferred: the verified primary from the dedicated endpoint (needs the
			// user:email scope on a classic OAuth App, or the "Email addresses: read"
			// account permission on a GitHub App).
			var emails []struct {
				Email    string `json:"email"`
				Primary  bool   `json:"primary"`
				Verified bool   `json:"verified"`
			}
			if err := getJSON(ctx, hc, "https://api.github.com/user/emails", tok, &emails); err == nil {
				for _, e := range emails {
					if e.Primary && e.Verified {
						return UserInfo{Email: e.Email, Name: name, Verified: true}, nil
					}
				}
				for _, e := range emails { // any verified address
					if e.Verified {
						return UserInfo{Email: e.Email, Name: name, Verified: true}, nil
					}
				}
			}
			// Fallback for GitHub Apps without email permission: the public profile email
			// (GitHub only exposes a verified address here).
			if profile.Email != "" {
				return UserInfo{Email: profile.Email, Name: name, Verified: true}, nil
			}
			return UserInfo{}, errors.New("no accessible verified email; grant the app email access or set a public email")
		},
	}
	return &Registry{providers: map[string]*Provider{"google": google, "github": github}}
}

// Get returns the provider by name (nil if unknown).
func (r *Registry) Get(name string) *Provider { return r.providers[name] }

// Enabled lists the names of configured providers, in a stable order (never nil, so it
// serialises as [] not null).
func (r *Registry) Enabled() []string {
	out := []string{}
	for _, name := range []string{"google", "github"} {
		if r.providers[name].Enabled() {
			out = append(out, name)
		}
	}
	return out
}
