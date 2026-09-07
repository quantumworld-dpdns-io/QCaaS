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
