FROM nginx:1.27-alpine

COPY index.html /usr/share/nginx/html/index.html
COPY app.js /usr/share/nginx/html/app.js
COPY utils.js /usr/share/nginx/html/utils.js
COPY panel-content.js /usr/share/nginx/html/panel-content.js
COPY styles.css /usr/share/nginx/html/styles.css
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
