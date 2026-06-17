// Package pool manages the lifecycle of individual sandbox containers.
package pool

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// ContainerState represents the current state of a sandbox container.
type ContainerState int

const (
	// ContainerIdle means the container is warm and available for use.
	ContainerIdle ContainerState = iota

	// ContainerInUse means the container is currently executing code.
	ContainerInUse

	// ContainerInitializing means the container is being created.
	ContainerInitializing

	// ContainerDestroying means the container is being torn down.
	ContainerDestroying
)

// String returns a human-readable name for the container state.
func (s ContainerState) String() string {
	switch s {
	case ContainerIdle:
		return "idle"
	case ContainerInUse:
		return "in_use"
	case ContainerInitializing:
		return "initializing"
	case ContainerDestroying:
		return "destroying"
	default:
		return "unknown"
	}
}

// SandboxContainer represents a Docker container used for code execution.
// Each container is created from a language-specific base image and may be
// reused across multiple executions (up to MaxUses).
type SandboxContainer struct {
	mu sync.RWMutex

	// ID is the Docker container ID (short form).
	ID string

	// Language is the runtime language (e.g., "python", "javascript").
	Language string

	// Tier is the security tier this container was created for.
	Tier int

	// State is the current lifecycle state.
	State ContainerState

	// CreatedAt is when the container was created.
	CreatedAt time.Time

	// LastUsedAt is the most recent time the container was used for execution.
	LastUsedAt time.Time

	// UseCount tracks how many times this container has been used.
	UseCount int

	// ImageName is the Docker image used to create this container.
	ImageName string
}

// NewSandboxContainer creates a new SandboxContainer record.
// The container is initially in the Initializing state.
func NewSandboxContainer(id, language string, tier int, imageName string) *SandboxContainer {
	now := time.Now()
	return &SandboxContainer{
		ID:        id,
		Language:  language,
		Tier:      tier,
		State:     ContainerInitializing,
		CreatedAt: now,
		LastUsedAt: now,
		ImageName: imageName,
	}
}

// MarkIdle transitions the container to the Idle state.
func (c *SandboxContainer) MarkIdle() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.State = ContainerIdle
}

// MarkInUse transitions the container to the InUse state and bumps usage counters.
func (c *SandboxContainer) MarkInUse() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.State = ContainerInUse
	c.UseCount++
	c.LastUsedAt = time.Now()
}

// MarkDestroying transitions the container to the Destroying state.
func (c *SandboxContainer) MarkDestroying() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.State = ContainerDestroying
}

// GetState returns the current state of the container (thread-safe).
func (c *SandboxContainer) GetState() ContainerState {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.State
}

// GetUseCount returns the current use count (thread-safe).
func (c *SandboxContainer) GetUseCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.UseCount
}

// IsExpired checks if the container has exceeded its maximum age or use count.
func (c *SandboxContainer) IsExpired(maxAge time.Duration, maxUses int) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if maxAge > 0 && time.Since(c.CreatedAt) > maxAge {
		return true
	}
	if maxUses > 0 && c.UseCount >= maxUses {
		return true
	}
	return false
}

// ContainerManager defines the interface for creating, resetting, and destroying containers.
// This is implemented by the Docker client wrapper in the executor package.
type ContainerManager interface {
	// CreateContainer creates a new Docker container for the given language and tier.
	// Returns the container ID.
	CreateContainer(ctx context.Context, language string, tier int) (string, error)

	// ResetContainer resets the container to a clean state by removing workspace files.
	ResetContainer(ctx context.Context, containerID string) error

	// DestroyContainer removes and deletes the container.
	DestroyContainer(ctx context.Context, containerID string) error

	// HealthCheck verifies the container is still responsive.
	HealthCheck(ctx context.Context, containerID string) error
}

// HealthCheck performs a liveness check by executing 'echo ok' inside the container.
// It uses the ContainerManager to issue the check.
func HealthCheck(ctx context.Context, manager ContainerManager, container *SandboxContainer) error {
	if container.GetState() == ContainerDestroying {
		return fmt.Errorf("container %s is being destroyed", container.ID)
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := manager.HealthCheck(ctx, container.ID); err != nil {
		slog.Warn("container health check failed",
			"container_id", container.ID,
			"language", container.Language,
			"error", err,
		)
		return fmt.Errorf("health check failed for container %s: %w", container.ID, err)
	}

	return nil
}
