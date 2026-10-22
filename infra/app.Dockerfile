# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS source
ENV CI=true \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN npm install --global pnpm@11.5.2
COPY . .
# Git hooks have no role in image builds, including production-only installs.
RUN node --input-type=module -e 'import fs from "node:fs"; const manifest = JSON.parse(fs.readFileSync("package.json", "utf8")); delete manifest.scripts.prepare; fs.writeFileSync("package.json", JSON.stringify(manifest));'

FROM source AS dependencies
RUN --mount=type=cache,id=ai-harness-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM dependencies AS api-build
RUN pnpm build:api
# Keep the workspace paths so pnpm's relative links resolve in the runtime image.
# Only compiled application code, package metadata and runtime locale data are copied.
RUN mkdir -p /output \
    && cp package.json /output/package.json \
    && for directory in apps/api packages/contracts packages/db packages/core/*; do \
        if [ -f "$directory/package.json" ]; then \
            mkdir -p "/output/$directory"; \
            cp "$directory/package.json" "/output/$directory/package.json"; \
            for asset in lib locale; do \
                if [ -d "$directory/$asset" ]; then \
                    cp -a "$directory/$asset" "/output/$directory/$asset"; \
                fi; \
            done; \
        fi; \
    done

FROM source AS api-dependencies
# Linked Cordis workspaces declare runtime peers alongside dev dependencies.
# Let pnpm expose the locked production graph at the workspace root so those peers resolve.
RUN --mount=type=cache,id=ai-harness-pnpm,target=/pnpm/store \
    pnpm --filter @ai-harness/api... install --prod --frozen-lockfile --shamefully-hoist --store-dir /pnpm/store
RUN mkdir -p /output \
    && cp -a node_modules /output/node_modules \
    && for directory in apps/api packages/contracts packages/db packages/core/*; do \
        if [ -d "$directory/node_modules" ]; then \
            mkdir -p "/output/$directory"; \
            cp -a "$directory/node_modules" "/output/$directory/node_modules"; \
        fi; \
    done
COPY --from=api-build /output /output

FROM dependencies AS web-build
ENV HARNESS_STANDALONE=true
RUN pnpm build:web

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001
WORKDIR /app
COPY --from=api-dependencies --chown=node:node /output ./
USER node
# Validate runtime imports as the production user without connecting to external services.
RUN node --input-type=module -e 'await import("./apps/api/lib/app.js")'
EXPOSE 3001
CMD ["node", "apps/api/lib/main.js"]

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
