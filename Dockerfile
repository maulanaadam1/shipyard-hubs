# ============================================================
# Stage 1: Build React frontend
# ============================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ============================================================
# Stage 2: Build Go backend binary
# ============================================================
FROM golang:1.23-alpine AS go-builder
WORKDIR /go-server

# Install git (needed by some Go modules)
RUN apk add --no-cache git

COPY go-server/go.mod go-server/go.sum ./
RUN go mod download

COPY go-server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /shipyard-server .

# ============================================================
# Stage 3: Final minimal production image (~30MB)
# ============================================================
FROM alpine:3.19 AS runner

# Add CA certificates for HTTPS calls
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Asia/Jakarta

# Copy Go binary
COPY --from=go-builder /shipyard-server ./shipyard-server

# Copy built React frontend into dist/
COPY --from=frontend-builder /app/dist ./dist

# Create data directory for SQLite persistence
RUN mkdir -p /data /app/data

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/auth/session || exit 1

CMD ["./shipyard-server"]
