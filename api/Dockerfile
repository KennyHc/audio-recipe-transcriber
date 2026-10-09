# Cloud Run image for the API. Build dist/ first: `npm run build -w api` (scripts/deploy-api.sh does).
FROM node:24-slim

ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
WORKDIR /app

COPY package.json ./
# Only runtime deps. Dev deps are deleted from the manifest first because one of them
# (@recipe/shared) is a workspace package that isn't on the npm registry; it's already
# bundled into dist/server.js.
RUN npm pkg delete devDependencies scripts \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY dist ./dist

USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server.js"]
