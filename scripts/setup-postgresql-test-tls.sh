#!/usr/bin/env bash
set -euo pipefail

# Disposable CI certificates only. No production credentials or host trust changes.
container=${1:?Pass the PostgreSQL service container ID}
tls_dir=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=YOLO CI Test CA' \
  -keyout "$tls_dir/ca.key" -out "$tls_dir/ca.crt" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj '/CN=localhost' \
  -keyout "$tls_dir/server.key" -out "$tls_dir/server.csr" 2>/dev/null
cat > "$tls_dir/server.ext" <<'CERT'
subjectAltName=DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
CERT
openssl x509 -req -days 1 -in "$tls_dir/server.csr" \
  -CA "$tls_dir/ca.crt" -CAkey "$tls_dir/ca.key" -CAcreateserial \
  -extfile "$tls_dir/server.ext" -out "$tls_dir/server.crt" 2>/dev/null
docker cp "$tls_dir/server.crt" "$container:/tmp/yolo-server.crt"
docker cp "$tls_dir/server.key" "$container:/tmp/yolo-server.key"
docker exec --user root "$container" chown postgres:postgres /tmp/yolo-server.crt /tmp/yolo-server.key
docker exec --user root "$container" chmod 600 /tmp/yolo-server.key
docker exec --user postgres "$container" psql -U postgres -d yolo_test \
  -c "ALTER SYSTEM SET ssl = 'on'" \
  -c "ALTER SYSTEM SET ssl_cert_file = '/tmp/yolo-server.crt'" \
  -c "ALTER SYSTEM SET ssl_key_file = '/tmp/yolo-server.key'" \
  -c 'SELECT pg_reload_conf()'
printf 'YOLO_PG_TEST_CA=%s\n' "$tls_dir/ca.crt" >> "${GITHUB_ENV:?Run inside GitHub Actions}"
