#!/usr/bin/env bash
# Post-deploy smoke test: verifies GET /health returns "ok" for every backend service.
#
# No Ingress resource exists anywhere in infrastructure/k8s/ (verified — this repo has no
# public HTTP routing to individual services), so this checks each Service's ClusterIP
# directly from an in-cluster pod rather than curling the public staging URL.
#
# Usage: staging-smoke-test.sh [namespace]
set -euo pipefail

NAMESPACE="${1:-erp-system}"

SERVICES=(
  "auth-service:3010"
  "sales-service:3013"
  "inventory-service:3012"
  "accounting-service:3019"
  "purchase-service:3020"
  "hr-service:3021"
  "gst-service:3018"
  "notification-service:3014"
  "scheduler-service:3016"
  "search-service:3017"
  "report-service:3015"
  "tenant-service:3011"
  "event-service:3023"
  "production-service:3022"
)

FAILED=()

for entry in "${SERVICES[@]}"; do
  svc="${entry%%:*}"
  port="${entry##*:}"
  echo "Checking ${svc} (${svc}.${NAMESPACE}.svc.cluster.local:${port}/health)..."

  RESPONSE=$(kubectl run "smoke-${svc}-$$" \
    --namespace "${NAMESPACE}" \
    --image=curlimages/curl:8.11.0 \
    --restart=Never \
    --rm -i --quiet \
    --command -- curl -sf -m 10 "http://${svc}.${NAMESPACE}.svc.cluster.local:${port}/health" 2>/dev/null || echo "")

  if [[ "${RESPONSE}" == *'"status":"healthy"'* ]]; then
    echo "  OK: ${svc}"
  else
    echo "  FAILED: ${svc} (response: ${RESPONSE:-<none>})"
    FAILED+=("${svc}")
  fi
done

if [ ${#FAILED[@]} -gt 0 ]; then
  echo ""
  echo "Smoke test FAILED for: ${FAILED[*]}"
  exit 1
fi

echo ""
echo "Smoke test passed: all ${#SERVICES[@]} services healthy."
