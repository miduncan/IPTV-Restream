#!/bin/sh

set -eu

auth_config=/etc/nginx/basic_auth.conf
auth_file=/etc/nginx/.htpasswd
username=${BASIC_AUTH_USERNAME:-}
password=${BASIC_AUTH_PASSWORD:-}

if [ -z "$username" ] && [ -z "$password" ]; then
    printf '%s\n' 'auth_basic off;' > "$auth_config"
    exit 0
fi

if [ -z "$username" ] || [ -z "$password" ]; then
    echo "BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD must either both be set or both be empty." >&2
    exit 1
fi

if printf '%s' "$username" | grep -q '[:[:cntrl:]]'; then
    echo "BASIC_AUTH_USERNAME cannot contain a colon or control character." >&2
    exit 1
fi

if printf '%s' "$password" | grep -q '[[:cntrl:]]'; then
    echo "BASIC_AUTH_PASSWORD cannot contain a control character." >&2
    exit 1
fi

# Nginx supports RFC 2307 {PLAIN} entries. The file stays inside the container;
# the password is already supplied to Docker as an environment variable.
printf '%s:{PLAIN}%s\n' "$username" "$password" > "$auth_file"
chmod 644 "$auth_file"

cat > "$auth_config" <<'EOF'
auth_basic "IPTV Restream";
auth_basic_user_file /etc/nginx/.htpasswd;
EOF
