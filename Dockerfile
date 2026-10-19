# Stage 1: Build & Dependencies
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

# Stage 2: Production Runtime
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

# Install wget for healthcheck
RUN apk add --no-cache wget

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/prisma ./prisma
COPY package*.json ./
COPY src ./src
COPY openapi.yaml ./

USER appuser

EXPOSE 3000

CMD ["node", "src/server.js"]
