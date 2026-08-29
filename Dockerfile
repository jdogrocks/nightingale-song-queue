FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server/ ./server/
COPY public/ ./public/
COPY DESIGN.md ./

ENV NODE_ENV=production
ENV DATA_FILE=/data/state.json
ENV PORT=7464

RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 7464
VOLUME /data

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||7464)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node","server/index.js"]
