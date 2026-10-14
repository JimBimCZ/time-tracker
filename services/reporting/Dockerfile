FROM node:24.20.0-bookworm-slim AS build
RUN npm install -g pnpm@12.8.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @tt/reporting...
RUN pnpm --filter @tt/reporting build
RUN pnpm --filter @tt/reporting deploy --prod /out

FROM node:24.20.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/services/reporting/dist ./dist
USER node
CMD ["node", "dist/main.js"]
