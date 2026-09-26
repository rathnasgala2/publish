export type SpacesDestination = Readonly<{
    region: string;
    servedBucket: string;
    stagingBucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    publicBaseUrl?: string;
    controlPlaneEvidence?: Readonly<Record<string, unknown>>;
    fetch?: typeof globalThis.fetch;
    publicFetch?: typeof globalThis.fetch;
    onProviderCall?: (record: import("./s3.js").ProviderCallRecord) => void;
}>;
