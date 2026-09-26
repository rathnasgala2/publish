/**
 * PUB-M13 regression: `release.yaml` used to capture `npm view --json
 * 2>&1`, merging stdout and stderr into one stream. npm 11 writes its
 * structured `{"error":{"code":...}}` document to stdout but *also* writes
 * human-readable `npm error ...` prose to stderr; the merge put that prose
 * ahead of the JSON, so `JSON.parse` threw, the extracted error code
 * silently became `''`, and a plain 404 -- the expected outcome for a
 * package version this release is about to publish for the first time --
 * was indistinguishable from a registry 5xx, a timeout, an auth failure or
 * a rate limit. The workflow then aborted the whole dependency-ordered
 * publish loop on every legitimate first publish.
 *
 * The fix moved the discrimination out of inline YAML into
 * `scripts/release/npm-view-status.mjs`, which captures stdout and stderr
 * as two separate strings and classifies from stdout alone. This file
 * unit-tests that classification against real captured npm output shapes
 * -- including the exact stdout+stderr mix that broke -- and asserts
 * `release.yaml` actually calls the script rather than re-inlining the
 * broken pattern.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { classifyNpmViewResult } from '../scripts/release/npm-view-status.mjs';

const RELEASE_PATH = '.github/workflows/release.yaml';

test('classifyNpmViewResult: exit 0 means published, regardless of body', () => {
  assert.deepEqual(
    classifyNpmViewResult({
      exitStatus: 0,
      stdout: '{"name":"@rathnasgala2/adapter-protocol","version":"0.2.0"}',
      stderr: '',
    }),
    { status: 'published' },
  );
});

test('classifyNpmViewResult: a clean E404 JSON document on stdout is unpublished', () => {
  assert.deepEqual(
    classifyNpmViewResult({
      exitStatus: 1,
      stdout: JSON.stringify({
        error: {
          code: 'E404',
          summary: 'No match found for version 0.2.1',
        },
      }),
      stderr:
        'npm error code E404\nnpm error 404 No match found for version 0.2.1\n',
    }),
    { status: 'unpublished' },
  );
});

test('classifyNpmViewResult: E404 is recognized even with npm error prose on stderr', () => {
  // The real shape npm 11 produces for `npm view <pkg>@<version> --json`
  // on a 404: stdout carries only the JSON document, stderr carries the
  // human-readable "npm error" lines. This is the shape release.yaml's
  // fixed step actually receives once stdout and stderr are captured
  // separately.
  const result = classifyNpmViewResult({
    exitStatus: 1,
    stdout:
      '{\n  "error": {\n    "code": "E404",\n    "summary": "No match found for version 0.2.1",\n    "detail": "The requested resource could not be found or you do not have permission to access it.\\n\\nNote that you can also install from a\\ntarball, folder, http url, or git url."\n  }\n}\n',
    stderr:
      'npm error code E404\nnpm error 404 No match found for version 0.2.1\nnpm error 404\nnpm error 404  The requested resource could not be found or you do not have permission to access it.\nnpm error 404\nnpm error 404 Note that you can also install from a\nnpm error 404 tarball, folder, http url, or git url.\nnpm error A complete log of this run can be found in: /home/runner/.npm/_logs/debug-0.log\n',
  });
  assert.deepEqual(result, { status: 'unpublished' });
});

test('classifyNpmViewResult: the exact stdout+stderr merge that broke the old inline script is an error, never unpublished', () => {
  // This is the PUB-M13 bug reproduced directly: `2>&1` interleaves the
  // stderr prose ahead of the stdout JSON into one buffer. If this string
  // is ever handed to the classifier as "stdout" (which the fixed script
  // never does -- it captures the two streams separately), JSON.parse must
  // fail loudly as `error`, not silently resolve to a wrong status.
  const merged =
    'npm error code E404\n' +
    'npm error 404 No match found for version 0.2.1\n' +
    'npm error 404\n' +
    "npm error 404  The requested resource '@rathnasgala2/adapter-protocol@0.2.1' could not be found or you do not have permission to access it.\n" +
    'npm error 404\n' +
    'npm error 404 Note that you can also install from a\n' +
    'npm error 404 tarball, folder, http url, or git url.\n' +
    '{\n  "error": {\n    "code": "E404",\n    "summary": "No match found for version 0.2.1"\n  }\n}\n' +
    'npm error A complete log of this run can be found in: /home/runner/.npm/_logs/debug-0.log\n';

  const result = classifyNpmViewResult({
    exitStatus: 1,
    stdout: merged,
    stderr: '',
  });
  assert.equal(result.status, 'error');
  assert.ok(
    'message' in result && result.message.length > 0,
    'an error result must carry a non-empty message',
  );
});

test('classifyNpmViewResult: a non-404 error code is an error, not unpublished', () => {
  const result = classifyNpmViewResult({
    exitStatus: 1,
    stdout: JSON.stringify({ error: { code: 'E403', summary: 'Forbidden' } }),
    stderr: 'npm error code E403\nnpm error 403 Forbidden\n',
  });
  assert.equal(result.status, 'error');
  assert.ok('message' in result && result.message.includes('403'));
});

test('classifyNpmViewResult: a network timeout with no JSON body at all is an error', () => {
  const result = classifyNpmViewResult({
    exitStatus: 1,
    stdout: '',
    stderr:
      'npm error network request to https://registry.npmjs.org timed out\n',
  });
  assert.deepEqual(result, {
    status: 'error',
    message:
      'npm error network request to https://registry.npmjs.org timed out',
  });
});

test('classifyNpmViewResult: exit non-zero with nothing on either stream still errors, never unpublished', () => {
  const result = classifyNpmViewResult({
    exitStatus: 1,
    stdout: '',
    stderr: '',
  });
  assert.equal(result.status, 'error');
});

test('release.yaml calls scripts/release/npm-view-status.mjs instead of inlining the discrimination', () => {
  const source = readFileSync(RELEASE_PATH, 'utf8');
  assert.match(
    source,
    /node scripts\/release\/npm-view-status\.mjs "\$\{package_name\}" "\$\{package_version\}"/u,
    'release.yaml must delegate npm-view discrimination to the tested script',
  );
  assert.ok(
    !/npm view "\$\{package_name\}@\$\{package_version\}" --json 2>&1/u.test(
      source,
    ),
    'release.yaml must not merge stdout and stderr when capturing npm view (PUB-M13)',
  );
  assert.match(
    source,
    /case "\$\{status\}" in/u,
    "release.yaml must branch on the script's published/unpublished/error status",
  );
});
