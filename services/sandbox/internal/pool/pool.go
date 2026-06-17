// Package pool provides a warm container pool for fast sandbox execution.
// The pool maintains pre-created Docker containers per language so that
// code execution requests don't incur container startup latency.
package pool

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/skillforge/sandbox/internal/config"
)

// PoolMetrics reports the current state of the container pool.
type PoolMetrics struct {
	// Per-language metrics.
	Languages map[string]LanguageMetrics `json:"languages"`

	// TotalIdle is the number of idle containers across all languages.
	TotalIdle int `json:"total_idle"`

	// TotalInUse is the number of containers currently executing code.
	TotalInUse int `json:"total_in_use"`

	// TotalContainers is the total number of managed containers.
	TotalContainers int `json:"total_containers"`

	// MaxTotal is the configured upper limit.
	MaxTotal int `json:"max_total"`
}

// LanguageMetrics reports pool state for a single language.
type LanguageMetrics struct {
	Idle     int `json:"idle"`
	InUse    int `json:"in_use"`
	Creating int `json:"creating"`
	Total    int `json:"total"`
}

// Pool manages a warm pool of pre-initialized Docker containers.
// It maintains separate lists per language and replenishes idle containers
// in the background to ensure low-latency execution.
type Pool struct {
	mu sync.Mutex

	cfg     config.PoolConfig
	manager ContainerManager

	// containers holds all managed containers indexed by their Docker ID.
	containers map[string]*SandboxContainer

	// idle holds channels of idle container IDs per language.
	// Using a channel provides thread-safe FIFO access.
	idle map[string][]*SandboxContainer

	// creating tracks the number of containers currently being created per language.
	// This is counted under the mu lock to prevent over-provisioning during
	// concurrent on-demand container creation.
	creating map[string]int

	// supportedLanguages lists which languages the pool manages.
	supportedLanguages []string

	// runtimeImages maps language -> Docker image name.
	runtimeImages map[string]string

	// done signals the background goroutines to stop.
	done chan struct{}

	// wg tracks background goroutines.
	wg sync.WaitGroup

	logger *slog.Logger
}

// NewPool creates a new container pool.
func NewPool(cfg config.PoolConfig, manager ContainerManager, runtimeImages map[string]string, logger *slog.Logger) *Pool {
	languages := make([]string, 0, len(runtimeImages))
	for lang := range runtimeImages {
		languages = append(languages, lang)
	}

	if logger == nil {
		logger = slog.Default()
	}

	return &Pool{
		cfg:                cfg,
		manager:            manager,
		containers:         make(map[string]*SandboxContainer),
		idle:               make(map[string][]*SandboxContainer),
		creating:           make(map[string]int),
		supportedLanguages: languages,
		runtimeImages:      runtimeImages,
		done:               make(chan struct{}),
		logger:             logger,
	}
}

// Start begins the background warmup and health check goroutines.
// Call this after creating the pool.
func (p *Pool) Start(ctx context.Context) {
	p.logger.Info("starting container pool",
		"min_idle", p.cfg.MinIdle,
		"max_total", p.cfg.MaxTotal,
		"languages", p.supportedLanguages,
	)

	// Initial warmup: create MinIdle containers per language.
	p.warmup(ctx)

	// Background goroutine: periodically replenish idle containers.
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		p.warmupLoop(ctx)
	}()

	// Background goroutine: periodic health checks on idle containers.
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		p.healthCheckLoop(ctx)
	}()
}

// warmup ensures that at least MinIdle containers exist per language.
func (p *Pool) warmup(ctx context.Context) {
	for _, lang := range p.supportedLanguages {
		p.mu.Lock()
		idleCount := len(p.idle[lang])
		totalCount := len(p.containers) + p.totalCreating()
		p.mu.Unlock()

		needed := p.cfg.MinIdle - idleCount
		if needed <= 0 {
			continue
		}

		// Don't exceed MaxTotal across all languages.
		if totalCount+needed > p.cfg.MaxTotal {
			needed = p.cfg.MaxTotal - totalCount
		}
		if needed <= 0 {
			continue
		}

		p.logger.Info("warming up containers",
			"language", lang,
			"count", needed,
			"current_idle", idleCount,
		)

		for i := 0; i < needed; i++ {
			if err := p.createIdleContainer(ctx, lang, 2); err != nil {
				p.logger.Error("failed to create warmup container",
					"language", lang,
					"error", err,
				)
				break // Don't spam on repeated failures.
			}
		}
	}
}

// totalCreating returns the total number of containers currently being created.
// Must be called with p.mu held.
func (p *Pool) totalCreating() int {
	total := 0
	for _, n := range p.creating {
		total += n
	}
	return total
}

// warmupLoop runs the warmup process periodically.
func (p *Pool) warmupLoop(ctx context.Context) {
	ticker := time.NewTicker(p.cfg.WarmupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-p.done:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.warmup(ctx)
		}
	}
}

// healthCheckLoop periodically verifies that idle containers are still healthy.
func (p *Pool) healthCheckLoop(ctx context.Context) {
	interval := p.cfg.HealthCheckInterval
	if interval <= 0 {
		interval = 60 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-p.done:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.runHealthChecks(ctx)
		}
	}
}

// runHealthChecks iterates over all idle containers and checks their health.
// Unhealthy or expired containers are destroyed and removed from the pool.
func (p *Pool) runHealthChecks(ctx context.Context) {
	p.mu.Lock()
	// Collect idle containers to check (snapshot under lock).
	var toCheck []*SandboxContainer
	for _, containers := range p.idle {
		for _, c := range containers {
			toCheck = append(toCheck, c)
		}
	}
	p.mu.Unlock()

	for _, container := range toCheck {
		// Check expiration.
		if container.IsExpired(p.cfg.MaxContainerAge, p.cfg.MaxContainerUses) {
			p.logger.Info("destroying expired container",
				"container_id", container.ID,
				"language", container.Language,
				"age", time.Since(container.CreatedAt),
				"uses", container.GetUseCount(),
			)
			p.destroyAndRemove(ctx, container)
			continue
		}

		// Run health check.
		if err := HealthCheck(ctx, p.manager, container); err != nil {
			p.logger.Warn("destroying unhealthy container",
				"container_id", container.ID,
				"error", err,
			)
			p.destroyAndRemove(ctx, container)
		}
	}
}

// createIdleContainer creates a new container and adds it to the idle pool.
func (p *Pool) createIdleContainer(ctx context.Context, language string, tier int) error {
	containerID, err := p.manager.CreateContainer(ctx, language, tier)
	if err != nil {
		return fmt.Errorf("creating container for %s: %w", language, err)
	}

	imageName := p.runtimeImages[language]
	container := NewSandboxContainer(containerID, language, tier, imageName)
	container.MarkIdle()

	p.mu.Lock()
	p.containers[containerID] = container
	p.idle[language] = append(p.idle[language], container)
	p.mu.Unlock()

	p.logger.Debug("created idle container",
		"container_id", containerID,
		"language", language,
	)

	return nil
}

// Acquire obtains a container for code execution. It first tries to find an idle
// container for the requested language. If none is available and the pool hasn't
// reached max capacity, it creates a new one on-demand.
//
// Race condition prevention: We atomically check capacity and increment the
// "creating" counter while holding the lock. This prevents concurrent goroutines
// from both seeing totalCount < MaxTotal and both creating containers, which would
// exceed the limit.
func (p *Pool) Acquire(ctx context.Context, language string, tier int) (*SandboxContainer, error) {
	p.mu.Lock()

	// Try to find an idle container for this language.
	if idle, ok := p.idle[language]; ok && len(idle) > 0 {
		// Pop from the end (LIFO for better cache locality).
		container := idle[len(idle)-1]
		p.idle[language] = idle[:len(idle)-1]
		container.MarkInUse()
		p.mu.Unlock()

		p.logger.Debug("acquired idle container",
			"container_id", container.ID,
			"language", language,
			"use_count", container.GetUseCount(),
		)
		return container, nil
	}

	// Check if we have capacity for a new container.
	// totalCount includes containers being created right now (creating[lang])
	// to prevent concurrent goroutines from both seeing room and both creating.
	totalCount := len(p.containers) + p.totalCreating()
	if totalCount >= p.cfg.MaxTotal {
		p.mu.Unlock()
		return nil, fmt.Errorf("container pool exhausted: %d/%d containers in use or being created",
			totalCount, p.cfg.MaxTotal)
	}

	// Reserve a slot by incrementing the creating counter — still under the lock.
	// This ensures no other goroutine can claim this slot before we create the container.
	p.creating[language]++
	p.mu.Unlock()

	p.logger.Info("no idle containers available, creating on demand",
		"language", language,
		"tier", tier,
	)

	// Create a new container (outside the lock — this is a slow network call).
	containerID, err := p.manager.CreateContainer(ctx, language, tier)

	// Always decrement the creating counter when done, success or failure.
	p.mu.Lock()
	p.creating[language]--
	if p.creating[language] < 0 {
		p.creating[language] = 0 // Safety guard.
	}
	p.mu.Unlock()

	if err != nil {
		return nil, fmt.Errorf("creating on-demand container: %w", err)
	}

	imageName := p.runtimeImages[language]
	container := NewSandboxContainer(containerID, language, tier, imageName)
	container.MarkInUse()

	p.mu.Lock()
	p.containers[containerID] = container
	p.mu.Unlock()

	return container, nil
}

// Release returns a container back to the pool after execution.
// If tainted is true (e.g., the execution failed in a way that could have
// corrupted the container state), the container is destroyed instead of reused.
func (p *Pool) Release(ctx context.Context, container *SandboxContainer, tainted bool) {
	if tainted || container.IsExpired(p.cfg.MaxContainerAge, p.cfg.MaxContainerUses) {
		reason := "tainted"
		if container.IsExpired(p.cfg.MaxContainerAge, p.cfg.MaxContainerUses) {
			reason = "expired"
		}
		p.logger.Info("destroying container instead of returning to pool",
			"container_id", container.ID,
			"reason", reason,
		)
		p.destroyAndRemove(ctx, container)
		return
	}

	// Reset the container to a clean state.
	if err := p.manager.ResetContainer(ctx, container.ID); err != nil {
		p.logger.Warn("failed to reset container, destroying",
			"container_id", container.ID,
			"error", err,
		)
		p.destroyAndRemove(ctx, container)
		return
	}

	container.MarkIdle()

	p.mu.Lock()
	p.idle[container.Language] = append(p.idle[container.Language], container)
	p.mu.Unlock()

	p.logger.Debug("released container back to pool",
		"container_id", container.ID,
		"language", container.Language,
	)
}

// destroyAndRemove removes a container from all pool tracking and destroys it.
func (p *Pool) destroyAndRemove(ctx context.Context, container *SandboxContainer) {
	container.MarkDestroying()

	p.mu.Lock()
	delete(p.containers, container.ID)
	// Remove from idle list if present.
	if idle, ok := p.idle[container.Language]; ok {
		for i, c := range idle {
			if c.ID == container.ID {
				p.idle[container.Language] = append(idle[:i], idle[i+1:]...)
				break
			}
		}
	}
	p.mu.Unlock()

	// Best-effort destruction — log but don't fail.
	if err := p.manager.DestroyContainer(ctx, container.ID); err != nil {
		p.logger.Error("failed to destroy container",
			"container_id", container.ID,
			"error", err,
		)
	}
}

// Metrics returns a snapshot of the current pool state.
func (p *Pool) Metrics() PoolMetrics {
	p.mu.Lock()
	defer p.mu.Unlock()

	metrics := PoolMetrics{
		Languages: make(map[string]LanguageMetrics),
		MaxTotal:  p.cfg.MaxTotal,
	}

	// Count per-language states.
	langIdle := make(map[string]int)
	langInUse := make(map[string]int)
	langTotal := make(map[string]int)

	for _, c := range p.containers {
		langTotal[c.Language]++
		switch c.GetState() {
		case ContainerIdle:
			langIdle[c.Language]++
		case ContainerInUse:
			langInUse[c.Language]++
		}
	}

	for _, lang := range p.supportedLanguages {
		lm := LanguageMetrics{
			Idle:     langIdle[lang],
			InUse:    langInUse[lang],
			Creating: p.creating[lang],
			Total:    langTotal[lang] + p.creating[lang],
		}
		metrics.Languages[lang] = lm
		metrics.TotalIdle += lm.Idle
		metrics.TotalInUse += lm.InUse
		metrics.TotalContainers += lm.Total
	}

	return metrics
}

// Shutdown gracefully destroys all containers in the pool.
// It signals background goroutines to stop and waits for them to finish.
func (p *Pool) Shutdown(ctx context.Context) {
	p.logger.Info("shutting down container pool")

	// Signal background goroutines to stop.
	close(p.done)

	// Wait for background goroutines to finish.
	p.wg.Wait()

	// Destroy all remaining containers.
	p.mu.Lock()
	containers := make([]*SandboxContainer, 0, len(p.containers))
	for _, c := range p.containers {
		containers = append(containers, c)
	}
	p.containers = make(map[string]*SandboxContainer)
	p.idle = make(map[string][]*SandboxContainer)
	p.mu.Unlock()

	for _, c := range containers {
		p.logger.Info("destroying container during shutdown",
			"container_id", c.ID,
			"language", c.Language,
		)
		if err := p.manager.DestroyContainer(ctx, c.ID); err != nil {
			p.logger.Error("failed to destroy container during shutdown",
				"container_id", c.ID,
				"error", err,
			)
		}
	}

	p.logger.Info("container pool shutdown complete",
		"destroyed", len(containers),
	)
}

// Healthy returns true if the pool is operational (has at least one idle container
// or can create new ones).
func (p *Pool) Healthy() bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	totalIdle := 0
	for _, containers := range p.idle {
		totalIdle += len(containers)
	}

	totalCount := len(p.containers) + p.totalCreating()
	return totalIdle > 0 || totalCount < p.cfg.MaxTotal
}
