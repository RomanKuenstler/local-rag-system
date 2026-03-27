FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY index.html ./
COPY styles.css ./
COPY app.js ./
COPY app-shared.js ./
COPY api-client.js ./
COPY utils.js ./
COPY panel-content.js ./
COPY chat-export.js ./

RUN npm run build \
  && mkdir -p /app/dist/licenses \
  && LICENSE_SOURCE="$(find /app/node_modules/@fontsource-variable/inter -maxdepth 2 -type f \( -iname 'OFL*' -o -iname 'LICENSE*' \) | head -n 1)" \
  && if [ -n "$LICENSE_SOURCE" ]; then \
      cp "$LICENSE_SOURCE" /app/dist/licenses/INTER-LICENSE.txt; \
    else \
      printf '%s\n' 'Inter font license file not found in package tree. See package metadata for license details.' > /app/dist/licenses/INTER-LICENSE.txt; \
    fi

FROM nginx:1.27-alpine

COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

ENV UPSTREAM_API_URL=http://retriever:3000

EXPOSE 80
