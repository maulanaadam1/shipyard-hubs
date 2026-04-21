# Stage 1: Install dependencies & Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install native build tools required by better-sqlite3 (Python, Make, GCC)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Prune devDependencies so we don't carry them over, 
# while keeping the successfully compiled better-sqlite3 binary.
RUN npm prune --omit=dev

# Stage 2: Production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy configuration and pre-built node_modules
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy built frontend and server backend
COPY --from=builder /app/dist ./dist
COPY server.js ./

EXPOSE 3000

ENV PORT=3000

# Server JS will handle both API and serving dist/
CMD ["node", "server.js"]
