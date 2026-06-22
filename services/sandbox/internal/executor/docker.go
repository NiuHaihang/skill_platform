// Package executor provides the Docker client wrapper for container management.
// It handles container creation with security configurations, file copy operations,
// command execution, and resource limit enforcement.
package executor

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"

	"github.com/skillforge/sandbox/internal/config"
	"github.com/skillforge/sandbox/internal/security"
)

// DockerClient wraps the Docker SDK client with sandbox-specific operations.
type DockerClient struct {
	cli    *client.Client
	cfg    *config.Config
	logger *slog.Logger
}

// NewDockerClient creates a new DockerClient using the default Docker socket.
func NewDockerClient(cfg *config.Config, logger *slog.Logger) (*DockerClient, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("creating docker client: %w", err)
	}

	// Verify connectivity.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if _, err := cli.Ping(ctx); err != nil {
		cli.Close()
		return nil, fmt.Errorf("docker daemon not reachable: %w", err)
	}

	if logger == nil {
		logger = slog.Default()
	}

	return &DockerClient{
		cli:    cli,
		cfg:    cfg,
		logger: logger,
	}, nil
}

// Close closes the underlying Docker client connection.
func (d *DockerClient) Close() error {
	return d.cli.Close()
}

// CreateContainer creates a new Docker container configured for the given language and tier.
// The container is created but not started — it will be started on first exec.
func (d *DockerClient) CreateContainer(ctx context.Context, language string, tier int) (string, error) {
	rtCfg, err := d.cfg.GetRuntimeConfig(language)
	if err != nil {
		return "", err
	}

	policy, err := security.GetPolicy(tier)
	if err != nil {
		return "", err
	}

	containerCfg := d.buildContainerConfig(rtCfg, policy)
	hostCfg := d.buildHostConfig(policy)
	netCfg := d.buildNetworkConfig(policy)

	// Generate a unique container name.
	containerName := fmt.Sprintf("sandbox-%s-tier%d-%d", language, tier, time.Now().UnixNano())

	resp, err := d.cli.ContainerCreate(ctx, containerCfg, hostCfg, netCfg, nil, containerName)
	if err != nil {
		return "", fmt.Errorf("creating container: %w", err)
	}

	// Start the container immediately so it's warm and ready.
	if err := d.cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		// Clean up the created container if start fails.
		_ = d.cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
		return "", fmt.Errorf("starting container: %w", err)
	}

	d.logger.Info("created sandbox container",
		"container_id", resp.ID[:12],
		"language", language,
		"tier", tier,
		"image", rtCfg.Image,
	)

	return resp.ID, nil
}

// buildContainerConfig creates the container configuration with security settings.
func (d *DockerClient) buildContainerConfig(rt config.RuntimeConfig, policy security.TierPolicy) *container.Config {
	return &container.Config{
		Image: rt.Image,
		// Create workspace subdirectories then keep the container alive.
		// Runs as root (default) to set up the tmpfs workspace, then exec
		// commands run as the sandbox user (10001) via ExecOptions.User.
		Cmd: []string{"sh", "-c",
			"mkdir -p /workspace/code /workspace/input /workspace/output && " +
				"chmod 755 /workspace/code /workspace/input /workspace/output && " +
				"sleep infinity",
		},
		WorkingDir: "/workspace",
		// NOTE: No User set here — init runs as root to create dirs on tmpfs.
		// Exec commands set User: "10001:10001" individually.
		Env: []string{
			"HOME=/tmp",
			"PYTHONDONTWRITEBYTECODE=1",
			"NODE_ENV=production",
		},
		// Disable networking at config level for tier 1 and 2.
		NetworkDisabled: !policy.NetworkEnabled,
	}
}

// buildHostConfig creates the host configuration with resource limits and security options.
func (d *DockerClient) buildHostConfig(policy security.TierPolicy) *container.HostConfig {
	hc := &container.HostConfig{
		Resources: container.Resources{
			// Hard memory limit. The kernel OOM killer will terminate the process
			// if this limit is exceeded — there is no swap.
			Memory:     policy.MemoryLimitBytes,
			MemorySwap: policy.MemoryLimitBytes, // Same as Memory = no swap.

			// CPU limit expressed as nano-CPUs (1 CPU = 1e9 nano-CPUs).
			NanoCPUs: int64(policy.CPUCount) * 1e9,

			// PID limit prevents fork bombs.
			PidsLimit: &policy.MaxPIDs,
		},

		// Security options.
		SecurityOpt: []string{
			"no-new-privileges:true", // Prevent privilege escalation via setuid binaries.
		},

		// Read-only root filesystem. All writes go through tmpfs mounts.
		ReadonlyRootfs: policy.ReadOnlyRootfs,

		// Drop all Linux capabilities. The sandbox user needs none.
		CapDrop: policy.DropCapabilities,

		// No privileged mode, ever.
		Privileged: false,

		// Automatic removal is handled by pool management, not Docker.
		AutoRemove: false,

		// Apply seccomp profile if configured.
		// If empty string, Docker's default profile is used (which is already restrictive).
	}

	// Add tmpfs mounts for writable directories.
	// tmpfs lives in memory and is automatically cleaned up when the container stops.
	for _, mountPath := range policy.TmpfsMounts {
		sizeBytes := int64(policy.TmpfsSizeMB) * 1024 * 1024
		hc.Mounts = append(hc.Mounts, mount.Mount{
			Type:   mount.TypeTmpfs,
			Target: mountPath,
			TmpfsOptions: &mount.TmpfsOptions{
				SizeBytes: sizeBytes,
				Mode:      0755,
			},
		})
	}

	// Add seccomp profile path if configured.
	if policy.SeccompProfile != "" {
		hc.SecurityOpt = append(hc.SecurityOpt,
			fmt.Sprintf("seccomp=%s", policy.SeccompProfile),
		)
	}

	return hc
}

// buildNetworkConfig creates the network configuration.
// Tier 1 and 2: no network. Tier 3: default network (with proxy).
func (d *DockerClient) buildNetworkConfig(policy security.TierPolicy) *network.NetworkingConfig {
	if !policy.NetworkEnabled {
		return &network.NetworkingConfig{}
	}
	// For Tier 3, use the default bridge network.
	// In production, this would use a custom network with a filtering proxy.
	return &network.NetworkingConfig{}
}

// CopyToContainer copies files into the container at the specified path.
// Files are packaged as a tar archive for the Docker API.
func (d *DockerClient) CopyToContainer(ctx context.Context, containerID, destPath string, files map[string][]byte) error {
	if len(files) == 0 {
		return nil
	}

	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	for name, content := range files {
		// Security: validate file names to prevent directory traversal.
		cleanName := filepath.Clean(name)
		if strings.Contains(cleanName, "..") {
			return fmt.Errorf("file name %q contains directory traversal", name)
		}

		hdr := &tar.Header{
			Name:    cleanName,
			Mode:    0644,
			Size:    int64(len(content)),
			ModTime: time.Now(),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return fmt.Errorf("writing tar header for %q: %w", name, err)
		}
		if _, err := tw.Write(content); err != nil {
			return fmt.Errorf("writing tar content for %q: %w", name, err)
		}
	}

	if err := tw.Close(); err != nil {
		return fmt.Errorf("closing tar writer: %w", err)
	}

	err := d.cli.CopyToContainer(ctx, containerID, destPath, &buf, container.CopyToContainerOptions{})
	if err != nil {
		return fmt.Errorf("copying files to container %s at %s: %w", containerID[:12], destPath, err)
	}

	d.logger.Debug("copied files to container",
		"container_id", containerID[:12],
		"dest_path", destPath,
		"file_count", len(files),
	)

	return nil
}

// CopyFromContainer extracts files from the container at the specified path.
// Returns a map of filename -> content.
func (d *DockerClient) CopyFromContainer(ctx context.Context, containerID, srcPath string) (map[string][]byte, error) {
	reader, _, err := d.cli.CopyFromContainer(ctx, containerID, srcPath)
	if err != nil {
		// If the path doesn't exist, return empty (no output files is normal).
		if strings.Contains(err.Error(), "No such container:path") ||
			strings.Contains(err.Error(), "not found") {
			return nil, nil
		}
		return nil, fmt.Errorf("copying from container %s at %s: %w", containerID[:12], srcPath, err)
	}
	defer reader.Close()

	files := make(map[string][]byte)
	tr := tar.NewReader(reader)

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading tar entry: %w", err)
		}

		// Skip directories and hidden files (like .meta.json).
		if header.Typeflag == tar.TypeDir {
			continue
		}

		// Extract just the filename (strip leading path components from the tar).
		name := filepath.Base(header.Name)
		if strings.HasPrefix(name, ".") {
			continue // Skip hidden files.
		}

		// Limit output file size to prevent memory exhaustion.
		const maxOutputFileSize = 50 * 1024 * 1024 // 50 MB per file.
		if header.Size > maxOutputFileSize {
			d.logger.Warn("skipping oversized output file",
				"file", name,
				"size", header.Size,
				"max", maxOutputFileSize,
			)
			continue
		}

		content, err := io.ReadAll(io.LimitReader(tr, maxOutputFileSize))
		if err != nil {
			return nil, fmt.Errorf("reading file %q from tar: %w", name, err)
		}

		files[name] = content
	}

	return files, nil
}

// ExecResult holds the output of a docker exec command.
type ExecResult struct {
	ExitCode int
	Stdout   string
	Stderr   string
}

// ExecInContainer runs a command inside the container and captures output.
// The context controls the execution timeout.
func (d *DockerClient) ExecInContainer(ctx context.Context, containerID string, cmd []string, env []string) (*ExecResult, error) {
	execCfg := container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
		Env:          env,
		WorkingDir:   "/workspace",
		// Run as the sandbox user (non-root).
		User: "10001:10001",
	}

	execResp, err := d.cli.ContainerExecCreate(ctx, containerID, execCfg)
	if err != nil {
		return nil, fmt.Errorf("creating exec in container %s: %w", containerID[:12], err)
	}

	attachResp, err := d.cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
	if err != nil {
		return nil, fmt.Errorf("attaching to exec in container %s: %w", containerID[:12], err)
	}
	defer attachResp.Close()

	// Read stdout and stderr concurrently.
	// Docker multiplexes stdout/stderr into a single stream with headers.
	var stdoutBuf, stderrBuf bytes.Buffer
	_, err = stdcopy.StdCopy(&stdoutBuf, &stderrBuf, attachResp.Reader)
	if err != nil {
		// Check if the error is due to context cancellation (timeout).
		if ctx.Err() != nil {
			return &ExecResult{
				ExitCode: -1,
				Stdout:   stdoutBuf.String(),
				Stderr:   stderrBuf.String(),
			}, ctx.Err()
		}
		return nil, fmt.Errorf("reading exec output: %w", err)
	}

	// Get the exit code.
	inspectResp, err := d.cli.ContainerExecInspect(ctx, execResp.ID)
	if err != nil {
		return nil, fmt.Errorf("inspecting exec result: %w", err)
	}

	return &ExecResult{
		ExitCode: inspectResp.ExitCode,
		Stdout:   stdoutBuf.String(),
		Stderr:   stderrBuf.String(),
	}, nil
}

// ResetContainer cleans the workspace directories inside the container
// to prepare it for reuse. This is faster than creating a new container.
func (d *DockerClient) ResetContainer(ctx context.Context, containerID string) error {
	// Clean all workspace subdirectories.
	cleanCmd := []string{
		"sh", "-c",
		"rm -rf /workspace/input/* /workspace/output/* /workspace/code/* /tmp/* 2>/dev/null; true",
	}

	// Use root user for cleanup since workspace dirs may have restricted permissions.
	execCfg := container.ExecOptions{
		Cmd:          cleanCmd,
		AttachStdout: false,
		AttachStderr: false,
		User:         "0:0", // Root for cleanup.
	}

	execResp, err := d.cli.ContainerExecCreate(ctx, containerID, execCfg)
	if err != nil {
		return fmt.Errorf("creating reset exec: %w", err)
	}

	if err := d.cli.ContainerExecStart(ctx, execResp.ID, container.ExecStartOptions{}); err != nil {
		return fmt.Errorf("starting reset exec: %w", err)
	}

	// Wait briefly for the cleanup to complete.
	deadline := time.After(5 * time.Second)
	for {
		select {
		case <-deadline:
			return fmt.Errorf("reset timed out after 5 seconds")
		case <-ctx.Done():
			return ctx.Err()
		default:
			inspect, err := d.cli.ContainerExecInspect(ctx, execResp.ID)
			if err != nil {
				return fmt.Errorf("inspecting reset exec: %w", err)
			}
			if !inspect.Running {
				if inspect.ExitCode != 0 {
					return fmt.Errorf("reset exited with code %d", inspect.ExitCode)
				}
				return nil
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
}

// DestroyContainer force-removes a container.
func (d *DockerClient) DestroyContainer(ctx context.Context, containerID string) error {
	err := d.cli.ContainerRemove(ctx, containerID, container.RemoveOptions{
		Force:         true,
		RemoveVolumes: true,
	})
	if err != nil {
		// Ignore "not found" errors — the container may already be gone.
		if strings.Contains(err.Error(), "No such container") {
			return nil
		}
		return fmt.Errorf("removing container %s: %w", containerID[:12], err)
	}

	d.logger.Debug("destroyed container", "container_id", containerID[:12])
	return nil
}

// HealthCheck verifies a container is responsive by exec'ing 'echo ok'.
func (d *DockerClient) HealthCheck(ctx context.Context, containerID string) error {
	result, err := d.ExecInContainer(ctx, containerID, []string{"echo", "ok"}, nil)
	if err != nil {
		return fmt.Errorf("health check exec failed: %w", err)
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("health check returned exit code %d", result.ExitCode)
	}
	if strings.TrimSpace(result.Stdout) != "ok" {
		return fmt.Errorf("health check unexpected output: %q", result.Stdout)
	}
	return nil
}

// GetContainerStats retrieves resource usage statistics for a container.
func (d *DockerClient) GetContainerStats(ctx context.Context, containerID string) (*ResourceUsage, error) {
	statsResp, err := d.cli.ContainerStatsOneShot(ctx, containerID)
	if err != nil {
		return nil, fmt.Errorf("getting container stats: %w", err)
	}
	defer statsResp.Body.Close()

	// Read the stats JSON. For simplicity, we return basic metrics.
	// In production, this would parse the full stats JSON.
	body, err := io.ReadAll(statsResp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading stats response: %w", err)
	}

	_ = body // Stats parsing would go here in production.

	// Return a placeholder — actual parsing requires decoding the Docker stats JSON.
	return &ResourceUsage{}, nil
}

// EncodeFilesToBase64 converts raw file bytes to base64-encoded strings.
func EncodeFilesToBase64(files map[string][]byte) map[string]string {
	result := make(map[string]string, len(files))
	for name, content := range files {
		result[name] = base64.StdEncoding.EncodeToString(content)
	}
	return result
}

// DecodeBase64Files converts base64-encoded strings to raw bytes.
func DecodeBase64Files(files map[string]string) (map[string][]byte, error) {
	result := make(map[string][]byte, len(files))
	for name, encoded := range files {
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("decoding file %q: %w", name, err)
		}
		result[name] = decoded
	}
	return result, nil
}
