import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findSecretExposure, redactSecrets } from '../src/index.js';
import { at } from './helpers.js';

test('redactSecrets replaces a credential-bearing key value', () => {
  const out = redactSecrets({
    apiKey: 'sk-live-abcdef1234567890',
    other: 'kept',
  });
  assert.equal(out.apiKey, '[REDACTED]');
  assert.equal(out.other, 'kept');
});

test('redactSecrets replaces a bearer token substring inside plain text', () => {
  const out = redactSecrets({
    log: 'request failed: Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
  });
  assert.ok(!out.log.includes('abcdefghijklmnopqrstuvwxyz'));
  assert.ok(out.log.includes('[REDACTED]'));
});

test('redactSecrets replaces a PEM private key block', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nABCD\n-----END PRIVATE KEY-----';
  const out = redactSecrets({ text: `before ${pem} after` });
  assert.ok(!out.text.includes('ABCD'));
});

test('redactSecrets replaces an AWS access key id shape', () => {
  const out = redactSecrets({ text: 'key=AKIAABCDEFGHIJKLMNOP' });
  assert.ok(!out.text.includes('AKIAABCDEFGHIJKLMNOP'));
});

test('redactSecrets is a deep clone: nested arrays and objects are walked', () => {
  const out = redactSecrets({
    nested: { list: [{ token: 'ghp_' + 'a'.repeat(40) }] },
  });
  assert.equal(at(out.nested.list, 0).token, '[REDACTED]');
});

test('redactSecrets leaves ordinary values untouched', () => {
  const input = { a: 1, b: 'hello world', c: [1, 2, 3], d: null, e: true };
  assert.deepEqual(redactSecrets(input), input);
});

test('redactSecrets keeps a "__proto__" own key as data instead of setting the clone\'s prototype', () => {
  const input = JSON.parse(
    '{"__proto__":{"secret":"sk-live-abcdef1234567890"}}',
  );
  const out = redactSecrets(input);
  assert.equal(
    Object.getPrototypeOf(out),
    Object.prototype,
    'the clone must not have an attacker-supplied prototype',
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(out, '__proto__'),
    '"__proto__" must survive as an own property of the clone',
  );
  const proto = /** @type {Record<string, unknown>} */ (
    Object.getOwnPropertyDescriptor(out, '__proto__')?.value
  );
  assert.equal(proto.secret, '[REDACTED]');
  assert.ok(
    !JSON.stringify(out).includes('sk-live-abcdef1234567890'),
    'the raw credential must not survive redaction',
  );
});

test('redactSecrets does not pollute Object.prototype via a nested "__proto__" key', () => {
  redactSecrets(
    JSON.parse('{"a":{"__proto__":{"polluted":"sk-live-abcdef1234567890"}}}'),
  );
  assert.equal(
    /** @type {Record<string, unknown>} */ ({}).polluted,
    undefined,
    'Object.prototype must remain unpolluted after redacting nested input',
  );
});

test('redactSecrets treats "constructor" and "prototype" as ordinary keys', () => {
  const out = redactSecrets({
    constructor: { password: 'hunter2' },
    prototype: { apiKey: 'sk-live-abcdef1234567890' },
    kept: 'value',
  });
  assert.equal(
    /** @type {{password: string}} */ (out.constructor).password,
    '[REDACTED]',
  );
  assert.equal(
    /** @type {{apiKey: string}} */ (out.prototype).apiKey,
    '[REDACTED]',
  );
  assert.equal(out.kept, 'value');
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
});

test('redactSecrets redacts "__proto__" credentials inside an array of objects', () => {
  const input = JSON.parse(
    '[{"__proto__":{"secret":"sk-live-abcdef1234567890"}},{"kept":"value"}]',
  );
  const out = redactSecrets(input);
  assert.equal(Object.getPrototypeOf(out[0]), Object.prototype);
  const proto = /** @type {Record<string, unknown>} */ (
    Object.getOwnPropertyDescriptor(out[0], '__proto__')?.value
  );
  assert.equal(proto.secret, '[REDACTED]');
  assert.equal(out[1].kept, 'value');
});

test('findSecretExposure detects a credential-bearing key with a non-empty value', () => {
  const findings = findSecretExposure({ password: 'hunter2' });
  assert.ok(findings.some((f) => f.code === 'SECRET_EXPOSURE_DETECTED'));
});

test('findSecretExposure ignores a credential-bearing key with an empty value', () => {
  const findings = findSecretExposure({ password: '' });
  assert.deepEqual(findings, []);
});

test('findSecretExposure detects a credential-shaped value regardless of key name', () => {
  const findings = findSecretExposure({ note: 'AKIAABCDEFGHIJKLMNOP' });
  assert.ok(findings.some((f) => f.code === 'SECRET_EXPOSURE_DETECTED'));
});

test('findSecretExposure finds nothing in an ordinary artifact-shaped record', () => {
  const findings = findSecretExposure({
    artifactId: '019c0000-0000-7000-8000-000000000001',
    artifactDigest: 'sha256:0'.repeat(8),
    paths: ['index.html', 'assets/style.css'],
  });
  assert.deepEqual(findings, []);
});

test('findSecretExposure never mutates its input', () => {
  const input = Object.freeze({ password: 'hunter2' });
  findSecretExposure(input);
  assert.equal(input.password, 'hunter2');
});

test('property: every one of a battery of credential shapes is detected', () => {
  const shapes = [
    'Bearer abcdefghijklmnopqrstuvwx==',
    'AKIAABCDEFGHIJKLMNOP',
    'ghp_' + 'x'.repeat(36),
    'github_pat_' + 'y'.repeat(22),
    'Authorization: token abc123',
  ];
  for (const shape of shapes) {
    const findings = findSecretExposure({
      field: `context ${shape} more context`,
    });
    assert.ok(findings.length > 0, `shape not detected: ${shape}`);
    const redacted = redactSecrets({ field: `context ${shape} more context` });
    assert.ok(
      redacted.field.includes('[REDACTED]'),
      `shape not redacted: ${shape}`,
    );
  }
});
