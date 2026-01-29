# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/
COPY tsconfig.base.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY client ./client
COPY server ./server

# Build both client and server
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy package files and install production dependencies only
COPY package*.json ./
COPY server/package*.json ./server/
RUN npm ci --omit=dev --workspace=server
RUN npm install pm2 --save

# Copy built files
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist
COPY ecosystem.config.cjs ./

# Copy startup script
COPY scripts/start.sh ./scripts/
RUN chmod +x ./scripts/start.sh

# Create directories
RUN mkdir -p logs data server/uploads

# Environment variables (can be overridden)
ENV NODE_ENV=production
ENV PORT=3001

# Expose ports
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# Start with PM2
CMD ["pm2-runtime", "ecosystem.config.cjs", "--env", "production"]
