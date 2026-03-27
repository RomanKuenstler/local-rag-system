FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY index.html ./
COPY styles.css ./
COPY fonts ./fonts
COPY app.js ./
COPY app-shared.js ./
COPY api-client.js ./
COPY utils.js ./
COPY panel-content.js ./
COPY chat-export.js ./

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

ENV UPSTREAM_API_URL=http://retriever:3000

EXPOSE 80
