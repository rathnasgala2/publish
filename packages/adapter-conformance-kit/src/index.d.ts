export interface ConformanceFile {
  readonly path: string;
  readonly bytes: Buffer;
}

export interface ConformanceFixture {
  adapterModule: Record<string, unknown>;
  adapterId: 'local-directory' | 'github-pages' | 'do-spaces';
  createDestination(): Promise<{
    destination: unknown;
    teardown: () => Promise<void>;
  }>;
  makeFiles(seed: number): readonly ConformanceFile[];
  computeArtifactDigest(files: readonly ConformanceFile[]): string;
  tamperServedByte(destination: unknown, generationId: string): Promise<void>;
  simulateInterruptedActivation(
    destination: unknown,
    seed: number,
  ): Promise<{ stageToken: string; generationId: string }>;
}

export declare function runAdapterConformanceSuite(
  fixture: ConformanceFixture,
): void;
