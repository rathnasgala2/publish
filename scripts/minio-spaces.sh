#!/usr/bin/env bash
# Start (or remove) a throwaway MinIO server for the opt-in `do-spaces`
# conformance run, pinned to the exact digest recorded in
# `pins/ledger.json` and mirrored from `infra/release/container-images.json`.
#
# The container is deliberately *not* the local stack's MinIO: this adapter
# must never be proven against a server that other work also writes to.
#
#   scripts/minio-spaces.sh up
#   SPACES_MINIO_ENDPOINT=http://127.0.0.1:59310 \
#     npm test --workspace packages/adapter-do-spaces
#   scripts/minio-spaces.sh down
set -euo pipefail

IMAGE="quay.io/minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e"
NAME="${SPACES_MINIO_NAME:-gala-s4-minio}"
PORT="${SPACES_MINIO_PORT:-59310}"

case "${1:-up}" in
  up)
    docker rm --force "${NAME}" >/dev/null 2>&1 || true
    docker run --detach --name "${NAME}" --publish "${PORT}:9000" \
      --env MINIO_ROOT_USER=galas4testkey \
      --env MINIO_ROOT_PASSWORD=galas4testsecret0123456789 \
      --env MINIO_DOMAIN=nyc3.digitaloceanspaces.com \
      --env MINIO_REGION=nyc3 \
      "${IMAGE}" server /data >/dev/null
    printf 'SPACES_MINIO_ENDPOINT=http://127.0.0.1:%s\n' "${PORT}"
    ;;
  down)
    docker rm --force "${NAME}" >/dev/null 2>&1 || true
    printf 'removed %s\n' "${NAME}"
    ;;
  *)
    echo "usage: minio-spaces.sh [up|down]" >&2
    exit 2
    ;;
esac
