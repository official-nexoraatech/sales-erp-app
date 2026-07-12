#!/usr/bin/env bash
# Scans ERP-PLANNING/phase-completions/*.md for unchecked `- [ ]` items under a
# `## Deployment Checklist` heading — the same scan CLAUDE.md mandates at AI-session
# start, formalized as a pre-deploy gate (see ERP-PLANNING/runbooks/production-deployment-runbook.md).
#
# Usage: scripts/check-pending-deployment-checklists.sh
# Exit code: 0 if no unchecked items found, 1 if any are found (does not modify anything).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPLETIONS_DIR="${REPO_ROOT}/ERP-PLANNING/phase-completions"

FOUND=0

for file in "${COMPLETIONS_DIR}"/*.md; do
  [ -e "${file}" ] || continue

  in_checklist=0
  while IFS= read -r line; do
    if [[ "${line}" =~ ^##[[:space:]] ]]; then
      if [[ "${line}" == "## Deployment Checklist"* ]]; then
        in_checklist=1
      else
        in_checklist=0
      fi
      continue
    fi
    if [ "${in_checklist}" -eq 1 ] && [[ "${line}" =~ ^-[[:space:]]\[\ \] ]]; then
      echo "[pending] $(basename "${file}"): ${line}"
      FOUND=1
    fi
  done < "${file}"
done

if [ "${FOUND}" -eq 1 ]; then
  echo ""
  echo "Pending deployment checklist items found above. Do not proceed until a human"
  echo "confirms each has been run against the target environment."
  exit 1
fi

echo "No pending deployment checklist items found."
