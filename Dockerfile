# ============================================================================
# SGIS Backend — Dockerfile
# Multi-stage build for optimized production image
# ============================================================================

# Stage 1: Builder
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install bun (package manager used by project)
RUN npm install -g bun

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies with bun (faster than npm)
RUN bun install --frozen-lockfile

# Copy source code
COPY src ./src
COPY .env.example .env.example

# Stage 2: Runtime
# ============================================================================
FROM node:20-alpine

WORKDIR /app

# Install bun in runtime image
RUN npm install -g bun

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Copy from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./package.json
COPY --chown=nodejs:nodejs src ./src

# Create uploads directory for file storage
RUN mkdir -p uploads/documents uploads/plans uploads/red_copies uploads/stamps
RUN chown -R nodejs:nodejs uploads

# Switch to non-root user
USER nodejs

# Health check — ping the API every 30 seconds
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT:-4000}/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expose port (default 4000, can be overridden via env var)
EXPOSE 4000

# Default command — can be overridden
CMD ["bun", "src/index.js"]
