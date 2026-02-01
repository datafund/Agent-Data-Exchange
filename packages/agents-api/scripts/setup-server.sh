#!/bin/bash
# Setup agents-api on production/staging server
# Run this via SSH on the target server
#
# Usage: ./setup-server.sh [production|staging]

set -e

ENV="${1:-production}"
echo "Setting up agents-api ($ENV)..."

if [ "$ENV" = "production" ]; then
  APP_DIR="/var/www/apps/fairdrop-agents"
  SERVICE_NAME="fairdrop-agents"
  PORT=3003
else
  APP_DIR="/var/www/apps/fairdrop-agents-staging"
  SERVICE_NAME="fairdrop-agents-staging"
  PORT=3004
fi

# Create directory structure
sudo mkdir -p "$APP_DIR/data"
sudo chown -R deploy:deploy "$APP_DIR"

echo "✓ Created $APP_DIR"

# Copy service file
sudo cp "server/$SERVICE_NAME.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
echo "✓ Installed systemd service: $SERVICE_NAME"

# Create .env file if it doesn't exist
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" << EOF
# Agents API Configuration
# Chain RPC URLs and contract addresses
SEPOLIA_RPC_URL=
SEPOLIA_ESCROW_CONTRACT=
SEPOLIA_START_BLOCK=0
BASE_RPC_URL=
BASE_ESCROW_CONTRACT=
BASE_START_BLOCK=0
PORT=$PORT
DB_PATH=$APP_DIR/data/agents.db
EOF
  echo "✓ Created .env template at $APP_DIR/.env"
  echo "  ⚠ Fill in RPC URLs and contract addresses before starting!"
else
  echo "✓ .env already exists"
fi

# Append Caddy config
CADDY_SNIPPET="server/Caddyfile.agents-${ENV}"
if [ -f "$CADDY_SNIPPET" ]; then
  echo ""
  echo "Caddy config snippet:"
  echo "  Append the contents of $CADDY_SNIPPET to /etc/caddy/Caddyfile"
  echo "  Then run: sudo systemctl reload caddy"
fi

echo ""
echo "Setup complete. Next steps:"
echo "  1. Fill in $APP_DIR/.env with RPC URLs and contract addresses"
echo "  2. Deploy the application code to $APP_DIR"
echo "  3. Run: pnpm install (in $APP_DIR)"
echo "  4. Append Caddy config and reload: sudo systemctl reload caddy"
echo "  5. Start service: sudo systemctl start $SERVICE_NAME"
echo "  6. Check logs: journalctl -u $SERVICE_NAME -f"
