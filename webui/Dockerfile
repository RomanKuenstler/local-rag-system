FROM nginx:1.27-alpine

COPY index.html /usr/share/nginx/html/index.html
COPY app.js /usr/share/nginx/html/app.js
COPY utils.js /usr/share/nginx/html/utils.js
COPY panel-content.js /usr/share/nginx/html/panel-content.js
COPY chat-export.js /usr/share/nginx/html/chat-export.js
COPY styles.css /usr/share/nginx/html/styles.css
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

ENV UPSTREAM_API_URL=http://retriever:3000

EXPOSE 80
