package httpapi

import (
	_ "embed"
	"encoding/json"
	"net/http"
)

//go:embed openapi.json
var openapiSpec []byte

// GET /openapi.json – the accounts service API description. The `servers` URL is filled
// in from the live public base so "Try it out" in Swagger UI targets the right host.
func (s *Server) handleOpenAPI(w http.ResponseWriter, r *http.Request) {
	var doc map[string]any
	if err := json.Unmarshal(openapiSpec, &doc); err != nil {
		writeErr(w, http.StatusInternalServerError, "openapi_error", "spec unavailable")
		return
	}
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
	doc["servers"] = []map[string]string{{"url": base}}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(doc)
}

// GET /docs – Swagger UI (assets from the jsDelivr CDN, matching the FastAPI service).
func (s *Server) handleSwaggerUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(swaggerUIHTML))
}

const swaggerUIHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>QCaaS Accounts API – Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
    });
  </script>
</body>
</html>`
