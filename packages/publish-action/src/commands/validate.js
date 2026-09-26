/**
 * `validate`: read-only, deterministic for the same revision, lock and
 * toolchain. Builds and schema-validates the normalized `build-input:2.0.0`
 * document without ever calling `renderPublication` (which creates
 * directories) or any adapter call — nothing is written (S2 brief section
 * 5).
 *
 * @module
 */

import { findingsFromError } from '../error-findings.js';
import { buildBuildInputFromRepository } from '../normalize/repository-intake.js';
import { buildResultEnvelope, classifyFindings } from '../result.js';

/**
 * @param {{repositoryDirectory: string}} options the repository to validate
 * @returns {Promise<import('../types.js').ResultEnvelope>} the closed result envelope
 */
export async function runValidate({ repositoryDirectory }) {
  try {
    await buildBuildInputFromRepository({ repositoryDirectory });
    return buildResultEnvelope({
      command: 'validate',
      resultCode: 'SUCCESS',
      exitCode: 0,
      findings: [],
    });
  } catch (error) {
    const findings = findingsFromError(error);
    const { resultCode, exitCode } = classifyFindings(findings);
    return buildResultEnvelope({
      command: 'validate',
      resultCode,
      exitCode,
      findings,
    });
  }
}
