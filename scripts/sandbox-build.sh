#!/usr/bin/env bash
# The author-build sandbox (S4-T07).
#
# Untrusted repository code runs only here. A `container:` declaration alone
# is not sandbox proof, so this script states and enforces every property
# the brief requires, and `test/sandbox.test.mjs` proves each one by
# running a build that tries to violate it and asserting it fails:
#
#   * no network of any kind once the build starts (`--network none`);
#   * the source tree is mounted read-only, so the build cannot write to,
#     delete from or mutate the repository (DEC-016);
#   * exactly one writable path, the output directory, mounted separately;
#   * non-root execution with every Linux capability dropped and no new
#     privileges;
#   * bounded memory, CPU and process count, and a hard wall-clock timeout
#     that terminates the container rather than the script;
#   * a deterministic environment: fixed SOURCE_DATE_EPOCH, TZ and LC_ALL,
#     and an otherwise empty environment, so a build cannot read a runner
#     secret out of the ambient environment;
#   * unconditional container removal, including on timeout or interrupt.
#
# Dependency installation, which does need the network, is a separate
# earlier step the caller performs before invoking this script: by the time
# the build runs there is nothing left for it to fetch.
set -euo pipefail

SOURCE=""
OUTPUT=""
IMAGE="node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd"
COMMAND="npm run build"
TIMEOUT_SECONDS=900
MEMORY="2g"
CPUS="2"
PIDS_LIMIT="256"

usage() {
  cat >&2 <<'USAGE'
usage: sandbox-build.sh --source DIR --output DIR [options]

  --source DIR             the author source tree; mounted read-only
  --output DIR             the only writable path; created if absent
  --image REF              the build image, pinned by sha256 digest
  --command CMD            the build command (default: npm run build)
  --timeout-seconds N      wall-clock ceiling (default: 900)
  --memory SIZE            memory ceiling (default: 2g)
  --cpus N                 CPU ceiling (default: 2)
  --pids-limit N           process ceiling (default: 256)
USAGE
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) SOURCE="${2:?}"; shift 2 ;;
    --output) OUTPUT="${2:?}"; shift 2 ;;
    --image) IMAGE="${2:?}"; shift 2 ;;
    --command) COMMAND="${2:?}"; shift 2 ;;
    --timeout-seconds) TIMEOUT_SECONDS="${2:?}"; shift 2 ;;
    --memory) MEMORY="${2:?}"; shift 2 ;;
    --cpus) CPUS="${2:?}"; shift 2 ;;
    --pids-limit) PIDS_LIMIT="${2:?}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "SANDBOX_ARGUMENT_UNKNOWN: $1" >&2; usage ;;
  esac
done

[ -n "${SOURCE}" ] || { echo "SANDBOX_SOURCE_REQUIRED" >&2; usage; }
[ -n "${OUTPUT}" ] || { echo "SANDBOX_OUTPUT_REQUIRED" >&2; usage; }
[ -d "${SOURCE}" ] || { echo "SANDBOX_SOURCE_NOT_A_DIRECTORY: ${SOURCE}" >&2; exit 1; }

SOURCE_ABS="$(cd "${SOURCE}" && pwd)"
mkdir -p "${OUTPUT}"
OUTPUT_ABS="$(cd "${OUTPUT}" && pwd)"

case "${OUTPUT_ABS}/" in
  "${SOURCE_ABS}"/*)
    echo "SANDBOX_OUTPUT_INSIDE_SOURCE: the output directory must not live inside the read-only source tree" >&2
    exit 1
    ;;
esac
if [ "${OUTPUT_ABS}" = "${SOURCE_ABS}" ]; then
  echo "SANDBOX_OUTPUT_EQUALS_SOURCE" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || {
  echo "SANDBOX_RUNTIME_UNAVAILABLE: docker is required; the sandbox never falls back to running author code unsandboxed" >&2
  exit 1
}

CONTAINER="gala-sandbox-build-$$-$(date +%s)"
cleanup() {
  docker rm --force "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

set +e
docker run \
  --name "${CONTAINER}" \
  --rm \
  --network none \
  --user 65534:65534 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --memory "${MEMORY}" \
  --memory-swap "${MEMORY}" \
  --cpus "${CPUS}" \
  --pids-limit "${PIDS_LIMIT}" \
  --stop-timeout 5 \
  --env-file /dev/null \
  --env HOME=/tmp \
  --env TZ=UTC \
  --env LC_ALL=C.UTF-8 \
  --env SOURCE_DATE_EPOCH=0 \
  --env NPM_CONFIG_UPDATE_NOTIFIER=false \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --volume "${SOURCE_ABS}:/gala/source:ro" \
  --volume "${OUTPUT_ABS}:/gala/output:rw" \
  --workdir /gala/source \
  --entrypoint /bin/sh \
  "${IMAGE}" \
  -c "set -eu; export GALA_OUTPUT_DIR=/gala/output; ${COMMAND}" &
BUILD_PID=$!

WAITED=0
while kill -0 "${BUILD_PID}" 2>/dev/null; do
  if [ "${WAITED}" -ge "${TIMEOUT_SECONDS}" ]; then
    echo "SANDBOX_BUILD_TIMEOUT: the build exceeded ${TIMEOUT_SECONDS} seconds and its container was terminated" >&2
    docker kill "${CONTAINER}" >/dev/null 2>&1 || true
    wait "${BUILD_PID}" >/dev/null 2>&1 || true
    exit 124
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
wait "${BUILD_PID}"
STATUS=$?
set -e

if [ "${STATUS}" -ne 0 ]; then
  echo "SANDBOX_BUILD_FAILED: the author build exited ${STATUS}" >&2
  exit "${STATUS}"
fi

echo "SANDBOX_BUILD_OK: output in ${OUTPUT_ABS}"
