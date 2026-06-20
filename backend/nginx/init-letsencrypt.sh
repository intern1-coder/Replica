#!/bin/bash
# Nginx / Certbot init script to bootstrap certificates on first run.

domains=(example.com www.example.com)
email="admin@example.com"
data_path="./nginx/certbot"
nginx_conf="./nginx/conf.d"

if [ -d "$data_path" ]; then
  read -p "Existing data found for $domains. Continue and replace existing certificate? (y/N) " decision
  if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
    exit
  fi
fi

if [ ! -e "$data_path/conf/options-ssl-nginx.conf" ] || [ ! -e "$data_path/conf/ssl-dhparams.pem" ]; then
  echo "### Downloading recommended TLS parameters ..."
  mkdir -p "$data_path/conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nodejs/options-ssl-nginx.conf > "$data_path/conf/options-ssl-nginx.conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$data_path/conf/ssl-dhparams.pem"
  echo
fi

echo "### Requesting Let's Encrypt certificate for $domains ..."
# Add --test-cert for staging
# docker-compose run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot ..." certbot
