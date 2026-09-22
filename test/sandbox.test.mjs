/**
 * Build-sandbox proof (S4-T07).
 *
 * The brief is explicit that "a `container:` declaration alone is not
 * sandbox proof" and that measured runner evidence is required rather than
 * an inference. So every test here runs `scripts/sandbox-build.sh` for
 * real, with a build script written to *attempt* the violation, and asserts
 * the attempt fails — a passing run means the sandbox actually stopped it,
 * not that nobody tried.
 *
 * The container runtime is required, not optional: when Docker is absent
 * these tests are skipped with a visible reason rather than silently
 * passing, and `scripts/sandbox-build.sh` itself refuses to fall back to
 * running author code unsandboxed.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// The probe is bounded: an absent or unresponsive Docker daemon must never
// hang this suite. `spawnSync`'s own `timeout` sends SIGTERM to the child
// and sets `error` to an ETIMEDOUT `Error` rather than letting the process
// run forever, so a daemon that never answers is treated exactly like one
// that is not installed — skipped loudly, not hung on.
const DOCKER_PROBE = spawnSync(
  'docker',
  ['version', '--format', '{{.Server.Os}}'],
  { encoding: 'utf8', timeout: 20_000 },
);
const DOCKER_AVAILABLE =
  DOCKER_PROBE.error === undefined && DOCKER_PROBE.status === 0;
const SKIP = DOCKER_AVAILABLE
  ? false
  : `a container runtime is required to prove the sandbox; it is never inferred (docker version probe: ${
      DOCKER_PROBE.error !== undefined
        ? /** @type {NodeJS.ErrnoException} */ (DOCKER_PROBE.error).code ===
          'ETIMEDOUT'
          ? 'timed out after 20s'
          : DOCKER_PROBE.error.message
        : `exit ${String(DOCKER_PROBE.status)}`
    })`;
if (SKIP !== false) {
  // node:test only prints a skip reason next to each individual test, which
  // buries a single, loud "why the whole file is empty" signal in noise;
  // this one line makes it unmissable in CI output.
  process.stderr.write(`sandbox.test.mjs: ${SKIP}\n`);
}

/**
 * Run one build inside the sandbox.
 *
 * @param {string} script the shell body of the author build
 * @param {readonly string[]} [extraArguments] extra sandbox arguments
 * @returns {{status: number | null, stdout: string, stderr: string, output: string}}
 *   the result plus the output directory path
 */
function runSandbox(script, extraArguments = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'gala-sandbox-'));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  spawnSync('mkdir', ['-p', source, output]);
  writeFileSync(path.join(source, 'index.html'), '<!doctype html>ok\n');
  writeFileSync(path.join(source, 'build.sh'), script);

  const result = spawnSync(
    'scripts/sandbox-build.sh',
    [
      '--source',
      source,
      '--output',
      output,
      '--command',
      'sh /gala/source/build.sh',
      '--timeout-seconds',
      '60',
      ...extraArguments,
    ],
    { encoding: 'utf8' },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output,
  };
}

test(
  'a well-behaved build succeeds and writes only into the output directory',
  { skip: SKIP },
  () => {
    const result = runSandbox(
      'cp /gala/source/index.html "$GALA_OUTPUT_DIR/index.html"\n',
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SANDBOX_BUILD_OK/u);
    assert.deepEqual(readdirSync(result.output), ['index.html']);
    assert.match(
      readFileSync(path.join(result.output, 'index.html'), 'utf8'),
      /doctype/u,
    );
  },
);

test('a build that tries to reach the network fails', { skip: SKIP }, () => {
  const result = runSandbox(
    [
      'set -e',
      // Any of these succeeding means the sandbox has a network.
      'if getent hosts registry.npmjs.org; then echo NETWORK_DNS_RESOLVED; exit 0; fi',
      "if node -e \"fetch('https://registry.npmjs.org/').then(()=>{console.log('NETWORK_FETCH_OK');process.exit(0)}).catch(()=>process.exit(3))\"; then exit 0; fi",
      'echo NETWORK_UNREACHABLE >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  assert.notEqual(result.status, 0, 'the build reached the network');
  assert.doesNotMatch(result.stdout, /NETWORK_DNS_RESOLVED|NETWORK_FETCH_OK/u);
  assert.match(result.stderr, /NETWORK_UNREACHABLE|SANDBOX_BUILD_FAILED/u);
});

test(
  'a build that tries to write into the source tree fails',
  { skip: SKIP },
  () => {
    const result = runSandbox(
      [
        'set -e',
        'if echo tampered > /gala/source/index.html; then echo SOURCE_WRITE_SUCCEEDED; exit 0; fi',
        'exit 1',
        '',
      ].join('\n'),
    );
    assert.notEqual(result.status, 0, 'the build mutated the read-only source');
    assert.doesNotMatch(result.stdout, /SOURCE_WRITE_SUCCEEDED/u);
  },
);

test(
  'a build that tries to write outside the output directory fails',
  { skip: SKIP },
  () => {
    const result = runSandbox(
      [
        'set -e',
        'if echo escaped > /escaped.txt; then echo ROOT_WRITE_SUCCEEDED; exit 0; fi',
        'exit 1',
        '',
      ].join('\n'),
    );
    assert.notEqual(
      result.status,
      0,
      'the build wrote outside the output directory',
    );
    assert.doesNotMatch(result.stdout, /ROOT_WRITE_SUCCEEDED/u);
  },
);

test(
  'the build runs unprivileged, as a non-root user with no capabilities',
  { skip: SKIP },
  () => {
    const result = runSandbox(
      ['id -u > "$GALA_OUTPUT_DIR/uid.txt"', ''].join('\n'),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(path.join(result.output, 'uid.txt'), 'utf8').trim(),
      '65534',
    );
  },
);

test(
  'the build environment is deterministic and carries no ambient runner secret',
  { skip: SKIP },
  () => {
    const marker = `gala-ambient-${Date.now()}`;
    process.env.GALA_AMBIENT_SECRET_PROBE = marker;
    try {
      const result = runSandbox(
        ['printenv > "$GALA_OUTPUT_DIR/env.txt"', ''].join('\n'),
      );
      assert.equal(result.status, 0, result.stderr);
      const environment = readFileSync(
        path.join(result.output, 'env.txt'),
        'utf8',
      );
      assert.ok(
        !environment.includes(marker),
        'a runner environment value leaked into the build',
      );
      assert.match(environment, /^SOURCE_DATE_EPOCH=0$/mu);
      assert.match(environment, /^TZ=UTC$/mu);
      assert.match(environment, /^LC_ALL=C\.UTF-8$/mu);
    } finally {
      delete process.env.GALA_AMBIENT_SECRET_PROBE;
    }
  },
);

test(
  'a build that exceeds its wall-clock ceiling is terminated',
  { skip: SKIP },
  () => {
    const root = mkdtempSync(path.join(tmpdir(), 'gala-sandbox-timeout-'));
    const source = path.join(root, 'source');
    const output = path.join(root, 'output');
    spawnSync('mkdir', ['-p', source, output]);
    writeFileSync(path.join(source, 'build.sh'), 'sleep 120\n');

    const result = spawnSync(
      'scripts/sandbox-build.sh',
      [
        '--source',
        source,
        '--output',
        output,
        '--command',
        'sh /gala/source/build.sh',
        '--timeout-seconds',
        '5',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 124);
    assert.match(String(result.stderr), /SANDBOX_BUILD_TIMEOUT/u);
  },
);

test('an output directory inside the read-only source tree is refused before anything runs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gala-sandbox-nested-'));
  const source = path.join(root, 'source');
  spawnSync('mkdir', ['-p', path.join(source, 'dist')]);
  const result = spawnSync(
    'scripts/sandbox-build.sh',
    ['--source', source, '--output', path.join(source, 'dist')],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr), /SANDBOX_OUTPUT_INSIDE_SOURCE/u);
});

test('an unknown argument is refused rather than ignored', () => {
  const result = spawnSync(
    'scripts/sandbox-build.sh',
    ['--source', '.', '--output', '/tmp/gala-unused', '--allow-network'],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr), /SANDBOX_ARGUMENT_UNKNOWN/u);
});

test(
  'the sandbox has no unix socket into the host, not even the container runtime',
  { skip: SKIP },
  () => {
    const result = runSandbox(
      [
        'set -e',
        // A mounted /var/run/docker.sock would be a complete escape.
        'if [ -S /var/run/docker.sock ] || [ -S /run/docker.sock ]; then echo RUNTIME_SOCKET_PRESENT; exit 0; fi',
        'ls -l /var/run 2>/dev/null > "$GALA_OUTPUT_DIR/run.txt" || true',
        'find / -xdev -type s 2>/dev/null > "$GALA_OUTPUT_DIR/sockets.txt" || true',
        '',
      ].join('\n'),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /RUNTIME_SOCKET_PRESENT/u);
    assert.equal(
      readFileSync(path.join(result.output, 'sockets.txt'), 'utf8').trim(),
      '',
      'the sandbox can see a unix socket',
    );
  },
);

test('a timed-out build leaves no container behind', { skip: SKIP }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gala-sandbox-reaped-'));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  spawnSync('mkdir', ['-p', source, output]);
  writeFileSync(path.join(source, 'build.sh'), 'sleep 120\n');
  const result = spawnSync(
    'scripts/sandbox-build.sh',
    [
      '--source',
      source,
      '--output',
      output,
      '--command',
      'sh /gala/source/build.sh',
      '--timeout-seconds',
      '5',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 124);
  // The timeout must terminate the container, not merely abandon the
  // client: a surviving container would keep running author code.
  const surviving = spawnSync(
    'docker',
    ['ps', '--quiet', '--filter', 'name=gala-sandbox-build-'],
    { encoding: 'utf8' },
  );
  assert.equal(
    String(surviving.stdout).trim(),
    '',
    'a sandbox container survived its timeout',
  );
});

test(
  'a symlink the build plants in its output is never followed off the volume',
  { skip: SKIP },
  () => {
    const marker = `gala-host-secret-${Date.now()}`;
    const root = mkdtempSync(path.join(tmpdir(), 'gala-sandbox-symlink-'));
    const secret = path.join(root, 'host-secret.txt');
    writeFileSync(secret, `${marker}\n`);
    const source = path.join(root, 'source');
    const output = path.join(root, 'output');
    spawnSync('mkdir', ['-p', source, output]);
    writeFileSync(
      path.join(source, 'build.sh'),
      [
        'ln -s /etc/passwd "$GALA_OUTPUT_DIR/escaped-absolute"',
        'ln -s ../host-secret.txt "$GALA_OUTPUT_DIR/escaped-relative"',
        'echo ok > "$GALA_OUTPUT_DIR/index.html"',
        '',
      ].join('\n'),
    );
    const result = spawnSync(
      'scripts/sandbox-build.sh',
      [
        '--source',
        source,
        '--output',
        output,
        '--command',
        'sh /gala/source/build.sh',
        '--timeout-seconds',
        '60',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    // The host-side packer must refuse the tree rather than follow either
    // link and publish /etc/passwd or a host file as site content.
    const packed = spawnSync(
      process.execPath,
      [
        'scripts/workflow/pack-carrier.mjs',
        '--directory',
        output,
        '--out',
        path.join(root, 'carrier.bin'),
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(packed.status, 0, 'the packer followed a planted symlink');
    assert.match(String(packed.stderr), /CARRIER_MEMBER_TYPE_REFUSED/u);
    assert.doesNotMatch(String(packed.stdout), new RegExp(marker, 'u'));
  },
);

test('the carrier walker refuses a symlink rather than following it', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gala-walk-symlink-'));
  writeFileSync(path.join(root, 'index.html'), 'ok\n');
  symlinkSync('/etc/passwd', path.join(root, 'passwd.html'));
  const { walkDirectory } = await import('../scripts/workflow/carrier.mjs');
  await assert.rejects(walkDirectory(root), /CARRIER_MEMBER_TYPE_REFUSED/u);
});
