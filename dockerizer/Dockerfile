# 1️⃣ Base image with Node.js 18 on Alpine
FROM node:18-alpine AS base

# 2️⃣ Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files and install dependencies
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
    if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm install --frozen-lockfile; \
    else echo "Lockfile not found." && exit 1; \
    fi

# 3️⃣ Build the Next.js application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry for privacy
ENV NEXT_TELEMETRY_DISABLED 1

# Ensure Next.js builds in standalone mode
RUN yarn build

# 4️⃣ Production Image (Minimal)
FROM base AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Ensure public and .next directories exist
RUN mkdir -p /app/public /app/.next && chown nextjs:nodejs /app/.next

# Copy built files only if they exist
COPY --from=builder /app/public ./public || true
COPY --from=builder /app/.next/static ./.next/static || true

# Copy standalone Next.js build if it exists
RUN test -d /app/.next/standalone && cp -r /app/.next/standalone . || echo "Standalone build not found, skipping."

# Use non-root user for security
USER nextjs

# Expose port 3000
EXPOSE 3000
ENV HOSTNAME "0.0.0.0"

# Run the standalone Next.js server
CMD ["node", "server.js"]
