/**
 * Capability negotiation (DEC-020 "Negotiation"; slice brief section 5:
 * "Negotiation compares this declaration against policy and emits the exact
 * evidence-bearing decision digest; an unmet requirement is
 * `TARGET_CAPABILITY_UNAVAILABLE` before staging.").
 *
 * This module compares a validated adapter-capability declaration against a
 * policy's capability requirements and produces an evidence-bearing decision
 * naming every satisfied and unsatisfied requirement, before any staging
 * call is made. It never emulates or infers a capability the declaration
 * does not state.
 *
 * The `decisionDigest` this module computes is the adapter-protocol
 * negotiation record's own digest (domain-separated under
 * `GALA-ADAPTER-PROTOCOL-NEGOTIATION-V2\0`), distinct from the kernel-owned
 * `capabilityDecision`/`capabilityDecisionDigest` record DEC-097 section 7
 * defines (`GALA-CAPABILITY-DECISION-V2\0`), which additionally binds
 * artifact, manifest and destination facts that do not exist at negotiation
 * time and are the publish-kernel's responsibility (S2-T16). A kernel
 * negotiating a deployment intent uses this module's decision as one input
 * to that later, larger record.
 *
 * @module
 */

import { assertValidCapabilityDeclaration } from './capability.js';
import { isSameSet } from './capability-vocabulary.js';
import { domainDigest } from './digest.js';
import { AdapterProtocolError, finding } from './errors.js';

/** Domain separator for this package's own negotiation-decision digest. */
export const NEGOTIATION_DECISION_DOMAIN =
  'GALA-ADAPTER-PROTOCOL-NEGOTIATION-V2\0';

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
export function negotiateCapability(declaration, requirements) {
  assertValidCapabilityDeclaration(declaration);
  const doc = /** @type {Record<string, unknown>} */ (declaration);

  /** @type {RequirementOutcome[]} */
  const outcomes = [];

  if (requirements.destinationKind !== undefined) {
    const declared = doc.destinationKinds;
    outcomes.push(
      outcome(
        'destinationKind',
        requirements.destinationKind,
        declared,
        Array.isArray(declared) &&
          isSameSet(/** @type {string[]} */ (declared), [
            requirements.destinationKind,
          ]),
      ),
    );
  }
  pushScalarRequirement(outcomes, doc, requirements, 'staging');
  pushScalarRequirement(outcomes, doc, requirements, 'activation');
  pushScalarRequirement(outcomes, doc, requirements, 'concurrency');
  pushScalarRequirement(outcomes, doc, requirements, 'idempotencyClass');
  pushScalarRequirement(
    outcomes,
    doc,
    requirements,
    'providerInventoryAssurance',
  );

  if (requirements.verification !== undefined) {
    const declared = doc.verification;
    const declaredSet = Array.isArray(declared)
      ? /** @type {string[]} */ (declared)
      : [];
    const required = requirements.verification;
    const satisfied = required.every((capability) =>
      declaredSet.includes(capability),
    );
    outcomes.push(outcome('verification', required, declared, satisfied));
  }

  if (requirements.transport !== undefined) {
    const limits = /** @type {Record<string, unknown> | undefined} */ (
      doc.limits
    );
    const declared = limits?.transport;
    outcomes.push(
      outcome(
        'transport',
        requirements.transport,
        declared,
        declared === requirements.transport,
      ),
    );
  }

  if (requirements.configuration !== undefined) {
    const configuration = /** @type {Record<string, unknown> | undefined} */ (
      doc.configuration
    );
    for (const [key, required] of Object.entries(requirements.configuration)) {
      const declared = configuration?.[key];
      outcomes.push(
        outcome(
          `configuration.${key}`,
          required,
          declared,
          declared === required,
        ),
      );
    }
  }

  const satisfied = outcomes.every((entry) => entry.satisfied);

  /** @type {Omit<NegotiationDecision, 'decisionDigest'>} */
  const withoutDigest = {
    profile: 'gala-adapter-protocol-negotiation-v2',
    adapter: doc.adapter,
    capabilityDigest: doc.capabilityDigest,
    requirements,
    outcomes: Object.freeze(outcomes),
    satisfied,
  };

  const decisionDigest = domainDigest(
    NEGOTIATION_DECISION_DOMAIN,
    withoutDigest,
  );

  return Object.freeze({ ...withoutDigest, decisionDigest });
}

/**
 * Negotiate, then throw a typed `TARGET_CAPABILITY_UNAVAILABLE` refusal if
 * any requirement is unmet. Never called after staging has begun; a caller
 * uses this before issuing or executing deployment intent (DEC-020).
 *
 * @param {unknown} declaration a validated `adapter-capability:2.0.0` document
 * @param {CapabilityRequirements} requirements the policy's requirements
 * @returns {NegotiationDecision} the satisfied decision
 */
export function requireCapabilityMatch(declaration, requirements) {
  const decision = negotiateCapability(declaration, requirements);
  if (decision.satisfied) {
    return decision;
  }
  const findings = decision.outcomes
    .filter((entry) => !entry.satisfied)
    .map((entry) =>
      finding(
        'TARGET_CAPABILITY_UNAVAILABLE',
        'TARGET_CONSTRAINT_ERROR',
        `Adapter does not satisfy required capability "${entry.capability}": required ${JSON.stringify(
          entry.required,
        )}, declared ${JSON.stringify(entry.declared)}.`,
        { evidence: { decisionDigest: decision.decisionDigest } },
      ),
    );
  throw new AdapterProtocolError(
    'Adapter capability declaration does not satisfy the required policy before staging',
    findings,
  );
}

/**
 * @param {string} capability requirement name
 * @param {unknown} required required value
 * @param {unknown} declared declared value
 * @param {boolean} satisfied whether the declared value satisfies the requirement
 * @returns {RequirementOutcome} frozen outcome
 */
function outcome(capability, required, declared, satisfied) {
  return Object.freeze({ capability, required, declared, satisfied });
}

/**
 * Push one scalar (exact-equality) requirement outcome when the requirement
 * is present.
 *
 * @param {RequirementOutcome[]} outcomes accumulator
 * @param {Record<string, unknown>} doc the capability declaration
 * @param {CapabilityRequirements} requirements the policy requirements
 * @param {'staging' | 'activation' | 'concurrency' | 'idempotencyClass' | 'providerInventoryAssurance'} field field name shared by requirements and the declaration
 * @returns {void}
 */
function pushScalarRequirement(outcomes, doc, requirements, field) {
  const required = requirements[field];
  if (required === undefined) {
    return;
  }
  const declared = doc[field];
  outcomes.push(outcome(field, required, declared, declared === required));
}
