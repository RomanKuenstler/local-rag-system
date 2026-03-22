FROM node:22.19.0-trixie

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY apps ./apps
COPY shared ./shared
COPY migrations ./migrations
COPY ./shared/prompts/guardrails.md ./guardrails.md

RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home ai
RUN mkdir -p /app/state && chown -R ai:nodejs /app

USER ai

ENV APP_ROLE=retriever
CMD ["sh", "-c", "if [ \"$APP_ROLE\" = \"embedder\" ]; then node apps/embedder/worker.js; elif [ \"$APP_ROLE\" = \"backend\" ]; then node apps/backend/api.js; else node apps/retriever/api.js; fi"]
