# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

# ---------- runtime: only the bundled output, no node_modules ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DB_SSLMODE=verify-full \
    DB_CA_FILE=/app/rds-ca.pem
WORKDIR /app
# Amazon RDS CA bundle, so the database certificate is verified (no MITM)
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
COPY --from=build --chown=node:node /app/dist ./
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]
