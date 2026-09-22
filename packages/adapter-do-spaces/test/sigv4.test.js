/**
 * SigV4 correctness.
 *
 * The fake S3 server this package's conformance tests run against verifies
 * signatures with this same module, so a passing conformance run proves
 * only self-consistency. These tests close that gap two ways: the signing-key
 * derivation and canonical-request assembly are replayed against the
 * published AWS `aws-sig-v4-test-suite` `get-vanilla` vector (an external
 * expected signature this repository did not compute), and the S3-specific
 * canonicalisation rules are asserted directly. The third, strongest check
 * is `minio-conformance.test.js`, which runs the whole suite against a real
 * MinIO server that validates every signature independently.
 */

import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  EMPTY_PAYLOAD_SHA256,
  canonicalQuery,
  canonicalUriForKey,
  deriveSigningKey,
  encodeSegment,
  formatTimestamps,
  signRequest,
} from '../src/sigv4.js';

const SUITE_SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';

test('reproduces the published aws-sig-v4-test-suite get-vanilla signature', () => {
  // The vector's request, verbatim: GET / with exactly two signed headers.
  const canonicalRequest = [
    'GET',
    canonicalUriForKey(''),
    canonicalQuery({}),
    'host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n',
    'host;x-amz-date',
    EMPTY_PAYLOAD_SHA256,
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    '20150830T123600Z',
    '20150830/us-east-1/service/aws4_request',
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n');
  const signature = createHmac(
    'sha256',
    deriveSigningKey(SUITE_SECRET, '20150830', 'us-east-1', 'service'),
  )
    .update(stringToSign, 'utf8')
    .digest('hex');

  assert.equal(
    signature,
    '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  );
});

test('the basic-format timestamps are exactly the SigV4 shapes', () => {
  const stamps = formatTimestamps(new Date('2015-08-30T12:36:00.000Z'));
  assert.equal(stamps.amzDate, '20150830T123600Z');
  assert.equal(stamps.dateStamp, '20150830');
});

test('object keys are canonicalised per segment without re-encoding separators', () => {
  assert.equal(canonicalUriForKey(''), '/');
  assert.equal(canonicalUriForKey('a/b c/d.html'), '/a/b%20c/d.html');
  assert.equal(canonicalUriForKey('_gala/staged/v2/x'), '/_gala/staged/v2/x');
  assert.equal(encodeSegment("a'b(c)*!"), 'a%27b%28c%29%2A%21');
});

test('query parameters are sorted and encoded', () => {
  assert.equal(
    canonicalQuery({
      'list-type': '2',
      prefix: 'a/b',
      'continuation-token': 'x y',
    }),
    'continuation-token=x%20y&list-type=2&prefix=a%2Fb',
  );
  assert.equal(canonicalQuery({}), '');
});

test('every S3 request signs the payload hash and the date', () => {
  const headers = signRequest(
    {
      method: 'PUT',
      host: 'served.nyc3.digitaloceanspaces.com',
      key: 'index.html',
      payloadSha256: createHash('sha256').update('body').digest('hex'),
      instant: new Date('2026-09-17T00:00:00.000Z'),
    },
    {
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: SUITE_SECRET,
      region: 'nyc3',
    },
  );
  assert.equal(headers['x-amz-date'], '20260917T000000Z');
  assert.match(
    String(headers.authorization),
    /SignedHeaders=host;x-amz-content-sha256;x-amz-date,/u,
  );
  assert.match(
    String(headers.authorization),
    /Credential=AKIDEXAMPLE\/20260917\/nyc3\/s3\/aws4_request/u,
  );
});

test('a session token is signed, not merely sent', () => {
  const headers = signRequest(
    {
      method: 'GET',
      host: 'served.nyc3.digitaloceanspaces.com',
      key: 'index.html',
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      instant: new Date('2026-09-17T00:00:00.000Z'),
    },
    {
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: SUITE_SECRET,
      region: 'nyc3',
      sessionToken: 'session-token-value',
    },
  );
  assert.equal(headers['x-amz-security-token'], 'session-token-value');
  assert.match(String(headers.authorization), /x-amz-security-token/u);
});
