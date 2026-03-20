FROM node:22.19.0-trixie

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY index.js ./
COPY embedder.js ./
COPY backend-api.js ./
COPY retriever-api.js ./
COPY src ./src
COPY migrations ./migrations

RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home ai
RUN mkdir -p /app/state && chown -R ai:nodejs /app

USER ai

ENV APP_ROLE=retriever
CMD ["sh", "-c", "if [ \"$APP_ROLE\" = \"embedder\" ]; then node embedder.js; elif [ \"$APP_ROLE\" = \"backend\" ]; then node backend-api.js; else node index.js; fi"]
