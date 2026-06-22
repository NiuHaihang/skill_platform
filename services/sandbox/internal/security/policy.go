// Package security defines security policies and tier-based resource limits.
package security

import (
	"fmt"
	"time"
)

// SecurityTier represents the security level for an execution.
// Higher tiers allow more resources and capabilities at the cost of broader attack surface.
type SecurityTier int

const (
	// TierRestricted is the most locked-down tier: no network, minimal resources.
	// Suitable for simple computations and data transformations.
	TierRestricted SecurityTier = 1

	// TierStandard allows moderate resources but still no direct network access.
	// Suitable for data analysis, file processing, and ML inference.
	TierStandard SecurityTier = 2

	// TierExtended allows network access (through a proxy), generous resources.
	// Suitable for web scraping, API calls, and long-running tasks.
	TierExtended SecurityTier = 3
)

// TierPolicy defines the complete set of security constraints for a tier.
type TierPolicy struct {
	// Tier is the security tier level.
	Tier SecurityTier

	// MemoryLimitBytes is the hard memory limit for the container.
	MemoryLimitBytes int64

	// CPUQuota is the number of CPU cores available (as NanoCPUs for Docker).
	CPUCount int

	// Timeout is the maximum wall-clock execution time.
	Timeout time.Duration

	// NetworkEnabled controls whether the container has network access.
	// When true, traffic is routed through a filtering proxy.
	NetworkEnabled bool

	// ReadOnlyRootfs makes the container's root filesystem read-only.
	// Writable areas are provided via tmpfs mounts.
	ReadOnlyRootfs bool

	// TmpfsSizeMB is the size limit for tmpfs mounts (in MB).
	TmpfsSizeMB int

	// TmpfsMounts lists the paths that should be mounted as tmpfs.
	TmpfsMounts []string

	// MaxPIDs limits the number of processes inside the container.
	// This prevents fork bombs and runaway process creation.
	MaxPIDs int64

	// SeccompProfile is the path to the seccomp profile JSON file.
	// If empty, Docker's default seccomp profile is used.
	SeccompProfile string

	// NoNewPrivileges prevents the process from gaining additional privileges
	// via setuid/setgid binaries or capabilities.
	NoNewPrivileges bool

	// DropCapabilities lists Linux capabilities to drop from the container.
	DropCapabilities []string
}

// tier1Policy is the most restrictive policy: computation only, no I/O beyond stdio.
var tier1Policy = TierPolicy{
	Tier:             TierRestricted,
	MemoryLimitBytes: 256 * 1024 * 1024, // 256 MB
	CPUCount:         1,
	Timeout:          30 * time.Second,
	NetworkEnabled:   false,
	ReadOnlyRootfs:   true,
	TmpfsSizeMB:      64,
	TmpfsMounts:      []string{"/tmp", "/workspace"},
	MaxPIDs:          50,
	NoNewPrivileges:  true,
	DropCapabilities: allCapabilities(),
}

// tier2Policy is the standard policy: moderate resources for data analysis.
var tier2Policy = TierPolicy{
	Tier:             TierStandard,
	MemoryLimitBytes: 512 * 1024 * 1024, // 512 MB
	CPUCount:         1,
	Timeout:          120 * time.Second,
	NetworkEnabled:   false,
	ReadOnlyRootfs:   true,
	TmpfsSizeMB:      256,
	TmpfsMounts:      []string{"/tmp", "/workspace"},
	MaxPIDs:          100,
	NoNewPrivileges:  true,
	DropCapabilities: allCapabilities(),
}

// tier3Policy is the extended policy: network access and generous resources.
var tier3Policy = TierPolicy{
	Tier:             TierExtended,
	MemoryLimitBytes: 2 * 1024 * 1024 * 1024, // 2 GB
	CPUCount:         2,
	Timeout:          1800 * time.Second,
	NetworkEnabled:   true,
	ReadOnlyRootfs:   true,
	TmpfsSizeMB:      1024,
	TmpfsMounts:      []string{"/tmp", "/workspace"},
	MaxPIDs:          200,
	NoNewPrivileges:  true,
	DropCapabilities: allCapabilities(),
}

// GetPolicy returns the security policy for the given tier.
func GetPolicy(tier int) (TierPolicy, error) {
	switch SecurityTier(tier) {
	case TierRestricted:
		return tier1Policy, nil
	case TierStandard:
		return tier2Policy, nil
	case TierExtended:
		return tier3Policy, nil
	default:
		return TierPolicy{}, fmt.Errorf("unknown security tier %d; valid tiers are 1, 2, 3", tier)
	}
}

// ValidateTier checks whether the requested tier is available and the requested
// capabilities (network, memory, etc.) are compatible with the tier.
func ValidateTier(tier int, requestedNetworkAccess bool, requestedMemoryMB int) error {
	policy, err := GetPolicy(tier)
	if err != nil {
		return err
	}

	if requestedNetworkAccess && !policy.NetworkEnabled {
		return fmt.Errorf("tier %d does not allow network access; use tier 3 for network-enabled execution", tier)
	}

	requestedMemoryBytes := int64(requestedMemoryMB) * 1024 * 1024
	if requestedMemoryBytes > policy.MemoryLimitBytes {
		return fmt.Errorf("tier %d allows max %d MB memory, but %d MB requested",
			tier, policy.MemoryLimitBytes/(1024*1024), requestedMemoryMB)
	}

	return nil
}

// allCapabilities returns the list of Linux capabilities to drop.
// We drop ALL capabilities to minimize the attack surface. The container runs as
// an unprivileged user with no special kernel powers.
func allCapabilities() []string {
	return []string{
		"ALL",
	}
}
