/**
 * The workflow's only Gala client: exactly two requests, to exactly two
 * routes, with exactly two credential shapes.
 *
 * Both requests are fixed before their credential is read, neither follows a
 * redirect, and neither ever writes a credential — the OIDC assertion or the
 * reporting capability — into a log line, an evidence record, a carrier or a
 * job output. What crosses back out of this module is a classified outcome:
 * the response's own closed state, or a typed refusal naming the category
 * and nothing else.
 *
 * The API origin is never hard-coded. It arrives as an explicit input from
 * the workflow's `gala_api_origin`, is validated here, and an origin that is
 * not an exact scheme/host/port origin is refused before a request is built.
 *
 * @module
 */

/** The exchange route, appended to the validated origin. */
export const RECEIPT_EXCHANGE_PATH = '/v2/workloads/github/receipt-exchanges';

/** The receipt-ingestion route, appended to the validated origin. */
export const DEPLOYMENT_RECEIPTS_PATH = '/v2/workloads/deployment-receipts';

/** The exact audience the `deployment-intent` purpose is bound to. */
export const DEPLOYMENT_INTENT_AUDIENCE =
  'urn:gala:workload:deployment-intent:v2';

/** The exact audience the `deployment-receipt` purpose is bound to. */
export const DEPLOYMENT_RECEIPT_AUDIENCE =
  'urn:gala:workload:deployment-receipt:v2';

/** The maximum response entity either route may return, in bytes. */
export const MAXIMUM_RESPONSE_BYTES = 2097152;

/**
 * A typed, credential-free failure. `code` is the workflow's own stable
 * category and `problemCode` is the API's wire code when the API answered
 * with a problem document; neither ever carries a token, a capability or a
 * rejected value.
 */
export class GalaApiError extends Error {
  /**
   * @param {string} code the stable workflow category
   * @param {string} detail the credential-free detail
   * @param {{status?: number, problemCode?: string, retryable?: boolean, attempts?: number, errors?: readonly {pointer: string, code: string}[], pageLoss?: {previousPageCount: number, candidatePageCount: number, lostPageCount: number}}} [context]
   *   the classified response context
   */
  constructor(code, detail, context = {}) {
    super(`${code}: ${detail}`);
    this.name = 'GalaApiError';
    /** @type {string} */
    this.code = code;
    /** @type {number | null} */
    this.status = context.status ?? null;
    /** @type {string | null} */
    this.problemCode = context.problemCode ?? null;
    /** @type {boolean} */
    this.retryable = context.retryable ?? false;
    /** @type {number} how many sends were made before this refusal */
    this.attempts = context.attempts ?? 1;
    /**
     * The page counts a `PAGE_LOSS_GUARD` refusal carries (schemas 3.25.0
     * `PageLossGuardDetails`), or null for any other answer.
     *
     * @type {{previousPageCount: number, candidatePageCount: number, lostPageCount: number} | null}
     */
    this.pageLoss = context.pageLoss ?? null;
    /**
     * The problem's `errors[]` field errors (pointer and code only), so a
     * `422 VALIDATION_FAILED` on a derived member names which one the API
     * disagreed with (LOCAL-57/LOCAL-60) without echoing any value.
     *
     * @type {readonly {pointer: string, code: string}[]}
     */
    this.errors = Object.freeze(
      (context.errors ?? []).map((entry) => ({
        pointer: String(entry.pointer),
        code: String(entry.code),
      })),
    );
  }
}

/**
 * Validate one API origin and return it without a trailing slash.
 *
 * HTTPS is the only admitted scheme. A loopback `http` origin is admitted
 * only when `WORKLOAD_ALLOW_LOOPBACK_ORIGIN` is exactly `1`, which is
 * set by this repository's own fixture-server tests and by nothing in any
 * workflow — so a misconfigured caller cannot downgrade a real exchange to
 * cleartext, and the allowance is one grep away from being audited.
 *
 * @param {string} value the caller-supplied origin
 * @returns {string} the validated origin
 */
export function resolveApiOrigin(value) {
  /** @type {URL} */
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GalaApiError(
      'GALA_API_ORIGIN_INVALID',
      'the gala_api_origin input is not an absolute URL',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new GalaApiError(
      'GALA_API_ORIGIN_INVALID',
      'the gala_api_origin input carries embedded credentials',
    );
  }
  if (url.search !== '' || url.hash !== '' || url.pathname !== '/') {
    throw new GalaApiError(
      'GALA_API_ORIGIN_INVALID',
      'the gala_api_origin input is not an exact scheme/host/port origin',
    );
  }
  const loopback =
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === '[::1]') &&
    process.env.WORKLOAD_ALLOW_LOOPBACK_ORIGIN === '1';
  if (url.protocol !== 'https:' && !loopback) {
    throw new GalaApiError(
      'GALA_API_ORIGIN_INVALID',
      'the gala_api_origin input is not an https origin',
    );
  }
  return url.origin;
}

/**
 * Request one GitHub Actions OIDC assertion for an exact audience.
 *
 * The runner bearer is read into a local and used once. The assertion is
 * returned to the caller and never written anywhere by this module.
 *
 * @param {string} audience the exact audience
 * @returns {Promise<string>} the compact assertion
 */
export async function requestOidcAssertion(audience) {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (url === undefined || url === '' || token === undefined || token === '') {
    throw new GalaApiError(
      'WORKLOAD_OIDC_UNAVAILABLE',
      'this job does not hold id-token: write',
    );
  }
  const response = await fetch(
    `${url}&audience=${encodeURIComponent(audience)}`,
    { headers: { authorization: `Bearer ${token}` }, redirect: 'error' },
  );
  if (response.status !== 200) {
    throw new GalaApiError(
      'WORKLOAD_OIDC_REQUEST_FAILED',
      `the token endpoint answered HTTP ${response.status}`,
      { status: response.status },
    );
  }
  const value = /** @type {Record<string, unknown>} */ (await response.json())
    .value;
  if (typeof value !== 'string' || value.split('.').length !== 3) {
    throw new GalaApiError(
      'WORKLOAD_OIDC_REQUEST_FAILED',
      'the token endpoint did not return a compact three-segment assertion',
    );
  }
  return value;
}

/**
 * Send one already validated JSON body and read the bounded response.
 *
 * @param {{
 *   origin: string,
 *   path: string,
 *   authorization: string,
 *   body: Record<string, unknown>
 * }} call the fixed request
 * @returns {Promise<{status: number, body: Record<string, unknown> | null, byteCount: number, retryAfterSeconds: number | null}>}
 *   the response
 */
async function send(call) {
  const bytes = Buffer.from(JSON.stringify(call.body), 'utf8');
  const response = await fetch(`${call.origin}${call.path}`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: call.authorization,
      'content-type': 'application/json',
      accept: 'application/json, application/problem+json',
    },
    body: bytes,
  });
  const text = await response.text();
  if (text.length > MAXIMUM_RESPONSE_BYTES) {
    throw new GalaApiError(
      'GALA_API_RESPONSE_TOO_LARGE',
      `the response exceeded ${MAXIMUM_RESPONSE_BYTES} bytes`,
      { status: response.status },
    );
  }
  /** @type {Record<string, unknown> | null} */
  let body = null;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return {
    status: response.status,
    body,
    byteCount: bytes.byteLength,
    retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
  };
}

/**
 * The seconds a `Retry-After` header asks for (delta-seconds or an HTTP
 * date), or null when absent or unreadable.
 *
 * @param {string | null} value the header value
 * @returns {number | null} the seconds
 */
function parseRetryAfter(value) {
  if (value === null || value.trim() === '') {
    return null;
  }
  if (/^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  const at = Date.parse(value);
  return Number.isNaN(at)
    ? null
    : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** Seconds to wait before each send: four sends in about 2.5 minutes. */
export const RETRY_DELAYS_SECONDS = Object.freeze([0, 20, 45, 90]);

/** The longest a `Retry-After` is honoured for, in seconds. */
const MAXIMUM_RETRY_AFTER_SECONDS = 180;

/** Network error codes `fetch` surfaces as `error.cause.code` worth resending. */
const RETRYABLE_TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * @param {unknown} error a thrown value from `fetch`
 * @returns {string | null} the retryable transport code, or null
 */
function transportCode(error) {
  const code = /** @type {any} */ (error)?.cause?.code;
  return typeof code === 'string' && RETRYABLE_TRANSPORT_CODES.has(code)
    ? code
    : null;
}

/** Statuses that are final answers even when a body claims `retryable`. */
const FINAL_STATUSES = new Set([400, 401, 403, 404, 409, 410, 422]);

/**
 * @param {{status: number, body: Record<string, unknown> | null}} response the answer
 * @returns {boolean} whether the answer is worth resending
 */
function isRetryableAnswer(response) {
  if (response.status === 200 || response.status === 202) {
    return false;
  }
  if (response.status === 429 || response.status === 503) {
    return true;
  }
  return (
    !FINAL_STATUSES.has(response.status) &&
    response.body !== null &&
    response.body.retryable === true
  );
}

/**
 * Send with the retry schedule. A retryable answer or transport error is
 * resent after the next delay (a larger `Retry-After` wins); anything else
 * returns at once. Each wait logs one credential-free line.
 *
 * @param {Parameters<typeof send>[0] & {
 *   label: string,
 *   mintAuthorization?: () => Promise<string>,
 *   sleep?: (milliseconds: number) => Promise<void>,
 *   log?: (line: string) => void
 * }} call the request and the test seams
 * @returns {Promise<Awaited<ReturnType<typeof send>> & {attempts: number}>} the last answer
 */
async function sendWithRetry(call) {
  const sleep =
    call.sleep ??
    ((/** @type {number} */ ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)));
  const log =
    call.log ??
    ((/** @type {string} */ line) => process.stdout.write(`${line}\n`));
  const total = RETRY_DELAYS_SECONDS.length;
  let authorization = call.authorization;
  for (let attempt = 1; ; attempt += 1) {
    /** @type {Awaited<ReturnType<typeof send>> | null} */
    let response = null;
    let status = 0;
    let code;
    try {
      response = await send({ ...call, authorization });
      status = response.status;
      code =
        typeof response.body?.code === 'string' ? response.body.code : 'none';
      if (!isRetryableAnswer(response)) {
        return { ...response, attempts: attempt };
      }
    } catch (error) {
      const transport = transportCode(error);
      if (transport === null || attempt === total) {
        throw error;
      }
      code = transport;
    }
    if (attempt === total) {
      return {
        .../** @type {NonNullable<typeof response>} */ (response),
        attempts: attempt,
      };
    }
    const wait = Math.min(
      Math.max(
        RETRY_DELAYS_SECONDS[attempt] ?? 0,
        response?.retryAfterSeconds ?? 0,
      ),
      Math.max(MAXIMUM_RETRY_AFTER_SECONDS, RETRY_DELAYS_SECONDS[attempt] ?? 0),
    );
    log(
      `${call.label} refused (retryable) status=${status} code=${code} attempt=${attempt}/${total}, retrying in ${wait}s`,
    );
    await sleep(wait * 1000);
    if (call.mintAuthorization !== undefined) {
      authorization = await call.mintAuthorization();
    }
  }
}

/**
 * The page counts of a `PAGE_LOSS_GUARD` refusal (the problem's `details`,
 * schemas 3.25.1), or null when the answer is not one or carries no counts.
 *
 * @param {Record<string, unknown> | null} body the problem document
 * @param {string | null} problemCode the problem code
 * @returns {{previousPageCount: number, candidatePageCount: number, lostPageCount: number} | null} the counts
 */
function pageLossDetails(body, problemCode) {
  if (body === null || problemCode !== 'PAGE_LOSS_GUARD') {
    return null;
  }
  const details = /** @type {Record<string, unknown> | undefined} */ (
    body.details
  );
  if (details === undefined || details === null) {
    return null;
  }
  const { previousPageCount, candidatePageCount, lostPageCount } = details;
  return Number.isInteger(previousPageCount) &&
    Number.isInteger(candidatePageCount) &&
    Number.isInteger(lostPageCount)
    ? {
        previousPageCount: /** @type {number} */ (previousPageCount),
        candidatePageCount: /** @type {number} */ (candidatePageCount),
        lostPageCount: /** @type {number} */ (lostPageCount),
      }
    : null;
}

/**
 * Turn a non-success answer into a typed refusal carrying the API's own wire
 * code. The problem document's `detail` is deliberately not propagated: it
 * is server-authored text this job has no reason to re-emit.
 *
 * @param {{status: number, body: Record<string, unknown> | null}} response the answer
 * @param {string} code the workflow category to raise
 * @param {number} [attempts] how many sends were made
 * @returns {never} never returns
 */
function refuse(response, code, attempts = 1) {
  const problemCode =
    response.body !== null && typeof response.body.code === 'string'
      ? response.body.code
      : null;
  const pageLoss = pageLossDetails(response.body, problemCode);
  const retryable = response.body !== null && response.body.retryable === true;
  const errors =
    response.body !== null && Array.isArray(response.body.errors)
      ? response.body.errors.filter(
          (/** @type {any} */ entry) =>
            typeof entry?.pointer === 'string' &&
            typeof entry?.code === 'string',
        )
      : [];
  throw new GalaApiError(
    code,
    `the API answered HTTP ${response.status}${problemCode === null ? '' : ` ${problemCode}`}${errors.length === 0 ? '' : ` at ${errors.map((/** @type {any} */ entry) => entry.pointer).join(', ')}`}`,
    problemCode === null
      ? { status: response.status, retryable, errors, attempts }
      : {
          status: response.status,
          problemCode,
          retryable,
          errors,
          attempts,
          ...(pageLoss === null ? {} : { pageLoss }),
        },
  );
}

/**
 * The 2.8.0 receipt-exchange response union: three flat members keyed on an
 * optional constant `kind`, each mapped here onto the workflow's own closed
 * state vocabulary. `kind` is optional on the wire so a 2.7.x-era body still
 * validates; the arms stay mutually exclusive on `purpose` and `state`
 * without it, so this client classifies on those and treats `kind`, when
 * present, as a claim that must agree.
 */
export const RESPONSE_KINDS = Object.freeze({
  'deployment-intent': 'deployment-authorization',
  'deployment-receipt-capability-issued': 'capability-issued',
  'deployment-receipt-submission-recorded': 'submission-recorded',
});

/**
 * Classify one `200` exchange body on `purpose` and `state` alone, exactly
 * as a 2.7.x consumer did.
 *
 * @param {Record<string, unknown>} body the response entity
 * @returns {'deployment-authorization' | 'capability-issued' | 'submission-recorded' | null}
 *   the closed state, or `null` when the body is none of the three
 */
function classifyExchangeBody(body) {
  if (body.purpose === 'deployment-intent') {
    for (const member of [
      'deploymentIntent',
      'reportChallengeId',
      'reportChallengeExpiresAt',
    ]) {
      if (body[member] === undefined) {
        throw new GalaApiError(
          'WORKLOAD_EXCHANGE_RESPONSE_INVALID',
          `the 200 response omits ${member}`,
          { status: 200 },
        );
      }
    }
    return 'deployment-authorization';
  }
  if (body.purpose === 'deployment-receipt') {
    if (body.state === 'capability-issued') {
      return 'capability-issued';
    }
    if (body.state === 'submission-recorded') {
      return 'submission-recorded';
    }
  }
  return null;
}

/**
 * `POST /v2/workloads/github/receipt-exchanges` with the purpose's own OIDC
 * assertion, and classify the closed response union.
 *
 * The classified `state` is decided on `purpose` and `state`, which every
 * server from 2.7.x on sends. A 2.8.0 server also sends `kind`; when it is
 * present it must name the same arm, and a `kind` that disagrees with the
 * arm the body actually is — or one outside the closed three — is a
 * malformed response, never a fourth state. The `kind` the server sent (or
 * `null` for an older server) is returned so the job can record which
 * contract generation answered it.
 *
 * @param {{
 *   origin: string,
 *   assertion: string,
 *   request: Record<string, unknown>,
 *   mintAssertion?: () => Promise<string>,
 *   sleep?: (milliseconds: number) => Promise<void>,
 *   log?: (line: string) => void
 * }} call the exchange call; `mintAssertion` mints a fresh OIDC assertion
 *   for each resend, since the first may expire during the wait
 * @returns {Promise<{
 *   state: 'deployment-authorization' | 'capability-issued' | 'submission-recorded',
 *   kind: string | null,
 *   body: Record<string, unknown>
 * }>} the classified answer
 */
export async function postReceiptExchange(call) {
  const response = await sendWithRetry({
    origin: call.origin,
    path: RECEIPT_EXCHANGE_PATH,
    authorization: `Bearer ${call.assertion}`,
    body: call.request,
    label: 'exchange',
    ...(call.mintAssertion === undefined
      ? {}
      : {
          mintAuthorization: async () =>
            `Bearer ${await /** @type {() => Promise<string>} */ (call.mintAssertion)()}`,
        }),
    ...(call.sleep === undefined ? {} : { sleep: call.sleep }),
    ...(call.log === undefined ? {} : { log: call.log }),
  });
  if (response.status !== 200 || response.body === null) {
    refuse(response, 'WORKLOAD_EXCHANGE_REFUSED', response.attempts);
  }
  const body = /** @type {Record<string, unknown>} */ (response.body);
  const state = classifyExchangeBody(body);
  if (state === null) {
    throw new GalaApiError(
      'WORKLOAD_EXCHANGE_RESPONSE_INVALID',
      'the 200 response is not one of the three closed states',
      { status: 200 },
    );
  }
  if (body.kind === undefined) {
    return { state, kind: null, body };
  }
  const kind = String(body.kind);
  if (
    RESPONSE_KINDS[/** @type {keyof typeof RESPONSE_KINDS} */ (kind)] !== state
  ) {
    throw new GalaApiError(
      'WORKLOAD_EXCHANGE_RESPONSE_INVALID',
      `the 200 response's kind does not name the ${state} arm its purpose and state select`,
      { status: 200 },
    );
  }
  return { state, kind, body };
}

/**
 * `POST /v2/workloads/deployment-receipts` with the single-use reporting
 * capability, and classify the answer into the job's evidence.
 *
 * The four outcomes the workflow must tell apart are all here and all
 * distinguishable without a secret: the `202` that proves durable
 * preliminary evidence; the replay of an already recorded submission; the
 * `409` that says the destination fence moved out from under the intent; and
 * the deliberately non-enumerating `401` that collapses every capability
 * failure — unknown, malformed, expired, superseded, already consumed or
 * belonging to a moved fence — onto one answer.
 *
 * @param {{
 *   origin: string,
 *   capability: string,
 *   submission: Record<string, unknown>,
 *   sleep?: (milliseconds: number) => Promise<void>,
 *   log?: (line: string) => void
 * }} call the submission call
 * @returns {Promise<{
 *   outcome: 'submission-recorded' | 'fence-moved' | 'capability-invalid' | 'refused',
 *   status: number,
 *   problemCode: string | null,
 *   operationId: string | null,
 *   statusUrl: string | null,
 *   phase: string | null,
 *   requestByteCount: number
 * }>} the classified evidence, free of every credential
 */
export async function postDeploymentReceipt(call) {
  const response = await sendWithRetry({
    origin: call.origin,
    path: DEPLOYMENT_RECEIPTS_PATH,
    authorization: `Gala-Receipt ${call.capability}`,
    body: call.submission,
    label: 'receipt submission',
    ...(call.sleep === undefined ? {} : { sleep: call.sleep }),
    ...(call.log === undefined ? {} : { log: call.log }),
  });
  const problemCode =
    response.body !== null && typeof response.body.code === 'string'
      ? response.body.code
      : null;
  /** @type {'submission-recorded' | 'fence-moved' | 'capability-invalid' | 'refused'} */
  let outcome;
  if (response.status === 202) {
    outcome = 'submission-recorded';
  } else if (response.status === 401) {
    outcome = 'capability-invalid';
  } else if (
    response.status === 409 &&
    problemCode === 'INVALID_SOURCE_STATE'
  ) {
    outcome = 'fence-moved';
  } else {
    outcome = 'refused';
  }
  const body = response.body ?? {};
  return {
    outcome,
    status: response.status,
    problemCode,
    operationId: typeof body.operationId === 'string' ? body.operationId : null,
    statusUrl: typeof body.statusUrl === 'string' ? body.statusUrl : null,
    phase: typeof body.phase === 'string' ? body.phase : null,
    requestByteCount: response.byteCount,
  };
}
