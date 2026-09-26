/**
 * Register the complete reusable conformance suite as `node:test` cases for
 * one adapter fixture.
 *
 * @param {ConformanceFixture} fixture the adapter-specific fixture binding
 * @returns {void}
 */
export function runAdapterConformanceSuite(fixture: ConformanceFixture): void;
export type ConformanceFile = Readonly<{
    path: string;
    bytes: Buffer;
}>;
export type ConformanceFixture = {
    /**
     * the adapter's imported
     * module namespace (the object `await import(specifier)` returns)
     */
    adapterModule: Record<string, unknown>;
    /**
     * the
     * adapter's declared identity, checked against `describeCapabilities()`
     */
    adapterId: "local-directory" | "github-pages" | "do-spaces";
    /**
     *   provision one fresh, isolated destination and a teardown callback
     */
    createDestination: () => Promise<{
        destination: unknown;
        teardown: () => Promise<void>;
    }>;
    /**
     * build a
     * small deterministic file set for generation `seed`; two different seeds
     * must produce different content so activation/rollback can be told apart
     */
    makeFiles: (seed: number) => readonly ConformanceFile[];
    /**
     *   compute the adapter's own artifact-digest formula over a file set, so
     *   the kit can pass `stage` a truthful `artifactDigest` that `observe` will
     *   actually verify
     */
    computeArtifactDigest: (files: readonly ConformanceFile[]) => string;
    /**
     *   flip one byte of the currently *served* (activated) generation's
     *   content, out of band from the adapter's own lifecycle calls
     */
    tamperServedByte: (destination: unknown, generationId: string) => Promise<void>;
    /**
     *   stage a fresh generation for `seed`, then attempt to activate it in a
     *   way that is genuinely interrupted (e.g. a thrown error from an
     *   adapter-specific crash-injection hook) after staging is durably
     *   committed but strictly before the destination's activation pointer is
     *   updated. Must reject; must not change which generation is currently
     *   served. Returns the interrupted attempt's `stageToken`/`generationId`
     *   so the test can drive recovery (`cleanupStaged`) against it.
     */
    simulateInterruptedActivation: (destination: unknown, seed: number) => Promise<{
        stageToken: string;
        generationId: string;
    }>;
};
