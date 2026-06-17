// Package config provides configuration loading and validation for the sandbox service.
// Configuration can be loaded from a YAML file and overridden by environment variables.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the top-level configuration for the sandbox service.
type Config struct {
	Server    ServerConfig              `yaml:"server"`
	Pool      PoolConfig                `yaml:"pool"`
	Execution map[string]TierConfig     `yaml:"execution"` // keyed by tier: "tier1", "tier2", "tier3"
	Runtimes  map[string]RuntimeConfig  `yaml:"runtimes"`  // keyed by language: "python", "javascript"
	Security  SecurityConfig            `yaml:"security"`
}

// ServerConfig holds HTTP server settings.
type ServerConfig struct {
	Host   string `yaml:"host"`
	Port   int    `yaml:"port"`
	APIKey string `yaml:"api_key"`
}

// Addr returns the server listen address as "host:port".
func (s ServerConfig) Addr() string {
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

// PoolConfig controls the warm container pool.
type PoolConfig struct {
	MinIdle        int           `yaml:"min_idle"`
	MaxTotal       int           `yaml:"max_total"`
	WarmupInterval time.Duration `yaml:"warmup_interval"`
	MaxContainerAge    time.Duration `yaml:"max_container_age"`
	MaxContainerUses   int           `yaml:"max_container_uses"`
	HealthCheckInterval time.Duration `yaml:"health_check_interval"`
}

// TierConfig defines execution defaults for a security tier.
type TierConfig struct {
	TimeoutSeconds int    `yaml:"timeout_seconds"`
	MemoryMB       int    `yaml:"memory_mb"`
	CPUCount       int    `yaml:"cpu_count"`
	MaxPIDs        int    `yaml:"max_pids"`
	NetworkEnabled bool   `yaml:"network_enabled"`
	TmpfsSizeMB    int    `yaml:"tmpfs_size_mb"`
}

// RuntimeConfig defines per-language runtime settings.
type RuntimeConfig struct {
	Image            string   `yaml:"image"`
	EntrypointPrefix []string `yaml:"entrypoint_prefix"`
	PackageWhitelist []string `yaml:"package_whitelist"`
}

// SecurityConfig holds security-related paths and toggle.
type SecurityConfig struct {
	EnabledTiers     []int  `yaml:"enabled_tiers"`
	SeccompBasePath  string `yaml:"seccomp_base_path"`
}

// DefaultConfig returns a Config populated with sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Host:   "0.0.0.0",
			Port:   8080,
			APIKey: "",
		},
		Pool: PoolConfig{
			MinIdle:             2,
			MaxTotal:            10,
			WarmupInterval:      30 * time.Second,
			MaxContainerAge:     1 * time.Hour,
			MaxContainerUses:    50,
			HealthCheckInterval: 60 * time.Second,
		},
		Execution: map[string]TierConfig{
			"tier1": {
				TimeoutSeconds: 30,
				MemoryMB:       256,
				CPUCount:       1,
				MaxPIDs:        50,
				NetworkEnabled: false,
				TmpfsSizeMB:    64,
			},
			"tier2": {
				TimeoutSeconds: 120,
				MemoryMB:       512,
				CPUCount:       1,
				MaxPIDs:        100,
				NetworkEnabled: false,
				TmpfsSizeMB:    256,
			},
			"tier3": {
				TimeoutSeconds: 1800,
				MemoryMB:       2048,
				CPUCount:       2,
				MaxPIDs:        200,
				NetworkEnabled: true,
				TmpfsSizeMB:    1024,
			},
		},
		Runtimes: map[string]RuntimeConfig{
			"python": {
				Image:            "skillforge/sandbox-python:latest",
				EntrypointPrefix: []string{"python3", "-u"},
				PackageWhitelist: []string{"pandas", "numpy", "scipy", "matplotlib", "requests", "beautifulsoup4"},
			},
			"javascript": {
				Image:            "skillforge/sandbox-node:latest",
				EntrypointPrefix: []string{"node"},
				PackageWhitelist: []string{"axios", "lodash", "cheerio", "date-fns", "csv-parser"},
			},
		},
		Security: SecurityConfig{
			EnabledTiers:    []int{1, 2, 3},
			SeccompBasePath: "/etc/sandbox/seccomp",
		},
	}
}

// Load reads configuration from a YAML file, then applies environment variable overrides.
// If configPath is empty, only defaults and environment variables are used.
func Load(configPath string) (*Config, error) {
	cfg := DefaultConfig()

	// Load YAML file if provided.
	if configPath != "" {
		data, err := os.ReadFile(configPath)
		if err != nil {
			return nil, fmt.Errorf("reading config file %q: %w", configPath, err)
		}
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parsing config file %q: %w", configPath, err)
		}
		slog.Info("loaded configuration from file", "path", configPath)
	}

	// Apply environment variable overrides.
	applyEnvOverrides(cfg)

	// Validate the final configuration.
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return cfg, nil
}

// applyEnvOverrides reads environment variables and overrides the corresponding config fields.
// Convention: SANDBOX_<SECTION>_<FIELD> e.g. SANDBOX_SERVER_PORT=9090
func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("SANDBOX_SERVER_HOST"); v != "" {
		cfg.Server.Host = v
	}
	if v := os.Getenv("SANDBOX_SERVER_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = port
		}
	}
	if v := os.Getenv("SANDBOX_SERVER_API_KEY"); v != "" {
		cfg.Server.APIKey = v
	}
	if v := os.Getenv("SANDBOX_POOL_MIN_IDLE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Pool.MinIdle = n
		}
	}
	if v := os.Getenv("SANDBOX_POOL_MAX_TOTAL"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Pool.MaxTotal = n
		}
	}
	if v := os.Getenv("SANDBOX_POOL_WARMUP_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			cfg.Pool.WarmupInterval = d
		}
	}
	if v := os.Getenv("SANDBOX_SECURITY_SECCOMP_PATH"); v != "" {
		cfg.Security.SeccompBasePath = v
	}
}

// Validate checks that the configuration values are within acceptable bounds.
func (c *Config) Validate() error {
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("server port must be between 1 and 65535, got %d", c.Server.Port)
	}
	if c.Pool.MinIdle < 0 {
		return fmt.Errorf("pool min_idle must be non-negative, got %d", c.Pool.MinIdle)
	}
	if c.Pool.MaxTotal < 1 {
		return fmt.Errorf("pool max_total must be at least 1, got %d", c.Pool.MaxTotal)
	}
	if c.Pool.MinIdle > c.Pool.MaxTotal {
		return fmt.Errorf("pool min_idle (%d) cannot exceed max_total (%d)", c.Pool.MinIdle, c.Pool.MaxTotal)
	}

	// Validate each tier config.
	for name, tier := range c.Execution {
		if tier.TimeoutSeconds < 1 {
			return fmt.Errorf("execution.%s.timeout_seconds must be positive, got %d", name, tier.TimeoutSeconds)
		}
		if tier.MemoryMB < 32 {
			return fmt.Errorf("execution.%s.memory_mb must be at least 32, got %d", name, tier.MemoryMB)
		}
		if tier.CPUCount < 1 {
			return fmt.Errorf("execution.%s.cpu_count must be at least 1, got %d", name, tier.CPUCount)
		}
	}

	// Validate runtimes.
	for name, rt := range c.Runtimes {
		if rt.Image == "" {
			return fmt.Errorf("runtimes.%s.image must not be empty", name)
		}
	}

	return nil
}

// GetTierConfig returns the execution config for a given tier number (1-3).
// Returns an error if the tier is not configured.
func (c *Config) GetTierConfig(tier int) (TierConfig, error) {
	key := fmt.Sprintf("tier%d", tier)
	tc, ok := c.Execution[key]
	if !ok {
		return TierConfig{}, fmt.Errorf("tier %d is not configured (available: %s)",
			tier, strings.Join(tierKeys(c.Execution), ", "))
	}
	return tc, nil
}

// GetRuntimeConfig returns the runtime config for the given language.
func (c *Config) GetRuntimeConfig(language string) (RuntimeConfig, error) {
	lang := strings.ToLower(language)
	rc, ok := c.Runtimes[lang]
	if !ok {
		return RuntimeConfig{}, fmt.Errorf("unsupported language %q (available: %s)",
			lang, strings.Join(runtimeKeys(c.Runtimes), ", "))
	}
	return rc, nil
}

func tierKeys(m map[string]TierConfig) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func runtimeKeys(m map[string]RuntimeConfig) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
