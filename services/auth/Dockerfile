FROM node:24.20.0-bookworm-slim AS build
RUN npm install -g pnpm@12.8.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @tt/auth...
RUN pnpm --filter @tt/auth build
RUN pnpm --filter @tt/auth deploy --prod /out

FROM node:24.20.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/services/auth/dist ./dist
USER node
CMD ["node", "dist/main.js"]
