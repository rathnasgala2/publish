/**
 * Run the Action end to end against the real process environment, writing
 * outputs and the machine-readable result envelope, then return the exit
 * code the runner entry should use.
 *
 * @param {NodeJS.ProcessEnv} [env] the process environment (injectable for tests)
 * @returns {Promise<number>} the process exit code
 */
export function runAction(env?: NodeJS.ProcessEnv): Promise<number>;
