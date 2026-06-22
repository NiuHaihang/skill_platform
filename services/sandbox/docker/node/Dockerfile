# =========================================
# SkillForge Sandbox - Node.js Execution Image
# =========================================
# Secure Node.js runtime for executing user-submitted
# JavaScript code inside the sandbox.
# =========================================

FROM node:20-slim AS base

LABEL maintainer="SkillForge Team"
LABEL org.opencontainers.image.title="SkillForge Sandbox Node.js"
LABEL org.opencontainers.image.description="Secure Node.js execution environment for SkillForge AI Agent platform"
LABEL skillforge.sandbox.type="node"
LABEL skillforge.sandbox.managed="true"

# Create non-privileged sandbox user
RUN groupadd -r sandbox && \
    useradd -r -g sandbox -u 10001 -d /home/sandbox -s /usr/sbin/nologin sandbox

# ============================================
# Tier 2 Node.js packages
# ============================================
RUN mkdir -p /opt/sandbox && \
    cd /opt/sandbox && \
    npm init -y && \
    npm install --no-save \
      lodash@4.17.21 \
      dayjs@1.11.13 \
      csv-parse@5.6.0 \
      csv-stringify@6.5.2 \
      xlsx@0.18.5 \
      uuid@10.0.0 \
      json2csv@6.0.0-alpha.2 \
    && npm cache clean --force

# Make pre-installed packages available
ENV NODE_PATH=/opt/sandbox/node_modules

# ==========================================
# Security hardening
# ==========================================

# Remove npm/npx/yarn to prevent runtime installation
RUN rm -rf /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/yarn \
           /usr/local/bin/corepack \
           /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
    2>/dev/null || true

# Remove potentially dangerous system utilities
RUN rm -f /usr/bin/wget /usr/bin/curl /usr/bin/nc /usr/bin/ncat \
          /usr/bin/ssh /usr/bin/scp /usr/bin/sftp \
          /usr/bin/apt /usr/bin/apt-get /usr/bin/dpkg \
    2>/dev/null || true

# Create workspace
RUN mkdir -p /workspace/code /workspace/input /workspace/output && \
    chown -R sandbox:sandbox /workspace && \
    chmod 755 /workspace

# Copy the execution wrapper (immutable)
COPY wrapper.js /opt/sandbox/wrapper.js
RUN chmod 444 /opt/sandbox/wrapper.js && \
    chown root:root /opt/sandbox/wrapper.js

# ==========================================
# Runtime environment
# ==========================================
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

USER sandbox
WORKDIR /workspace

CMD ["sleep", "infinity"]
