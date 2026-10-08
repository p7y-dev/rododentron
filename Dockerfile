FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY server.ts mcp.ts mcp-core.ts ecosystem.config.cjs ./

EXPOSE 3000 3001 6274 6277

CMD ["node_modules/.bin/pm2-runtime", "ecosystem.config.cjs"]
