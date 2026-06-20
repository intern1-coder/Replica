# Build stage
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install openssl for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

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

# Install production dependencies: chromium (for puppeteer), openssl (for Prisma), postgresql-client (for pg_dump backups)
RUN apt-get update && apt-get install -y \
    chromium \
    openssl \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Set env variables for Puppeteer to use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy built artifacts and production package files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/templates ./templates

# Expose port
EXPOSE 3000

# Start command
# We use node directly or PM2 if we choose to run PM2 inside the container
# For now, node is fine as Docker handles process supervision, but PM2 is requested in Phase 5.
# If PM2 is used, we can install it globally and use pm2-runtime.
# For standard Docker, node dist/server.js is preferred. We will let the ecosystem file or docker-compose decide.
CMD ["node", "dist/server.js"]
