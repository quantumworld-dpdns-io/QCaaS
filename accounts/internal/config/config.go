package config

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is read from ACCOUNTS_* environment variables.
type Config struct {
	Addr            string
	Environment     string // dev | staging | production
	DBPath          string
	JWTSecret       []byte
	JWTTTL          time.Duration
	EncryptionKey   []byte // 32 bytes, AES-256-GCM for stored API keys
	QCaaSURL        string
	QCaaSAdminToken string
	CORSOrigins     []string
	AdminEmails     map[string]bool
	BcryptCost      int
}

func (c Config) IsProduction() bool { return c.Environment == "production" }

func Load() (Config, error) {
	c := Config{
		Addr:            env("ACCOUNTS_ADDR", ":8080"),
		Environment:     env("ACCOUNTS_ENVIRONMENT", "dev"),
		DBPath:          env("ACCOUNTS_DB_PATH", "./data/accounts.db"),
		QCaaSURL:        strings.TrimRight(env("QCAAS_API_URL", "http://localhost:8000"), "/"),
		QCaaSAdminToken: os.Getenv("QCAAS_ADMIN_TOKEN"),
		BcryptCost:      12,
	}
	secret := os.Getenv("ACCOUNTS_JWT_SECRET")
	if secret == "" {
		if c.IsProduction() {
			return c, errors.New("ACCOUNTS_JWT_SECRET is required in production")
		}
		secret = "dev-jwt-secret-change-me"
	}
	c.JWTSecret = []byte(secret)

	ttlHours, err := strconv.Atoi(env("ACCOUNTS_JWT_TTL_HOURS", "24"))
	if err != nil || ttlHours <= 0 {
		return c, fmt.Errorf("ACCOUNTS_JWT_TTL_HOURS must be a positive integer")
	}
	c.JWTTTL = time.Duration(ttlHours) * time.Hour

	if k := os.Getenv("ACCOUNTS_ENCRYPTION_KEY"); k != "" {
		raw, err := base64.StdEncoding.DecodeString(k)
		if err != nil || len(raw) != 32 {
			return c, errors.New("ACCOUNTS_ENCRYPTION_KEY must be base64 of exactly 32 bytes")
		}
		c.EncryptionKey = raw
	} else {
		if c.IsProduction() {
			return c, errors.New("ACCOUNTS_ENCRYPTION_KEY is required in production")
		}
		sum := sha256.Sum256(append([]byte("qcaas-accounts-enc:"), c.JWTSecret...))
		c.EncryptionKey = sum[:]
	}

	for _, o := range strings.Split(env("ACCOUNTS_CORS_ORIGINS", "http://localhost:3000"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.CORSOrigins = append(c.CORSOrigins, o)
		}
	}
	c.AdminEmails = map[string]bool{}
	for _, e := range strings.Split(os.Getenv("ACCOUNTS_ADMIN_EMAILS"), ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			c.AdminEmails[e] = true
		}
	}
	if cost := os.Getenv("ACCOUNTS_BCRYPT_COST"); cost != "" {
		if n, err := strconv.Atoi(cost); err == nil && n >= 4 && n <= 31 {
			c.BcryptCost = n
		}
	}
	return c, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
