import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runIfMain } from './run-if-main.mjs';

/** @type {string} the workflow file that now carries the gitleaks scan
 * (moved out of `ci.yml`'s per-push fast gate and into the nightly full
 * gate, matching every other repository in the fleet). Kept as a constant
 * so the one place this repository's own drift check disagrees with
 * `infra`'s `checkWorkflowFragmentDrift` (still hardcoded to `ci.yml`,
 * tracked as a pending infra-side follow-up) is easy to find and delete
 * once that helper takes the target file as a parameter. */
const WORKFLOW_WITH_GITLEAKS = path.join('.github', 'workflows', 'nightly.yml');

/** @type {string} the default sibling-checkout location for `infra`,
 * relative to this repository's own root (every consumer of this script
 * runs with the repository root as its process cwd, matching the npm
 * `workflows:drift` script). */
const DEFAULT_RELATIVE_INFRA_DIR = '../infra';

/**
 * Resolve the `infra` checkout containing the canonical gitleaks fragment
 * and its drift checker: `WORKSPACE_ROOT` (DEC-015 name; mirrors the
 * SIBLING-PATHS resolution order used by `resolveTemplateDir`/
 * `resolveWorkspaceRoot`) when set to a non-empty string, else the fixed
 * relative default sibling checkout.
 *
 * @returns {string} the absolute, resolved `infra` checkout directory
 */
export function resolveInfraDir() {
  const workspaceRoot = process.env.WORKSPACE_ROOT;
  if (workspaceRoot && workspaceRoot.length > 0) {
    return path.resolve(workspaceRoot, 'infra');
  }
  return path.resolve(DEFAULT_RELATIVE_INFRA_DIR);
}

async function main() {
  const infraDir = resolveInfraDir();
  const infraDriftScript = path.join(
    infraDir,
    'scripts',
    'check-workflow-fragment-drift.mjs',
  );

  try {
    await access(infraDriftScript);
  } catch {
    process.stdout.write(
      `infra not found at ${infraDir} (no WORKSPACE_ROOT and no sibling ` +
        'checkout); skipping the gitleaks fragment drift check.\n',
    );
    return;
  }

  // `infra`'s own `checkWorkflowFragmentDrift` always reads
  // `<repositoryDirectory>/.github/workflows/ci.yml`, which no longer
  // carries the gitleaks fragment here (it moved to nightly.yml). Reuse
  // its canonical-fragment reader directly instead of the ci.yml-hardcoded
  // helper, so this stays a real byte-for-byte check against the file that
  // actually runs the scan now, not a weakened or skipped one.
  const { readCanonicalGitleaksFragment } = await import(
    pathToFileURL(infraDriftScript).href
  );
  const canonical = await readCanonicalGitleaksFragment();
  const workflowPath = path.resolve(WORKFLOW_WITH_GITLEAKS);
  let workflowSource;
  try {
    workflowSource = await readFile(workflowPath, 'utf8');
  } catch (error) {
    const message = /** @type {NodeJS.ErrnoException} */ (error).message;
    throw new Error(`could not read ${workflowPath}: ${message}`, {
      cause: error,
    });
  }

  if (!workflowSource.includes(canonical)) {
    throw new Error(
      `${workflowPath} does not contain the canonical gitleaks fragment ` +
        `from ${infraDriftScript} byte-for-byte`,
    );
  }

  process.stdout.write(
    `${WORKFLOW_WITH_GITLEAKS} matches infra/.github/workflow-fragments/gitleaks.yml byte-for-byte.\n`,
  );
}

await runIfMain(import.meta.url, main);
