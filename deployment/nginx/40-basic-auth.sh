#!/bin/sh

set -eu

auth_config=/etc/nginx/basic_auth.conf
role_config=/etc/nginx/auth_roles.conf
auth_file=/etc/nginx/.htpasswd
admin_auth_file=/etc/nginx/.htpasswd-admin
friends_username=${BASIC_AUTH_FRIENDS_USERNAME:-}
friends_password=${BASIC_AUTH_FRIENDS_PASSWORD:-}
admin_username=${BASIC_AUTH_ADMIN_USERNAME:-}
admin_password=${BASIC_AUTH_ADMIN_PASSWORD:-}

if [ -z "$friends_username" ] && [ -z "$friends_password" ] && \
   [ -z "$admin_username" ] && [ -z "$admin_password" ]; then
    printf '%s\n' 'auth_basic off;' > "$auth_config"
    printf '%s\n' 'map $remote_user $authenticated_role {' '    default viewer;' '}' > "$role_config"
    exit 0
fi

if [ -z "$friends_username" ] || [ -z "$friends_password" ] || \
   [ -z "$admin_username" ] || [ -z "$admin_password" ]; then
    echo "Both friends and admin Basic Auth credentials must be fully configured." >&2
    exit 1
fi

for username in "$friends_username" "$admin_username"; do
    case "$username" in
        *[!A-Za-z0-9_.@-]*)
            echo "Basic Auth usernames may only contain letters, numbers, _, ., @, and -." >&2
            exit 1
            ;;
    esac
done

for password in "$friends_password" "$admin_password"; do
    if printf '%s' "$password" | grep -q '[[:cntrl:]]'; then
        echo "Basic Auth passwords cannot contain a control character." >&2
        exit 1
    fi
done

if [ "$friends_username" = "$admin_username" ]; then
    echo "Friends and admin usernames must be different." >&2
    exit 1
fi

# Nginx supports RFC 2307 {PLAIN} entries. The file stays inside the container;
# the password is already supplied to Docker as an environment variable.
printf '%s:{PLAIN}%s\n%s:{PLAIN}%s\n' \
    "$friends_username" "$friends_password" \
    "$admin_username" "$admin_password" > "$auth_file"
printf '%s:{PLAIN}%s\n' "$admin_username" "$admin_password" > "$admin_auth_file"
chmod 644 "$auth_file" "$admin_auth_file"

printf '%s\n' \
    'map $remote_user $authenticated_role {' \
    '    default viewer;' \
    "    $admin_username admin;" \
    '}' > "$role_config"

cat > "$auth_config" <<'EOF'
auth_basic "IPTV Restream";
auth_basic_user_file /etc/nginx/.htpasswd;
EOF
