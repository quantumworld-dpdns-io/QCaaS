// Package qcaas talks to the Python QCaaS API: the admin-token-guarded /internal endpoints
// (customer provisioning, cross-customer job listing) and a reverse proxy for /v2/*.
package qcaas

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	base       string
	adminToken string
	http       *http.Client
	target     *url.URL
}

func New(baseURL, adminToken string) *Client {
	u, _ := url.Parse(baseURL)
	return &Client{base: baseURL, adminToken: adminToken, http: &http.Client{Timeout: 30 * time.Second}, target: u}
}

type ProvisionedCustomer struct {
	CustomerID string `json:"customer_id"`
	APIKey     string `json:"api_key"`
	KeyPrefix  string `json:"key_prefix"`
	Name       string `json:"name"`
	Plan       string `json:"plan"`
}

type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string { return fmt.Sprintf("qcaas api %d: %s", e.Status, e.Body) }

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("X-Admin-Token", c.adminToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 300 {
		return &APIError{Status: resp.StatusCode, Body: strings.TrimSpace(string(data))}
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

// CreateCustomer provisions a QCaaS customer + API key for an account.
func (c *Client) CreateCustomer(ctx context.Context, name, plan, externalID string, retentionDays int) (*ProvisionedCustomer, error) {
	var out ProvisionedCustomer
	err := c.do(ctx, http.MethodPost, "/internal/customers", map[string]any{
		"name": name, "plan": plan, "retention_days": retentionDays, "external_id": externalID,
	}, &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) SetCustomerActive(ctx context.Context, customerID string, active bool) error {
	return c.do(ctx, http.MethodPatch, "/internal/customers/"+url.PathEscape(customerID), map[string]any{"active": active}, nil)
}

// Raw forwards an admin GET (e.g. /internal/jobs?limit=50) and returns the JSON body untouched.
func (c *Client) Raw(ctx context.Context, path string) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) Health(ctx context.Context) (json.RawMessage, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/healthz", nil)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != 200 {
		return nil, &APIError{Status: resp.StatusCode, Body: string(data)}
	}
	return data, nil
}

// Proxy returns a reverse proxy that rewrites /proxy/v2/... -> /v2/... on the QCaaS API and
// injects the caller's API key. Browser credentials never reach the QCaaS API.
func (c *Client) Proxy(apiKeyFor func(r *http.Request) string) http.Handler {
	rp := httputil.NewSingleHostReverseProxy(c.target)
	director := rp.Director
	rp.Director = func(r *http.Request) {
		key := apiKeyFor(r)
		director(r)
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/proxy")
		r.URL.RawPath = ""
		r.Host = c.target.Host
		r.Header.Del("Authorization")
		r.Header.Del("Cookie")
		r.Header.Set("X-API-Key", key)
	}
	rp.ModifyResponse = func(resp *http.Response) error {
		// The API's own CORS headers must not leak through; the accounts service sets its own.
		resp.Header.Del("Access-Control-Allow-Origin")
		return nil
	}
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "qcaas api unreachable", "code": "upstream_unavailable"})
	}
	return rp
}
