# =========================================
# SkillForge Sandbox - Python Execution Image
# =========================================
# This image provides a secure Python runtime for executing
# user-submitted code inside the sandbox.
#
# Security features:
# - Non-root user (sandbox, uid=65534)
# - pip/setuptools removed (no runtime package installation)
# - Compiler tools removed
# - Minimal attack surface
# =========================================

FROM python:3.12-slim AS base

LABEL maintainer="SkillForge Team"
LABEL org.opencontainers.image.title="SkillForge Sandbox Python"
LABEL org.opencontainers.image.description="Secure Python execution environment for SkillForge AI Agent platform"
LABEL skillforge.sandbox.type="python"
LABEL skillforge.sandbox.managed="true"

# Create non-privileged sandbox user
RUN groupadd -r sandbox && \
    useradd -r -g sandbox -u 10001 -d /home/sandbox -s /usr/sbin/nologin sandbox

# Install system dependencies needed by scientific Python packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libgomp1 \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender1 \
        libfontconfig1 \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# ============================================
# Tier 2 Python packages (data analysis stack)
# ============================================
RUN pip install --no-cache-dir \
    # Data manipulation
    pandas==2.2.3 \
    numpy==2.1.3 \
    openpyxl==3.1.5 \
    # Visualization
    matplotlib==3.9.3 \
    seaborn==0.13.2 \
    Pillow==11.0.0 \
    # Scientific computing
    scipy==1.14.1 \
    scikit-learn==1.5.2 \
    # Utilities
    tabulate==0.9.0 \
    python-dateutil==2.9.0 \
    && pip cache purge

# ==========================================
# Security hardening
# ==========================================

# Remove pip and package management tools to prevent runtime installation
RUN python -m pip uninstall -y pip setuptools wheel 2>/dev/null || true && \
    rm -rf /usr/local/bin/pip* \
           /usr/local/bin/easy_install* \
           /usr/local/lib/python*/ensurepip \
           /usr/local/lib/python*/distutils \
           /usr/local/lib/python*/lib2to3

# Remove compilers and build tools
RUN apt-get purge -y --auto-remove \
    gcc g++ cpp make binutils 2>/dev/null || true && \
    rm -rf /var/lib/apt/lists/*

# Remove potentially dangerous system utilities
RUN rm -f /usr/bin/wget /usr/bin/curl /usr/bin/nc /usr/bin/ncat \
          /usr/bin/ssh /usr/bin/scp /usr/bin/sftp \
          /usr/bin/apt /usr/bin/apt-get /usr/bin/dpkg \
    2>/dev/null || true

# Create workspace directory structure
RUN mkdir -p /workspace/code /workspace/input /workspace/output && \
    chown -R sandbox:sandbox /workspace && \
    chmod 755 /workspace

# Copy the execution wrapper (immutable)
COPY wrapper.py /opt/sandbox/wrapper.py
RUN chmod 444 /opt/sandbox/wrapper.py && \
    chown root:root /opt/sandbox/wrapper.py

# ==========================================
# Runtime environment
# ==========================================

# Use Agg backend for matplotlib (no display needed)
ENV MPLBACKEND=Agg
# Don't create .pyc files
ENV PYTHONDONTWRITEBYTECODE=1
# Force unbuffered stdout/stderr
ENV PYTHONUNBUFFERED=1
# Disable hash randomization for reproducibility
ENV PYTHONHASHSEED=0
# Set locale
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Switch to sandbox user
USER sandbox
WORKDIR /workspace

# Container stays alive waiting for docker exec commands
# The sandbox service will exec commands into this running container
CMD ["sleep", "infinity"]
