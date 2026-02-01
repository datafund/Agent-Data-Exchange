#!/bin/bash
# Health check for agents-api
# Usage: ./health-check.sh [base_url]

BASE_URL="${1:-https://agents.datafund.io}"
MAX_RETRIES=10
RETRY_DELAY=5

echo "Health checking: $BASE_URL"

for i in $(seq 1 $MAX_RETRIES); do
  HTTP_CODE=$(curl -s -o /tmp/agents-health.json -w "%{http_code}" "$BASE_URL/api/v1/health" 2>/dev/null)

  if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ Health check passed (attempt $i)"
    cat /tmp/agents-health.json | python3 -m json.tool 2>/dev/null || cat /tmp/agents-health.json
    echo ""

    # Also check stats endpoint
    STATS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/stats" 2>/dev/null)
    if [ "$STATS_CODE" = "200" ]; then
      echo "✓ Stats endpoint OK"
    else
      echo "✗ Stats endpoint returned $STATS_CODE"
      exit 1
    fi

    exit 0
  fi

  echo "  Attempt $i/$MAX_RETRIES: HTTP $HTTP_CODE, retrying in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
done

echo "✗ Health check failed after $MAX_RETRIES attempts"
exit 1
