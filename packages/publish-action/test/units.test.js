/**
 * Focused unit coverage for the small composition helpers: the result
 * envelope/exit-code mapping, error-to-finding conversion, CLI option
 * parsing, and adapter selection (the end-to-end paths are covered by
 * `test/e2e-npx-and-action.test.js` and `test/repository-intake.test.js`).
 *
 * @module
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildResultEnvelope,
  classifyFindings,
  hasBlockingFinding,
  EXIT_CODES,
} from '../src/result.js';
import { findingsFromError } from '../src/error-findings.js';
import { parseCliOptions } from '../src/cli-options.js';
import { assertImplementedAdapter } from '../src/adapter-select.js';
import { runCli } from '../src/bin/cli.js';

test('classifyFindings: empty set is SUCCESS', () => {
  assert.deepEqual(classifyFindings([]), {
    resultCode: 'SUCCESS',
    exitCode: EXIT_CODES.SUCCESS,
  });
});

test('classifyFindings: non-blocking findings map to FINDINGS', () => {
  assert.deepEqual(
    classifyFindings([{ code: 'X', severity: 'ADVISORY', detail: 'x' }]),
    {
      resultCode: 'FINDINGS',
      exitCode: EXIT_CODES.FINDINGS,
    },
  );
});

test('classifyFindings: TARGET_CONSTRAINT_ERROR maps to INCOMPATIBLE_CONTRACT', () => {
  assert.deepEqual(
    classifyFindings([
      { code: 'X', severity: 'TARGET_CONSTRAINT_ERROR', detail: 'x' },
    ]),
    {
      resultCode: 'INCOMPATIBLE_CONTRACT',
      exitCode: EXIT_CODES.INCOMPATIBLE_CONTRACT,
    },
  );
});

test('classifyFindings: SOURCE_ERROR/ARTIFACT_SAFETY_ERROR maps to UNSAFE_INPUT', () => {
  assert.deepEqual(
    classifyFindings([{ code: 'X', severity: 'SOURCE_ERROR', detail: 'x' }]),
    {
      resultCode: 'UNSAFE_INPUT',
      exitCode: EXIT_CODES.UNSAFE_INPUT,
    },
  );
  assert.deepEqual(
    classifyFindings([
      { code: 'X', severity: 'ARTIFACT_SAFETY_ERROR', detail: 'x' },
    ]),
    {
      resultCode: 'UNSAFE_INPUT',
      exitCode: EXIT_CODES.UNSAFE_INPUT,
    },
  );
});

test('hasBlockingFinding', () => {
  assert.equal(hasBlockingFinding([]), false);
  assert.equal(
    hasBlockingFinding([{ code: 'X', severity: 'WARNING', detail: 'x' }]),
    false,
  );
  assert.equal(
    hasBlockingFinding([{ code: 'X', severity: 'SOURCE_ERROR', detail: 'x' }]),
    true,
  );
});

test('buildResultEnvelope: freezes and includes only defined optional fields', () => {
  const envelope = buildResultEnvelope({
    command: 'validate',
    resultCode: 'SUCCESS',
    exitCode: 0,
  });
  assert.equal(envelope.command, 'validate');
  assert.ok(!('manifestPath' in envelope));
  assert.throws(() => {
    /** @type {any} */ (envelope).command = 'build';
  });
});

test('findingsFromError: a plain Error becomes one UNCLASSIFIED_FAILURE finding', () => {
  const findings = findingsFromError(new Error('boom'));
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.ok(finding);
  assert.equal(finding.code, 'UNCLASSIFIED_FAILURE');
  assert.equal(finding.severity, 'ARTIFACT_SAFETY_ERROR');
});

test('findingsFromError: an error carrying its own findings array passes through', () => {
  const error = Object.assign(new Error('typed'), {
    findings: [{ code: 'CUSTOM', severity: 'SOURCE_ERROR', detail: 'x' }],
  });
  assert.deepEqual(findingsFromError(error), error.findings);
});

test('parseCliOptions: defaults resolve under the repository directory', () => {
  const options = parseCliOptions([], '/work/dir');
  assert.equal(options.repositoryDirectory, '/work/dir');
  assert.equal(
    options.outputDirectory,
    path.join('/work/dir', '.gala', 'output'),
  );
  assert.equal(options.workDirectory, path.join('/work/dir', '.gala', 'work'));
});

test('parseCliOptions: explicit flags override defaults', () => {
  const options = parseCliOptions(
    ['--repository', '/repo', '--output', '/out', '--work', '/work'],
    '/cwd',
  );
  assert.equal(options.repositoryDirectory, '/repo');
  assert.equal(options.outputDirectory, '/out');
  assert.equal(options.workDirectory, '/work');
});

test('assertImplementedAdapter: accepts local-directory, refuses github-pages/do-spaces and an unknown value', () => {
  assert.doesNotThrow(() => assertImplementedAdapter('local-directory'));
  for (const adapterId of ['github-pages', 'do-spaces', 'not-an-adapter']) {
    assert.throws(
      () => assertImplementedAdapter(adapterId),
      (/** @type {any} */ error) => {
        assert.equal(error.findings[0].code, 'TARGET_CAPABILITY_UNAVAILABLE');
        return true;
      },
    );
  }
});

test('runCli: an unknown subcommand fails closed with MISSING_DEPENDENCY (exit 4) and never runs a build', async () => {
  const { envelope } = await runCli(['deploy'], process.cwd());
  assert.equal(envelope.resultCode, 'MISSING_DEPENDENCY');
  assert.equal(envelope.exitCode, EXIT_CODES.MISSING_DEPENDENCY);
});

test('runCli: there is no "publish" subcommand', async () => {
  const { envelope } = await runCli(['publish'], process.cwd());
  assert.equal(envelope.resultCode, 'MISSING_DEPENDENCY');
});
