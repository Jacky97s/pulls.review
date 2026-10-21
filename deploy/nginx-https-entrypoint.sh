#!/bin/sh
set -eu

mkdir -p /etc/nginx/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/certs/tls.key \
  -out /etc/nginx/certs/tls.crt \
  -subj "/CN=${HTTPS_IP}" \
  -addext "subjectAltName=IP:${HTTPS_IP}"

exec nginx -g 'daemon off;'
