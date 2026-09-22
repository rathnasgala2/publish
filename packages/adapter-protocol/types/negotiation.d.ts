/**
 * @typedef {Readonly<{
 *   destinationKind?: string,
 *   staging?: string,
 *   activation?: string,
 *   concurrency?: string,
 *   idempotencyClass?: string,
 *   verification?: readonly string[],
 *   providerInventoryAssurance?: string,
 *   transport?: 'filesystem' | 'http',
 *   configuration?: Readonly<Partial<Record<
 *     'redirects' | 'headers' | 'customDomains' | 'notFoundBehavior' | 'immutableCaching',
 *     boolean
 *   >>>
 * }>} CapabilityRequirements
 */
/**
 * @typedef {Readonly<{ capability: string, required: unknown, declared: unknown, satisfied: boolean }>} RequirementOutcome
 */
/**
 * @typedef {Readonly<{
 *   profile: 'gala-adapter-protocol-negotiation-v2',
 *   adapter: unknown,
 *   capabilityDigest: unknown,
 *   requirements: CapabilityRequirements,
 *   outcomes: readonly RequirementOutcome[],
 *   satisfied: boolean,
 *   decisionDigest: string
 * }>} NegotiationDecision
 */
/**
 * Negotiate one adapter-capability declaration against a policy's
 * requirements. The declaration is first validated against the closed
 * schema and exact-row table (an invalid declaration cannot negotiate).
 *
 * @param {unknown} declaration a validated `adapter-capability:2.0.0` document
 * @param {CapabilityRequirements} requirements the policy's capability
 *   requirements; an omitted field imposes no requirement
 * @returns {NegotiationDecision} the evidence-bearing decision, including
 *   its own digest
 */
export function negotiateCapability(declaration: unknown, requirements: CapabilityRequirements): NegotiationDecision;
/**
 * Negotiate, then throw a typed `TARGET_CAPABILITY_UNAVAILABLE` refusal if
 * any requirement is unmet. Never called after staging has begun; a caller
 * uses this before issuing or executing deployment intent (DEC-020).
 *
 * @param {unknown} declaration a validated `adapter-capability:2.0.0` document
 * @param {CapabilityRequirements} requirements the policy's requirements
 * @returns {NegotiationDecision} the satisfied decision
 */
export function requireCapabilityMatch(declaration: unknown, requirements: CapabilityRequirements): NegotiationDecision;
/** Domain separator for this package's own negotiation-decision digest. */
export const NEGOTIATION_DECISION_DOMAIN: "GALA-ADAPTER-PROTOCOL-NEGOTIATION-V2\0";
export type CapabilityRequirements = Readonly<{
    destinationKind?: string;
    staging?: string;
    activation?: string;
    concurrency?: string;
    idempotencyClass?: string;
    verification?: readonly string[];
    providerInventoryAssurance?: string;
    transport?: "filesystem" | "http";
    configuration?: Readonly<Partial<Record<"redirects" | "headers" | "customDomains" | "notFoundBehavior" | "immutableCaching", boolean>>>;
}>;
export type RequirementOutcome = Readonly<{
    capability: string;
    required: unknown;
    declared: unknown;
    satisfied: boolean;
}>;
export type NegotiationDecision = Readonly<{
    profile: "gala-adapter-protocol-negotiation-v2";
    adapter: unknown;
    capabilityDigest: unknown;
    requirements: CapabilityRequirements;
    outcomes: readonly RequirementOutcome[];
    satisfied: boolean;
    decisionDigest: string;
}>;
