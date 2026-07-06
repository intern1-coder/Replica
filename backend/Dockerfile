# Build stage
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install openssl for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Browsers are installed in the production stage, not here
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies (including devDependencies for tsc)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-bookworm-slim AS production

WORKDIR /app

# Install production dependencies: openssl (for Prisma), postgresql-client (for pg_dump backups)
RUN apt-get update && apt-get install -y \
    openssl \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy built artifacts and production package files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Install Playwright's pinned Chromium + its system dependencies.
# Debian's apt chromium crashes (SIGTRAP) on arm64/Graviton; Playwright ships
# official linux-arm64 builds matched to the library version.
RUN npx playwright install --with-deps chromium
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/assets ./assets

# Expose port
EXPOSE 3000

# Start command
# We use node directly or PM2 if we choose to run PM2 inside the container
# For now, node is fine as Docker handles process supervision, but PM2 is requested in Phase 5.
# If PM2 is used, we can install it globally and use pm2-runtime.
# For standard Docker, node dist/server.js is preferred. We will let the ecosystem file or docker-compose decide.
CMD ["node", "dist/server.js"]
