/**
 * The deterministic theme-generation rewrite: catalog rows, the fixture
 * lock's theme/schemas/template versions and its recomputed `lockDigest`.
 * Every case runs on a fixture copy; nothing touches the real catalog.
 */

import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import { FIXTURE_LOCK_PATH } from '../scripts/release/update-adapter-catalog.mjs';
import {
  THEME_CATALOG_PATH,
  rewriteThemeLockText,
  run,
} from '../scripts/release/update-theme-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PROFILE = /** @type {any} */ (ACTIVE_DIGEST_PROFILES.lock);
/** The theme the fixture lock pins. */
const FIXTURE_THEME = '@rathnasgala2/theme-default';
/** A cataloged theme the fixture lock does not pin. */
const OTHER_THEME = '@rathnasgala2/theme-editorial';
const HEX = 'b'.repeat(64);
const digest = (/** @type {object} */ lock) => LOCK_PROFILE.digest(lock);

test('the lock rewrite moves the named theme, schemas and template and keeps lockDigest authentic', async () => {
  const text = await readFile(path.join(ROOT, FIXTURE_LOCK_PATH), 'utf8');
  const update = {
    themes: [{ package: FIXTURE_THEME, version: '4.3.0', hex: HEX }],
    schemas: '3.11.0',
    template: '4.2.0',
  };
  const next = rewriteThemeLockText(text, update, digest);
  const lock = JSON.parse(next);
  assert.equal(lock.theme.version, '4.3.0');
  assert.equal(lock.theme.integrity, `sha256:${HEX}`);
  assert.equal(lock.schemas.version, '3.11.0');
  assert.equal(lock.template.version, '4.2.0');
  assert.equal(lock.lockDigest, LOCK_PROFILE.digest(lock));
  assert.notEqual(lock.lockDigest, JSON.parse(text).lockDigest);
  assert.equal(rewriteThemeLockText(next, update, digest), next);
});

test('a theme row for another package leaves the lock theme alone', async () => {
  const text = await readFile(path.join(ROOT, FIXTURE_LOCK_PATH), 'utf8');
  const before = JSON.parse(text);
  const lock = JSON.parse(
    rewriteThemeLockText(
      text,
      { themes: [{ package: OTHER_THEME, version: '4.2.0', hex: HEX }] },
      digest,
    ),
  );
  assert.deepEqual(lock.theme, before.theme);
  assert.equal(lock.lockDigest, LOCK_PROFILE.digest(lock));
});

test('malformed versions and digests are refused', async () => {
  const text = await readFile(path.join(ROOT, FIXTURE_LOCK_PATH), 'utf8');
  for (const update of [
    { themes: [{ package: FIXTURE_THEME, version: 'v4', hex: HEX }] },
    { themes: [{ package: FIXTURE_THEME, version: '4.2.0', hex: 'abc' }] },
    { themes: [], schemas: '3.x' },
  ]) {
    assert.throws(() => rewriteThemeLockText(text, update, digest), /invalid/u);
  }
});

test('the catalog command rewrites the theme catalog and the fixture lock of a copy', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'update-theme-catalog-'));
  try {
    for (const file of [THEME_CATALOG_PATH, FIXTURE_LOCK_PATH]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await cp(path.join(ROOT, file), path.join(root, file));
    }
    await run([
      'catalog',
      '--root',
      root,
      '--schemas',
      '3.11.0',
      '--template',
      '4.2.0',
      `${FIXTURE_THEME}=4.2.0=${HEX}`,
    ]);
    const catalog = await readFile(path.join(root, THEME_CATALOG_PATH), 'utf8');
    const lock = JSON.parse(
      await readFile(path.join(root, FIXTURE_LOCK_PATH), 'utf8'),
    );
    assert.equal(catalog.split(HEX).length - 1, 1);
    assert.equal(lock.theme.integrity, `sha256:${HEX}`);
    assert.equal(lock.lockDigest, LOCK_PROFILE.digest(lock));
    await assert.rejects(run(['catalog']), /usage/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
