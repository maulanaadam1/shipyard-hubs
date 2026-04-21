# Stage 1: Install dependencies & Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Need better-sqlite3 build tools if we are moving node_modules, but we can just npm ci --prod
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend
COPY --from=builder /app/dist ./dist
# Copy source files needed for backend
COPY server.js ./
COPY --from=builder /app/components ./components

EXPOSE 3000

ENV PORT=3000

# Server JS will handle both API and serving dist/
CMD ["node", "server.js"]
