# React frontend for local runs (PRD §12.1, Issue 016): build with npm ci, serve with nginx.
# Production runs on Vercel (ADR 0007). Node 24 LTS replaces PRD §12.1's end-of-life Node 20 (Q-12).

FROM node:24.22.1-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
# Empty means same origin: nginx proxies /api to the backend. Set it to call an API directly.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.30.6-alpine3.24
ENV PORT=8080 \
    API_UPSTREAM=http://backend:8000 \
    NGINX_ENVSUBST_FILTER="^(PORT|API_UPSTREAM)$"
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/" || exit 1
