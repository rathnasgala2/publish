/**
 * The DEC-097 section 7 request catalog, proved as data: the exact nine
 * `(stage, callClass)` rows, the single declared origin, the complete
 * header sets, the closed body/query profiles, the JCS member sort, the
 * pair-keyed `requireTemplate`, and the static `pagesDeploymentId` source
 * that no provider response or workflow value can choose.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalizeJson, domainDigest } from '@rathnasgala2/adapter-protocol';
import { ACTIVE_DIGEST_DOMAINS } from '@rathnasgala2/schemas/digest-profiles';

import {
  CALL_CLASS_BINDING_PROFILE,
  describeCapabilities,
} from '../src/capability.js';
import {
  DOMAIN_PAGES_REQUEST_CATALOG,
  RECOVERY_MODE,
} from '../src/constants.js';
import {
  CALL_CLASS_BINDING,
  GITHUB_API_ORIGIN,
  GITHUB_API_VERSION,
  buildRequestTemplates,
  callClassIdBinding,
  compareTemplatesByJcsBytes,
  requireTemplate,
} from '../src/request-catalog.js';
import {
  assertRequestMatchesTemplate,
  buildHeaders,
  buildPollUrl,
  expectedStatusUrl,
  selectDeploymentId,
} from '../src/rest.js';

const TEMPLATES = buildRequestTemplates();
const BUILD_VERSION = 'a'.repeat(40);
const PRIOR_BUILD_VERSION = 'b'.repeat(40);

/**
 * The exact nine rows DEC-097 section 7 fixes, in specification order.
 *
 * @type {readonly Readonly<{
 *   stage: string,
 *   callClass: string,
 *   method: string,
 *   target: string,
 *   responseProfile: string
 * }>[]}
 */
const EXPECTED_ROWS = [
  {
    stage: 'inspect',
    callClass: 'pages-site',
    method: 'GET',
    target: '/repos/{owner}/{repository}/pages',
    responseProfile: 'pages-site-json-v2',
  },
  {
    stage: 'activate',
    callClass: 'pages-create-deployment',
    method: 'POST',
    target: '/repos/{owner}/{repository}/pages/deployments',
    responseProfile: 'pages-create-deployment-json-v2',
  },
  {
    stage: 'activate',
    callClass: 'pages-deployment-status',
    method: 'GET',
    target: '/repos/{owner}/{repository}/pages/deployments/{pagesDeploymentId}',
    responseProfile: 'pages-deployment-status-json-v2',
  },
  {
    stage: 'observe',
    callClass: 'pages-deployment-status',
    method: 'GET',
    target: '/repos/{owner}/{repository}/pages/deployments/{pagesDeploymentId}',
    responseProfile: 'pages-deployment-status-json-v2',
  },
  {
    stage: 'inspect',
    callClass: 'pages-recovery-prior-status',
    method: 'GET',
    target: '/repos/{owner}/{repository}/pages/deployments/{pagesDeploymentId}',
    responseProfile: 'pages-deployment-status-json-v2',
  },
  {
    stage: 'cleanup-staged',
    callClass: 'pages-cancel-deployment',
    method: 'POST',
    target:
      '/repos/{owner}/{repository}/pages/deployments/{pagesDeploymentId}/cancel',
    responseProfile: 'pages-cancel-empty-v2',
  },
  {
    stage: 'cleanup-staged',
    callClass: 'pages-recovery-prior-cancel',
    method: 'POST',
    target:
      '/repos/{owner}/{repository}/pages/deployments/{pagesDeploymentId}/cancel',
    responseProfile: 'pages-cancel-empty-v2',
  },
  {
    stage: 'rollback',
    callClass: 'pages-create-deployment',
    method: 'POST',
    target: '/repos/{owner}/{repository}/pages/deployments',
    responseProfile: 'pages-create-deployment-json-v2',
  },
  {
    stage: 'rollback',
    callClass: 'pages-deployment-status',
    method: 'GET',
    target: '/repos/{owner}/{repository}/pages/deployments/{pagesDeploymentId}',
    responseProfile: 'pages-deployment-status-json-v2',
  },
];

test('the catalog is exactly the nine DEC-097 section 7 (stage, callClass) rows', () => {
  assert.equal(TEMPLATES.length, 9);
  for (const expected of EXPECTED_ROWS) {
    const row = requireTemplate(TEMPLATES, expected.stage, expected.callClass);
    assert.equal(row.method, expected.method);
    assert.equal(row.requestTargetTemplate, expected.target);
    assert.equal(row.responseProfile, expected.responseProfile);
  }
  const pairs = new Set(
    TEMPLATES.map((row) => `${String(row.stage)}/${String(row.callClass)}`),
  );
  assert.equal(pairs.size, 9);
});

test("every row's origin is exactly https://api.github.com", () => {
  assert.equal(GITHUB_API_ORIGIN, 'https://api.github.com');
  for (const row of TEMPLATES) {
    assert.equal(row.origin, 'https://api.github.com');
  }
});

test('every row carries the four mandatory fixed headers, one credential row and the derived host', () => {
  for (const row of TEMPLATES) {
    const fixed = /** @type {{name: string, value: string}[]} */ (
      row.fixedHeaders
    );
    const byName = Object.fromEntries(fixed.map((h) => [h.name, h.value]));
    assert.equal(byName.accept, 'application/vnd.github+json');
    assert.equal(byName['x-github-api-version'], GITHUB_API_VERSION);
    assert.equal(byName['accept-encoding'], 'identity');
    assert.equal(byName.connection, 'close');

    const credentials = /** @type {any[]} */ (row.credentialHeaders);
    assert.equal(credentials.length, 1);
    assert.equal(credentials[0].name, 'authorization');
    assert.equal(credentials[0].source, 'github-token');
    assert.equal(credentials[0].prefix, 'Bearer ');

    const derived = /** @type {any[]} */ (row.derivedHeaders);
    assert.ok(
      derived.some((h) => h.name === 'host' && h.source === 'origin-authority'),
    );
    assert.equal(row.canonicalQueryProfile, 'none');
  }
});

test('only the two create rows carry a body, its content-type and its content-length', () => {
  for (const row of TEMPLATES) {
    const hasBody = row.callClass === 'pages-create-deployment';
    assert.equal(
      row.requestBodyProfile,
      hasBody ? 'gala-pages-create-deployment-jcs-v2' : 'empty',
    );
    const fixed = /** @type {{name: string, value: string}[]} */ (
      row.fixedHeaders
    );
    assert.equal(
      fixed.some((h) => h.name === 'content-type'),
      hasBody,
    );
    const derived = /** @type {any[]} */ (row.derivedHeaders);
    assert.equal(
      derived.some(
        (h) =>
          h.name === 'content-length' && h.source === 'request-body-byte-count',
      ),
      hasBody,
    );
  }
});

test('the catalog is sorted by member JCS bytes', () => {
  const rendered = TEMPLATES.map((row) => canonicalizeJson(row));
  assert.deepEqual(rendered, [...rendered].sort());
  const resorted = [...TEMPLATES].sort(compareTemplatesByJcsBytes);
  assert.deepEqual(
    resorted.map((row) => canonicalizeJson(row)),
    rendered,
  );
});

test('the only template variables are owner, repository and pagesDeploymentId', () => {
  for (const row of TEMPLATES) {
    const names = [
      ...String(row.requestTargetTemplate).matchAll(/\{([A-Za-z]+)\}/gu),
    ].map((match) => String(match[1]));
    for (const name of names) {
      assert.ok(
        ['owner', 'repository', 'pagesDeploymentId'].includes(name),
        `${String(name)} is not one of the three closed template variables`,
      );
    }
  }
});

test('requireTemplate resolves by the (stage, callClass) pair and refuses an uncataloged one', () => {
  assert.notEqual(
    requireTemplate(TEMPLATES, 'activate', 'pages-deployment-status'),
    requireTemplate(TEMPLATES, 'observe', 'pages-deployment-status'),
  );
  assert.throws(
    () => requireTemplate(TEMPLATES, 'stage', 'pages-deployment-status'),
    /PAGES_CALL_NOT_IN_CATALOG/u,
  );
  assert.throws(
    () => requireTemplate(TEMPLATES, 'activate', 'pages-read-site'),
    /PAGES_CALL_NOT_IN_CATALOG/u,
  );
});

test('the call class — not a response or a workflow value — statically selects the pagesDeploymentId source', () => {
  const context = {
    apiOrigin: GITHUB_API_ORIGIN,
    owner: 'o',
    repository: 'r',
    token: 't',
    pagesBuildVersion: BUILD_VERSION,
    priorPagesBuildVersion: PRIOR_BUILD_VERSION,
    requestTemplates: TEMPLATES,
  };
  for (const row of TEMPLATES) {
    const key = `${String(row.stage)}/${String(row.callClass)}`;
    const binding = callClassIdBinding(
      String(row.stage),
      String(row.callClass),
    );
    const selected = selectDeploymentId(context, row);
    if (binding.pagesDeploymentIdSource === 'none') {
      assert.equal(selected, undefined, key);
    } else if (
      binding.pagesDeploymentIdSource === 'recovery-prior-pages-build-version'
    ) {
      assert.equal(selected, PRIOR_BUILD_VERSION, key);
    } else {
      assert.equal(selected, BUILD_VERSION, key);
    }
  }
});

test('a recovery-prior row refuses to render without the prior build version, and never borrows the current one', () => {
  const currentOnly = {
    apiOrigin: GITHUB_API_ORIGIN,
    owner: 'o',
    repository: 'r',
    token: 't',
    mode: RECOVERY_MODE,
    pagesBuildVersion: BUILD_VERSION,
    requestTemplates: TEMPLATES,
  };
  assert.throws(
    () =>
      selectDeploymentId(
        currentOnly,
        requireTemplate(TEMPLATES, 'inspect', 'pages-recovery-prior-status'),
      ),
    /PAGES_DEPLOYMENT_ID_SOURCE_UNAVAILABLE/u,
  );
});

test('a pagesDeploymentId that is not 40 lowercase hex is refused', () => {
  const context = {
    apiOrigin: GITHUB_API_ORIGIN,
    owner: 'o',
    repository: 'r',
    token: 't',
    pagesBuildVersion: 'A'.repeat(40),
    requestTemplates: TEMPLATES,
  };
  assert.throws(
    () =>
      selectDeploymentId(
        context,
        requireTemplate(TEMPLATES, 'activate', 'pages-deployment-status'),
      ),
    /PAGES_DEPLOYMENT_ID_SOURCE_UNAVAILABLE/u,
  );
});

test('a request that disagrees with its template is refused before dispatch', () => {
  const row = requireTemplate(TEMPLATES, 'inspect', 'pages-site');
  const context = {
    apiOrigin: GITHUB_API_ORIGIN,
    owner: 'o',
    repository: 'r',
    token: 'ghs-token',
    requestTemplates: TEMPLATES,
  };
  const headers = buildHeaders(context, row);
  const url = `${GITHUB_API_ORIGIN}/repos/o/r/pages`;
  assert.doesNotThrow(() =>
    assertRequestMatchesTemplate(row, {
      method: 'GET',
      url,
      headers,
      body: undefined,
    }),
  );
  assert.throws(
    () =>
      assertRequestMatchesTemplate(row, {
        method: 'POST',
        url,
        headers,
        body: undefined,
      }),
    /PAGES_REQUEST_DISAGREES_WITH_TEMPLATE/u,
  );
  assert.throws(
    () =>
      assertRequestMatchesTemplate(row, {
        method: 'GET',
        url,
        headers: { ...headers, 'accept-encoding': 'gzip' },
        body: undefined,
      }),
    /PAGES_REQUEST_DISAGREES_WITH_TEMPLATE/u,
  );
  assert.throws(
    () =>
      assertRequestMatchesTemplate(row, {
        method: 'GET',
        url,
        headers: { ...headers, 'x-extra': 'no' },
        body: undefined,
      }),
    /PAGES_REQUEST_DISAGREES_WITH_TEMPLATE/u,
  );
  assert.throws(
    () =>
      assertRequestMatchesTemplate(row, {
        method: 'GET',
        url: `${url}?per_page=1`,
        headers,
        body: undefined,
      }),
    /PAGES_REQUEST_DISAGREES_WITH_TEMPLATE/u,
  );
  assert.throws(
    () =>
      assertRequestMatchesTemplate(row, {
        method: 'GET',
        url,
        headers,
        body: '{}',
      }),
    /PAGES_REQUEST_DISAGREES_WITH_TEMPLATE/u,
  );
});

test('the poll URL is constructed independently and is never equal to the create response status_url', () => {
  const context = {
    apiOrigin: GITHUB_API_ORIGIN,
    owner: 'o',
    repository: 'r',
    token: 't',
    requestTemplates: TEMPLATES,
  };
  const poll = buildPollUrl(context, BUILD_VERSION);
  const status = expectedStatusUrl(context, BUILD_VERSION);
  assert.equal(
    poll,
    `${GITHUB_API_ORIGIN}/repos/o/r/pages/deployments/${BUILD_VERSION}`,
  );
  assert.equal(status, `${poll}/status`);
  assert.notEqual(poll, status);
});

/**
 * The `requestTemplateCatalogDigest` the declared default-origin catalog
 * digested to before the `callClassBinding` rows were declared (PUBLISH-S4-2
 * through S4-4a). LOCAL-52 (2) and schema 2.8.0 require that declaring the
 * binding leaves this preimage byte-identical; a change here is a contract
 * change, not a refactor.
 */
const PINNED_REQUEST_TEMPLATE_CATALOG_DIGEST =
  'sha256:fcfd87a63ed6038891fe6c94f0c8fd90c81c8a48275b1ee1e32599beb789ecda';

test('requestTemplateCatalogDigest is unchanged by the declared call-class binding', () => {
  assert.equal(
    domainDigest(DOMAIN_PAGES_REQUEST_CATALOG, TEMPLATES),
    PINNED_REQUEST_TEMPLATE_CATALOG_DIGEST,
  );
  const declaration = /** @type {any} */ (
    describeCapabilities({ apiOrigin: GITHUB_API_ORIGIN })
  );
  assert.equal(
    declaration.limits.requestTemplateCatalogDigest,
    PINNED_REQUEST_TEMPLATE_CATALOG_DIGEST,
  );
  for (const row of declaration.limits.requestTemplates) {
    assert.deepEqual(
      Object.keys(row).filter(
        (name) => name === 'pagesDeploymentIdSource' || name === 'recoveryOnly',
      ),
      [],
      'the binding members never leak into the template rows',
    );
  }
});

test('the declared callClassBinding rows are exactly the nine catalog pairs, closed and JCS-sorted', () => {
  assert.equal(CALL_CLASS_BINDING.length, 9);
  assert.deepEqual(
    CALL_CLASS_BINDING.map((row) => `${row.stage}/${row.callClass}`).sort(),
    TEMPLATES.map(
      (row) => `${String(row.stage)}/${String(row.callClass)}`,
    ).sort(),
  );
  for (const row of CALL_CLASS_BINDING) {
    assert.deepEqual(Object.keys(row).sort(), [
      'callClass',
      'pagesDeploymentIdSource',
      'recoveryOnly',
      'stage',
    ]);
    assert.ok(
      [
        'none',
        'intent-pages-build-version',
        'recovery-prior-pages-build-version',
      ].includes(row.pagesDeploymentIdSource),
    );
    assert.equal(typeof row.recoveryOnly, 'boolean');
    assert.equal(
      row.recoveryOnly,
      row.callClass.startsWith('pages-recovery-prior-'),
      `${row.stage}/${row.callClass}: recovery-only is exactly the two recovery-prior rows`,
    );
    assert.ok(Object.isFrozen(row));
  }
  assert.deepEqual([...CALL_CLASS_BINDING].sort(compareTemplatesByJcsBytes), [
    ...CALL_CLASS_BINDING,
  ]);
  assert.throws(
    () => callClassIdBinding('stage', 'pages-site'),
    /PAGES_CALL_NOT_IN_CATALOG/u,
  );
});

/**
 * The computation `callClassBindingDigest` used before schema 2.8.1 exported
 * its digest profiles: `adapter-protocol`'s `domainDigest` under a locally
 * restated `GALA-PROVIDER-CALL-CLASS-BINDING-V2\0` domain. Kept here, and
 * only here, as the reference the exported profile is proved against.
 *
 * @param {unknown} rows the binding rows
 * @returns {string} the tagged digest the pre-2.8.1 code produced
 */
function previousLocalCallClassBindingDigest(rows) {
  return domainDigest('GALA-PROVIDER-CALL-CLASS-BINDING-V2\0', rows);
}

test('the capability declares the binding under the schema’s own providerCallClassBinding profile', () => {
  const declaration = /** @type {any} */ (
    describeCapabilities({ apiOrigin: GITHUB_API_ORIGIN })
  );
  assert.deepEqual(declaration.limits.callClassBinding, [
    ...CALL_CLASS_BINDING,
  ]);
  assert.equal(
    declaration.limits.callClassBindingDigest,
    CALL_CLASS_BINDING_PROFILE.digest([...CALL_CLASS_BINDING]),
  );
  assert.notEqual(
    declaration.limits.callClassBindingDigest,
    declaration.limits.requestTemplateCatalogDigest,
  );
  // `describeCapabilities` already ran `assertValidCapabilityDeclaration`,
  // so reaching here proves the pinned schema admits the declared block.
  assert.equal(
    ACTIVE_DIGEST_DOMAINS.providerCallClassBinding,
    'GALA-PROVIDER-CALL-CLASS-BINDING-V2\0',
  );
});

test('the exported profile and the previous local computation agree byte-for-byte on the real rows', () => {
  // Schema 2.8.1 exports the profile this package used to restate by hand.
  // The switch is a refactor only if both produce the same bytes over the
  // real nine rows, the same rows in a different order (the profile takes
  // the rows as given, so the declaration's JCS order is what is bound)
  // and a single row.
  const rows = [...CALL_CLASS_BINDING];
  assert.equal(
    CALL_CLASS_BINDING_PROFILE.digest(rows),
    previousLocalCallClassBindingDigest(rows),
  );
  assert.equal(
    CALL_CLASS_BINDING_PROFILE.digest(rows.slice(0, 1)),
    previousLocalCallClassBindingDigest(rows.slice(0, 1)),
  );
  const reversed = [...rows].reverse();
  assert.equal(
    CALL_CLASS_BINDING_PROFILE.digest(reversed),
    previousLocalCallClassBindingDigest(reversed),
  );
  assert.notEqual(
    CALL_CLASS_BINDING_PROFILE.digest(reversed),
    CALL_CLASS_BINDING_PROFILE.digest(rows),
    'row order is part of the binding',
  );
  assert.equal(
    Buffer.from(CALL_CLASS_BINDING_PROFILE.preimage(rows)).toString('hex'),
    Buffer.concat([
      Buffer.from('GALA-PROVIDER-CALL-CLASS-BINDING-V2\0', 'utf8'),
      Buffer.from(canonicalizeJson(rows), 'utf8'),
    ]).toString('hex'),
    'the preimage bytes are identical, not just the digest',
  );
});

test('the binding digest matches the schema package golden vector for its domain', () => {
  // `@rathnasgala2/schemas` test/t03-digest-profiles.test.js, profile
  // `providerCallClassBinding`: the exact preimage and digest of the shared
  // `[{"a":"é","z":1}]` vector under the new domain, now read through the
  // exported profile itself and still pinned to the hex the schema package
  // publishes.
  const vector = [{ a: '\u00e9', z: 1 }];
  const preimage = Buffer.from(CALL_CLASS_BINDING_PROFILE.preimage(vector));
  assert.equal(
    preimage.toString('hex'),
    '47414c412d50524f56494445522d43414c4c2d434c4153532d42494e44494e472d5632005b7b2261223a22c3a9222c227a223a317d5d',
  );
  assert.equal(
    CALL_CLASS_BINDING_PROFILE.digest(vector),
    'sha256:9053ebc490104c0b938ecb7d1c3fc13907c2db2c99f0bbbfaa41310baa7a138c',
  );
});
