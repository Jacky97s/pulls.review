FROM nginx:1.29-alpine

RUN apk add --no-cache openssl

COPY deploy/nginx-https-entrypoint.sh /usr/local/bin/nginx-https-entrypoint
RUN chmod +x /usr/local/bin/nginx-https-entrypoint

ENTRYPOINT ["/usr/local/bin/nginx-https-entrypoint"]
