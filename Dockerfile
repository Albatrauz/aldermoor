# ---- Build stage: install all deps and bundle the client into dist/ ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Convex deployment URL for the browser client. Public, but must be present at
# BUILD time — Vite inlines it into the bundle. Pass via Coolify build arg.
ARG VITE_CONVEX_URL=""
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
RUN npm run build

# ---- Runtime stage: prod deps + server + built assets only ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY --from=build /app/dist ./dist
EXPOSE 4174
CMD ["node", "server.js"]
