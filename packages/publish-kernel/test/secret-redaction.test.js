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
