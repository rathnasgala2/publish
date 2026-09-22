/**
 * The catalog as data: DEC-097 section 7's exact 24-row Spaces union.
 *
 * `request-catalog-binding.test.js` proves the adapter cannot issue anything
 * outside the catalog. This file proves the catalog itself is the one
 * DEC-097 specifies — the exact `(stage, callClass)` set, the exact origin
 * assignment, the exact per-row header sets, the exact per-call matrix and
 * the member-JCS sort — so the two together are a closed claim rather than
 * two halves that agree with each other and with nothing else.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalizeJson } from '@rathnasgala2/adapter-protocol';

import { deriveOrigins } from '../src/origins.js';
import {
  REQUEST_TEMPLATE_PROFILE,
  RESPONSE_PROFILES,
  buildRequestTemplates,
  requireTemplate,
} from '../src/request-catalog.js';

const ORIGINS = deriveOrigins({
  region: 'nyc3',
  servedBucket: 'served',
  stagingBucket: 'staging',
});
const SERVED = ORIGINS.servedApiOrigin;
const STAGING = ORIGINS.stagingApiOrigin;

/** DEC-097 section 7's Spaces union, as `stage/callClass method origin`. */
const UNION = Object.freeze({
  'inspect/object-head': ['HEAD', SERVED],
  'inspect/generation-list': ['GET', STAGING],
  'stage/object-put': ['PUT', STAGING],
  'stage/multipart-create': ['POST', STAGING],
  'stage/multipart-part': ['PUT', STAGING],
  'stage/multipart-complete': ['POST', STAGING],
  'stage/generation-marker-put': ['PUT', STAGING],
  'activate/generation-marker-put': ['PUT', SERVED],
  'activate/served-root-put': ['PUT', SERVED],
  'activate/served-root-multipart-create': ['POST', SERVED],
  'activate/served-root-multipart-part': ['PUT', SERVED],
  'activate/served-root-multipart-complete': ['POST', SERVED],
  'activate/served-root-delete': ['DELETE', SERVED],
  'observe/object-head': ['HEAD', SERVED],
  'observe/generation-list': ['GET', SERVED],
  'cleanup-staged/staged-object-delete': ['DELETE', STAGING],
  'cleanup-staged/staged-multipart-abort': ['DELETE', STAGING],
  'cleanup-staged/served-root-multipart-abort': ['DELETE', SERVED],
  'rollback/generation-marker-put': ['PUT', SERVED],
  'rollback/served-root-put': ['PUT', SERVED],
  'rollback/served-root-multipart-create': ['POST', SERVED],
  'rollback/served-root-multipart-part': ['PUT', SERVED],
  'rollback/served-root-multipart-complete': ['POST', SERVED],
  'rollback/served-root-delete': ['DELETE', SERVED],
});

/**
 * DEC-097's per-call matrix:
 * `target | canonicalQueryProfile | requestBodyProfile | extra headers | responseProfile`.
 * "metadata" is the three-row object metadata set; an `x-amz-acl` or
 * `content-type` entry is a fixed header beyond the two universal ones.
 */
const MATRIX = Object.freeze({
  'inspect/object-head': [
    '/{objectKey}',
    'none',
    'empty',
    [],
    'spaces-head-object-v2',
  ],
  'observe/object-head': [
    '/{objectKey}',
    'none',
    'empty',
    [],
    'spaces-head-object-v2',
  ],
  'inspect/generation-list': [
    '/',
    'spaces-list-v2',
    'empty',
    [],
    'spaces-list-objects-v2',
  ],
  'observe/generation-list': [
    '/',
    'spaces-list-v2',
    'empty',
    [],
    'spaces-list-objects-v2',
  ],
  'stage/object-put': [
    '/{objectKey}',
    'none',
    'spaces-object-slice-v2',
    ['metadata', 'x-amz-acl=private'],
    'spaces-put-object-v2',
  ],
  'activate/served-root-put': [
    '/{objectKey}',
    'none',
    'spaces-object-slice-v2',
    ['metadata', 'x-amz-acl=public-read'],
    'spaces-put-object-v2',
  ],
  'rollback/served-root-put': [
    '/{objectKey}',
    'none',
    'spaces-object-slice-v2',
    ['metadata', 'x-amz-acl=public-read'],
    'spaces-put-object-v2',
  ],
  'stage/generation-marker-put': [
    '/{objectKey}',
    'none',
    'spaces-generation-marker-jcs-v2',
    ['metadata', 'x-amz-acl=private'],
    'spaces-put-object-v2',
  ],
  'activate/generation-marker-put': [
    '/{objectKey}',
    'none',
    'spaces-generation-marker-jcs-v2',
    ['metadata', 'x-amz-acl=public-read'],
    'spaces-put-object-v2',
  ],
  'rollback/generation-marker-put': [
    '/{objectKey}',
    'none',
    'spaces-generation-marker-jcs-v2',
    ['metadata', 'x-amz-acl=public-read'],
    'spaces-put-object-v2',
  ],
  'stage/multipart-create': [
    '/{objectKey}',
    'spaces-multipart-create-v2',
    'empty',
    ['metadata', 'x-amz-acl=private'],
    'spaces-create-multipart-v2',
  ],
  'activate/served-root-multipart-create': [
    '/{objectKey}',
    'spaces-multipart-create-v2',
    'empty',
    ['metadata', 'x-amz-acl=public-read'],
    'spaces-create-multipart-v2',
  ],
  'rollback/served-root-multipart-create': [
    '/{objectKey}',
    'spaces-multipart-create-v2',
    'empty',
    ['metadata', 'x-amz-acl=public-read'],
    'spaces-create-multipart-v2',
  ],
  'stage/multipart-part': [
    '/{objectKey}',
    'spaces-multipart-part-v2',
    'spaces-object-slice-v2',
    [],
    'spaces-upload-part-v2',
  ],
  'activate/served-root-multipart-part': [
    '/{objectKey}',
    'spaces-multipart-part-v2',
    'spaces-object-slice-v2',
    [],
    'spaces-upload-part-v2',
  ],
  'rollback/served-root-multipart-part': [
    '/{objectKey}',
    'spaces-multipart-part-v2',
    'spaces-object-slice-v2',
    [],
    'spaces-upload-part-v2',
  ],
  'stage/multipart-complete': [
    '/{objectKey}',
    'spaces-upload-id-v2',
    'spaces-multipart-completion-xml-v2',
    ['content-type=application/xml'],
    'spaces-complete-multipart-v2',
  ],
  'activate/served-root-multipart-complete': [
    '/{objectKey}',
    'spaces-upload-id-v2',
    'spaces-multipart-completion-xml-v2',
    ['content-type=application/xml'],
    'spaces-complete-multipart-v2',
  ],
  'rollback/served-root-multipart-complete': [
    '/{objectKey}',
    'spaces-upload-id-v2',
    'spaces-multipart-completion-xml-v2',
    ['content-type=application/xml'],
    'spaces-complete-multipart-v2',
  ],
  'cleanup-staged/staged-object-delete': [
    '/{objectKey}',
    'none',
    'empty',
    [],
    'spaces-delete-object-v2',
  ],
  'activate/served-root-delete': [
    '/{objectKey}',
    'none',
    'empty',
    [],
    'spaces-delete-object-v2',
  ],
  'rollback/served-root-delete': [
    '/{objectKey}',
    'none',
    'empty',
    [],
    'spaces-delete-object-v2',
  ],
  'cleanup-staged/staged-multipart-abort': [
    '/{objectKey}',
    'spaces-upload-id-v2',
    'empty',
    [],
    'spaces-abort-multipart-v2',
  ],
  'cleanup-staged/served-root-multipart-abort': [
    '/{objectKey}',
    'spaces-upload-id-v2',
    'empty',
    [],
    'spaces-abort-multipart-v2',
  ],
});

/**
 * @param {Readonly<Record<string, unknown>>} row the template row
 * @returns {string} the row's `stage/callClass` key
 */
function keyOf(row) {
  return `${String(row.stage)}/${String(row.callClass)}`;
}

test('the catalog is exactly DEC-097 section 7’s 24-row Spaces union, one row per (stage, callClass)', () => {
  const templates = buildRequestTemplates(ORIGINS);
  assert.equal(templates.length, 24);
  assert.deepEqual(templates.map(keyOf).sort(), Object.keys(UNION).sort());
  for (const [pair, [method, origin]] of Object.entries(UNION)) {
    const [stage, ...rest] = pair.split('/');
    const row = requireTemplate(
      templates,
      /** @type {string} */ (stage),
      rest.join('/'),
    );
    assert.equal(row.method, method, `${pair} method`);
    assert.equal(row.origin, origin, `${pair} origin`);
  }
});

test('neither declared origin is the credential-free website origin, and no row picks one at runtime', () => {
  const templates = buildRequestTemplates(ORIGINS);
  const origins = new Set(templates.map((row) => String(row.origin)));
  assert.deepEqual([...origins].sort(), [SERVED, STAGING].sort());
  for (const row of templates) {
    assert.notEqual(row.origin, ORIGINS.publicOrigin);
    assert.equal(typeof row.origin, 'string');
    assert.ok(String(row.origin).startsWith('https://'));
  }
});

test('every row carries the four derived, two fixed and one credential header, and an optional session-token row iff that credential exists', () => {
  for (const hasSessionToken of [false, true]) {
    const templates = buildRequestTemplates(ORIGINS, { hasSessionToken });
    for (const row of templates) {
      const derived = /** @type {{name: string, source: string}[]} */ (
        row.derivedHeaders
      );
      const fixed = /** @type {{name: string, value: string}[]} */ (
        row.fixedHeaders
      );
      const credentials = /** @type {{name: string, source: string}[]} */ (
        row.credentialHeaders
      );
      assert.deepEqual(
        derived.slice(0, 4),
        [
          { name: 'host', source: 'origin-authority' },
          { name: 'content-length', source: 'request-body-byte-count' },
          { name: 'x-amz-date', source: 'sigv4-basic-timestamp' },
          { name: 'x-amz-content-sha256', source: 'request-body-sha256' },
        ],
        keyOf(row),
      );
      assert.deepEqual(
        fixed.slice(0, 2),
        [
          { name: 'accept-encoding', value: 'identity' },
          { name: 'connection', value: 'close' },
        ],
        keyOf(row),
      );
      assert.deepEqual(
        credentials.map((header) => header.name),
        hasSessionToken
          ? ['authorization', 'x-amz-security-token']
          : ['authorization'],
        keyOf(row),
      );
      assert.equal(credentials[0]?.source, 'spaces-authorization-value');
    }
  }
});

test('every row matches DEC-097’s per-call matrix exactly', () => {
  const templates = buildRequestTemplates(ORIGINS);
  assert.deepEqual(Object.keys(MATRIX).sort(), Object.keys(UNION).sort());
  for (const row of templates) {
    const expected = /** @type {any[]} */ (
      /** @type {any} */ (MATRIX)[keyOf(row)]
    );
    const [target, queryProfile, bodyProfile, extras, responseProfile] =
      expected;
    assert.equal(row.requestTargetTemplate, target, keyOf(row));
    assert.equal(row.canonicalQueryProfile, queryProfile, keyOf(row));
    assert.equal(row.requestBodyProfile, bodyProfile, keyOf(row));
    assert.equal(row.responseProfile, responseProfile, keyOf(row));

    const derivedNames = /** @type {{name: string}[]} */ (
      row.derivedHeaders
    ).map((header) => header.name);
    const wantsMetadata = extras.includes('metadata');
    assert.deepEqual(
      derivedNames.slice(4),
      wantsMetadata
        ? ['content-type', 'cache-control', 'x-amz-meta-gala-sha256']
        : [],
      `${keyOf(row)} object metadata set`,
    );

    const extraFixed = /** @type {{name: string, value: string}[]} */ (
      row.fixedHeaders
    )
      .slice(2)
      .map((header) => `${header.name}=${header.value}`);
    assert.deepEqual(
      extraFixed.sort(),
      extras
        .filter((/** @type {string} */ entry) => entry !== 'metadata')
        .sort(),
      `${keyOf(row)} extra fixed headers`,
    );
  }
});

test('only the two list rows use spaces-list-v2', () => {
  const templates = buildRequestTemplates(ORIGINS);
  assert.deepEqual(
    templates
      .filter((row) => row.canonicalQueryProfile === 'spaces-list-v2')
      .map(keyOf)
      .sort(),
    ['inspect/generation-list', 'observe/generation-list'],
  );
});

test('the catalog is sorted by member JCS bytes', () => {
  const templates = buildRequestTemplates(ORIGINS);
  const rendered = templates.map((row) => canonicalizeJson(row));
  assert.deepEqual(rendered, [...rendered].sort());
});

test('the catalog is stable, frozen and profile-labelled, and the response catalog is the eight spaces-* profiles', () => {
  assert.equal(REQUEST_TEMPLATE_PROFILE, 'gala-do-spaces-sigv4-v2');
  assert.deepEqual(
    [...RESPONSE_PROFILES],
    [
      'spaces-abort-multipart-v2',
      'spaces-complete-multipart-v2',
      'spaces-create-multipart-v2',
      'spaces-delete-object-v2',
      'spaces-head-object-v2',
      'spaces-list-objects-v2',
      'spaces-put-object-v2',
      'spaces-upload-part-v2',
    ],
  );
  const templates = buildRequestTemplates(ORIGINS);
  assert.ok(Object.isFrozen(templates));
  assert.deepEqual(
    canonicalizeJson(templates),
    canonicalizeJson(buildRequestTemplates(ORIGINS)),
  );
  // Every declared response profile is one the adapter says it can parse.
  for (const row of templates) {
    assert.ok(RESPONSE_PROFILES.includes(String(row.responseProfile)));
  }
});

test('requireTemplate refuses a pair the catalog does not declare', () => {
  const templates = buildRequestTemplates(ORIGINS);
  for (const [stage, callClass] of [
    ['stage', 'object-get'],
    ['observe', 'served-root-put'],
    ['inspect', 'generation-marker-put'],
    ['rollback', 'generation-list'],
    ['cleanup-staged', 'object-head'],
  ]) {
    assert.throws(
      () =>
        requireTemplate(
          templates,
          /** @type {string} */ (stage),
          /** @type {string} */ (callClass),
        ),
      /SPACES_CALL_NOT_IN_CATALOG/u,
      `${stage}/${callClass}`,
    );
  }
});
