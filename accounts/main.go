// QCaaS accounts service: sign-up/login, roles (customer/admin), API-key provisioning against
// the Python QCaaS API, and an authenticated reverse proxy so browsers never hold raw API keys.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/qcaas/accounts/internal/config"
	"github.com/qcaas/accounts/internal/httpapi"
	"github.com/qcaas/accounts/internal/qcaas"
	"github.com/qcaas/accounts/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	// `accounts healthcheck` is used by the distroless container's HEALTHCHECK (no curl there).
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		addr := os.Getenv("ACCOUNTS_ADDR")
		if addr == "" {
			addr = ":8080"
		}
		if addr[0] == ':' {
			addr = "127.0.0.1" + addr
		}
		resp, err := http.Get("http://" + addr + "/healthz")
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config", "err", err)
		os.Exit(2)
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		logger.Error("open db", "err", err)
		os.Exit(2)
	}
	defer st.Close()

	client := qcaas.New(cfg.QCaaSURL, cfg.QCaaSAdminToken)
	srv := httpapi.New(cfg, st, client, logger)

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      180 * time.Second, // proxied /v2/optimize can take a while
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("accounts service listening", "addr", cfg.Addr, "qcaas_url", cfg.QCaaSURL)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("listen", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
	logger.Info("stopped")
}
