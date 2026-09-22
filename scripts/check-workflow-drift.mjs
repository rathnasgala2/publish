import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runIfMain } from './run-if-main.mjs';

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

  // The gitleaks scan runs on every push again (LOCAL-67 adversarial
  // review restored it to `ci.yml`'s fast gate; `nightly.yml` still runs
  // it too). `infra`'s own `checkWorkflowFragmentDrift` already accepts
  // the canonical fragment in either `ci.yml` or `nightly.yml`, so this
  // reuses it directly instead of re-implementing a single-file check.
  const { checkWorkflowFragmentDrift } = await import(
    pathToFileURL(infraDriftScript).href
  );
  const result = await checkWorkflowFragmentDrift(path.resolve('.'));
  if (!result.ok) {
    throw new Error(result.reason);
  }

  process.stdout.write(
    'ci.yml matches infra/.github/workflow-fragments/gitleaks.yml byte-for-byte.\n',
  );
}

await runIfMain(import.meta.url, main);
