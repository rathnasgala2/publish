/**
 * The deterministic rewrites behind `push-adapter.sh`: catalog rows, the
 * fixture lock digest, CHANGELOG release headings and exact workspace pins.
 * Every case runs on a fixture copy; nothing touches the real catalog.
 */

import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import {
  CATALOG_PATH,
  FIXTURE_LOCK_PATH,
  moveExactPins,
  releaseChangelog,
  rewriteCatalogSource,
  rewriteLockText,
  run,
} from '../scripts/release/update-adapter-catalog.mjs';
import { ADAPTER_ARTIFACT_CATALOG } from '../packages/publish-action/src/adapter-artifact-catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PROFILE = /** @type {any} */ (ACTIVE_DIGEST_PROFILES.lock);
const NAME = '@rathnasgala2/adapter-github-pages';
const HEX = 'a'.repeat(64);

/**
 * @returns {Promise<string>} a temporary root holding copies of the files
 */
async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'update-catalog-'));
  for (const file of [CATALOG_PATH, FIXTURE_LOCK_PATH]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await cp(path.join(ROOT, file), path.join(root, file));
  }
  return root;
}

test('the catalog rewrite sets one row, leaves the others and is idempotent', async () => {
  const source = await readFile(path.join(ROOT, CATALOG_PATH), 'utf8');
  const once = rewriteCatalogSource(source, [
    { package: NAME, version: '0.1.2', hex: HEX },
  ]);
  assert.notEqual(once, source);
  assert.match(
    once,
    new RegExp(`version: '0.1.2',\\n\\s+integrity:\\n\\s+'sha256:${HEX}'`, 'u'),
  );
  assert.equal(
    rewriteCatalogSource(once, [{ package: NAME, version: '0.1.2', hex: HEX }]),
    once,
  );
  for (const entry of ADAPTER_ARTIFACT_CATALOG.filter(
    (e) => e.package !== NAME,
  )) {
    assert.ok(once.includes(entry.integrity));
  }
});

test('the catalog rewrite refuses unknown packages and malformed values', async () => {
  const source = await readFile(path.join(ROOT, CATALOG_PATH), 'utf8');
  assert.throws(
    () =>
      rewriteCatalogSource(source, [
        { package: '@x/none', version: '1.0.0', hex: HEX },
      ]),
    /found 0 times/u,
  );
  assert.throws(
    () =>
      rewriteCatalogSource(source, [
        { package: NAME, version: 'v1', hex: HEX },
      ]),
    /invalid update/u,
  );
  assert.throws(
    () =>
      rewriteCatalogSource(source, [
        { package: NAME, version: '1.0.0', hex: 'abc' },
      ]),
    /invalid update/u,
  );
});

test('the fixture lock rewrite moves its row and keeps lockDigest authentic', async () => {
  const text = await readFile(path.join(ROOT, FIXTURE_LOCK_PATH), 'utf8');
  const name = '@rathnasgala2/adapter-local-directory';
  const digest = (/** @type {object} */ lock) => LOCK_PROFILE.digest(lock);
  const next = rewriteLockText(
    text,
    [{ package: name, version: '0.1.2', hex: HEX }],
    digest,
  );
  const lock = JSON.parse(next);
  const row = lock.publisher.find((/** @type {any} */ r) => r.package === name);
  assert.equal(row.version, '0.1.2');
  assert.equal(row.integrity, `sha256:${HEX}`);
  assert.equal(lock.lockDigest, LOCK_PROFILE.digest(lock));
  assert.notEqual(lock.lockDigest, JSON.parse(text).lockDigest);
  assert.equal(
    rewriteLockText(
      next,
      [{ package: name, version: '0.1.2', hex: HEX }],
      digest,
    ),
    next,
  );
  assert.equal(
    rewriteLockText(
      text,
      [{ package: NAME, version: '0.1.2', hex: HEX }],
      digest,
    ),
    text,
  );
});

test('the catalog command rewrites both files of a fixture copy', async () => {
  const root = await fixtureRoot();
  try {
    await run([
      'catalog',
      '--root',
      root,
      `${NAME}=0.1.2=${HEX}`,
      `@rathnasgala2/adapter-local-directory=0.1.2=${HEX}`,
    ]);
    const catalog = await readFile(path.join(root, CATALOG_PATH), 'utf8');
    const lock = JSON.parse(
      await readFile(path.join(root, FIXTURE_LOCK_PATH), 'utf8'),
    );
    assert.equal(catalog.split(HEX).length - 1, 2);
    assert.equal(lock.lockDigest, LOCK_PROFILE.digest(lock));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the changelog release moves Unreleased lines under a dated heading', () => {
  const input =
    '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A fix.\n\n## [0.1.1] - 2026-09-26\n\n- Old.\n';
  const out = releaseChangelog(input, '0.1.2', '2026-10-12');
  assert.equal(
    out,
    '# Changelog\n\n## [Unreleased]\n\n## [0.1.2] - 2026-10-12\n\n### Fixed\n\n- A fix.\n\n## [0.1.1] - 2026-09-26\n\n- Old.\n',
  );
  assert.throws(
    () => releaseChangelog(out, '0.1.2', '2026-10-12'),
    /already has/u,
  );
});

test('the changelog release refuses an empty Unreleased section', () => {
  assert.throws(
    () =>
      releaseChangelog(
        '## [Unreleased]\n\n## [0.1.1] - 2026-09-26\n\n- Old.\n',
        '0.1.2',
        '2026-10-12',
      ),
    /empty/u,
  );
  assert.throws(
    () => releaseChangelog('# Changelog\n', '0.1.2', '2026-10-12'),
    /no "## \[Unreleased\]"/u,
  );
});

test('exact workspace pins move; ranges and absent pins stay byte-identical', () => {
  const text = JSON.stringify({
    devDependencies: { '@rathnasgala2/adapter-conformance-kit': '0.1.1' },
    dependencies: { '@rathnasgala2/adapter-protocol': '^0.2.1' },
  });
  const moves = [
    {
      package: '@rathnasgala2/adapter-conformance-kit',
      from: '0.1.1',
      to: '0.1.2',
    },
    { package: '@rathnasgala2/adapter-protocol', from: '0.2.1', to: '0.2.2' },
  ];
  const out = JSON.parse(moveExactPins(text, moves));
  assert.equal(
    out.devDependencies['@rathnasgala2/adapter-conformance-kit'],
    '0.1.2',
  );
  assert.equal(out.dependencies['@rathnasgala2/adapter-protocol'], '^0.2.1');
  assert.equal(moveExactPins('{"name":"x"}', moves), '{"name":"x"}');
});
