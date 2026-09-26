/**
 * PUB-M13 regression: `release.yaml` used to treat any `npm view` failure
 * (a 404, but also a registry 5xx, a network timeout, an auth failure or a
 * rate limit) as "not published" and fall through to `npm publish`, making
 * a transient registry blip trigger an attempted republish that fails with
 * `EPUBLISHCONFLICT` partway through the dependency-ordered loop.
 *
 * This asserts the fixed shape (capture `--json`, branch on
 * `error.code === 'E404'` specifically) directly from the committed YAML,
 * and separately proves the embedded Node one-liner actually discriminates
 * E404 from an arbitrary other failure -- the property that matters is not
 * merely "the words E404 appear in the file".
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const RELEASE_PATH = '.github/workflows/release.yaml';

test('release.yaml no longer treats every npm view failure as unpublished', () => {
  const source = readFileSync(RELEASE_PATH, 'utf8');
  assert.ok(
    !/npm view .* version >\/dev\/null 2>&1/u.test(source),
    'release.yaml must not discard npm view exit status without inspecting it',
  );
  assert.match(
    source,
    /npm view "\$\{package_name\}@\$\{package_version\}" --json/u,
  );
  assert.match(source, /error\?\.code/u);
  assert.match(source, /!== ['"]E404['"]|!= ['"]E404['"]/u);
});

/**
 * The exact Node one-liner `release.yaml` uses to extract `error.code` from
 * `npm view --json`'s output, extracted from the committed source so this
 * test proves the real snippet's behavior rather than a copy that could
 * drift from it.
 *
 * @returns {string} the Node `-e` script body
 */
function extractErrorCodeScript() {
  const source = readFileSync(RELEASE_PATH, 'utf8');
  const match =
    /view_error_code="\$\(node --input-type=module -e "\n([\s\S]*?)\n\s*" -- "\$\{view_output\}"\)"/u.exec(
      source,
    );
  assert.ok(
    match,
    'expected to find the embedded error-code extraction script',
  );
  const script = match[1];
  assert.ok(script, 'the capture group must have matched non-empty text');
  return script;
}

/**
 * @param {string} viewOutput the simulated `npm view --json` stdout+stderr
 * @returns {string} whatever the extracted script writes to stdout
 */
function runExtractor(viewOutput) {
  const script = extractErrorCodeScript();
  return execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script, '--', viewOutput],
    { encoding: 'utf8' },
  );
}

test('the embedded error-code extractor picks E404 out of a real npm view --json 404', () => {
  const viewOutput = JSON.stringify({
    error: {
      code: 'E404',
      summary: "'@rathnasgala2/example@9.9.9' is not in this registry.",
    },
  });
  assert.equal(runExtractor(viewOutput), 'E404');
});

test('the embedded error-code extractor does not report E404 for an unrelated failure', () => {
  assert.equal(runExtractor('npm ERR! network request timed out'), '');
  assert.equal(
    runExtractor(JSON.stringify({ error: { code: 'E403' } })),
    'E403',
  );
});
