// Package main is the entry point for the SkillForge Sandbox Service.
// It initializes configuration, Docker connectivity, the container pool,
// and starts the HTTP server with graceful shutdown support.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/skillforge/sandbox/internal/api"
	"github.com/skillforge/sandbox/internal/config"
	"github.com/skillforge/sandbox/internal/executor"
	"github.com/skillforge/sandbox/internal/pool"
)

func main() {
	// Parse command-line flags.
	configPath := flag.String("config", "", "Path to configuration YAML file")
	flag.Parse()

	// Set up structured logging.
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level:     slog.LevelDebug,
		AddSource: true,
	}))
	slog.SetDefault(logger)

	logger.Info("starting SkillForge Sandbox Service",
		"version", "0.1.0",
		"pid", os.Getpid(),
	)

	// Load configuration from file and environment variables.
	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Error("failed to load configuration", "error", err)
		os.Exit(1)
	}

	logger.Info("configuration loaded",
		"host", cfg.Server.Host,
		"port", cfg.Server.Port,
		"pool_min_idle", cfg.Pool.MinIdle,
		"pool_max_total", cfg.Pool.MaxTotal,
	)

	// Initialize the Docker client.
	dockerClient, err := executor.NewDockerClient(cfg, logger)
	if err != nil {
		logger.Error("failed to initialize Docker client", "error", err)
		os.Exit(1)
	}
	defer dockerClient.Close()

	logger.Info("docker client initialized")

	// Build runtime image map for the pool.
	runtimeImages := make(map[string]string)
	for lang, rt := range cfg.Runtimes {
		runtimeImages[lang] = rt.Image
	}

	// Create the container pool.
	containerPool := pool.NewPool(cfg.Pool, dockerClient, runtimeImages, logger)

	// Create the executor.
	exec := executor.NewExecutor(dockerClient, containerPool, cfg, logger)

	// Create a cancellable context for the application lifecycle.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start the container pool (background warmup and health checks).
	containerPool.Start(ctx)

	// Start periodic cleanup of old execution tracking records (every 5 minutes).
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				exec.CleanupTracking(30 * time.Minute)
			}
		}
	}()

	// Create the HTTP router.
	router := api.NewRouter(exec, containerPool, cfg.Server.APIKey, logger)

	// Configure the HTTP server.
	// WriteTimeout must be larger than the maximum tier 3 timeout (30 min = 1800s).
	srv := &http.Server{
		Addr:         cfg.Server.Addr(),
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 35 * time.Minute, // Must exceed tier 3 max timeout (30 min).
		IdleTimeout:  120 * time.Second,
		// Limit header size to prevent header-based attacks.
		MaxHeaderBytes: 1 << 20, // 1 MB.
	}

	// Start the HTTP server in a goroutine.
	go func() {
		logger.Info("HTTP server starting",
			"addr", srv.Addr,
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	logger.Info(fmt.Sprintf("sandbox service ready at http://%s", srv.Addr))

	// Wait for shutdown signal (SIGINT or SIGTERM).
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	sig := <-sigCh
	logger.Info("received shutdown signal",
		"signal", sig.String(),
	)

	// Graceful shutdown sequence:
	// 1. Stop accepting new HTTP connections.
	// 2. Wait for in-flight requests to complete (with timeout).
	// 3. Shut down the container pool (destroy all containers).
	// 4. Cancel the application context.

	logger.Info("initiating graceful shutdown")

	// Give in-flight requests up to 30 seconds to complete.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("HTTP server shutdown error", "error", err)
	}
	logger.Info("HTTP server stopped")

	// Cancel the application context to stop background goroutines.
	cancel()

	// Shut down the container pool.
	poolShutdownCtx, poolShutdownCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer poolShutdownCancel()
	containerPool.Shutdown(poolShutdownCtx)

	logger.Info("sandbox service shutdown complete")
}
