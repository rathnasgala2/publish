/**
 * The facts a managed run reads out of the verified source revision.
 *
 * DEC-097 section 6: "contract version, operation ID, repository/ref/SHA/run
 * identity, lock, publisher, adapter and destination facts are derived and
 * verified by the pinned reusable workflow." The lock and the publication
 * are the two places the verified source states them — `gala.lock.json`
 * names the resolver, the selected adapter package and its integrity;
 * `gala/publication.json` names the canonical base the destination serves —
 * and both travel inside the `verified-inputs` carrier `prep` built from the
 * exact bound checkout, so nothing here reads a filesystem or an
 * environment.
 *
 * Every reader fails closed by name. A lock that selects no adapter, two
 * adapters, or an adapter outside DEC-097's closed three-row mapping is not
 * a lock this workflow can publish from.
 *
 * @module
 */

/** The fixed lockfile path inside the carrier (DEC-006). */
export const LOCK_PATH = 'source/gala.lock.json';

/** The fixed publication document path inside the carrier. */
export const PUBLICATION_PATH = 'source/gala/publication.json';

/** DEC-097 section 3's closed locked-package to `adapterId` mapping. */
export const ADAPTER_PACKAGES = Object.freeze({
  '@rathnasgala2/adapter-local-directory': 'local-directory',
  '@rathnasgala2/adapter-github-pages': 'github-pages',
  '@rathnasgala2/adapter-do-spaces': 'do-spaces',
});

/** The publisher package the lock must pin. */
export const PUBLISHER_PACKAGE = '@rathnasgala2/publish-action';

/**
 * @param {readonly {path: string, bytes: Buffer}[]} files the carrier files
 * @param {string} path the member path
 * @returns {Record<string, any>} the parsed JSON document
 */
function readJsonMember(files, path) {
  const member = files.find((file) => file.path === path);
  if (member === undefined) {
    throw new Error(
      `VERIFIED_SOURCE_MEMBER_MISSING: the verified-inputs carrier carries no ${path}`,
    );
  }
  try {
    return JSON.parse(member.bytes.toString('utf8'));
  } catch {
    throw new Error(`VERIFIED_SOURCE_MEMBER_INVALID: ${path} is not JSON`);
  }
}

/**
 * @param {unknown} record a lock package row
 * @param {string} what the row, for the diagnostic
 * @returns {{package: string, version: string, integrity: string, registry: string}}
 *   the four-member package identity
 */
function packageIdentity(record, what) {
  const row = /** @type {Record<string, unknown>} */ (record);
  for (const member of ['package', 'version', 'integrity', 'registry']) {
    if (typeof row[member] !== 'string' || row[member] === '') {
      throw new Error(
        `VERIFIED_SOURCE_LOCK_INVALID: the ${what} row lacks ${member}`,
      );
    }
  }
  return {
    package: String(row.package),
    version: String(row.version),
    integrity: String(row.integrity),
    registry: String(row.registry),
  };
}

/**
 * Read the complete `lock:2.0.0` document the verified source carries. The
 * SBOM's package rows and dependency edges are its `schemas`/`template`/
 * `theme`/`publisher`/`dependencies`/`dependencyDag` members verbatim; no
 * other source of package identity is admitted at freeze.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the carrier files
 * @returns {Record<string, any>} the parsed lock document
 */
export function readLockDocument(files) {
  const lock = readJsonMember(files, LOCK_PATH);
  if (lock.schemaId !== 'urn:gala:schema:lock:2.0.0') {
    throw new Error(
      `VERIFIED_SOURCE_LOCK_INVALID: ${LOCK_PATH} does not declare urn:gala:schema:lock:2.0.0`,
    );
  }
  return lock;
}

/**
 * Read the lock's publisher closure: the publisher identity and the one
 * selected adapter.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the carrier files
 * @returns {{
 *   lockDigest: string,
 *   publisher: {package: string, version: string, integrity: string, registry: string},
 *   adapter: {adapterId: string, adapterVersion: string, adapterDigest: string},
 *   adapterPackage: string
 * }} the lock facts
 */
export function readLockFacts(files) {
  const lock = readLockDocument(files);
  if (
    typeof lock.lockDigest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(lock.lockDigest)
  ) {
    throw new Error(
      'VERIFIED_SOURCE_LOCK_INVALID: lockDigest is absent or not a tagged sha256 digest',
    );
  }
  const rows = Array.isArray(lock.publisher) ? lock.publisher : [];
  const publisherRows = rows.filter(
    (/** @type {any} */ row) => row?.package === PUBLISHER_PACKAGE,
  );
  if (publisherRows.length !== 1) {
    throw new Error(
      `VERIFIED_SOURCE_LOCK_INVALID: the lock must pin exactly one ${PUBLISHER_PACKAGE} row (found ${publisherRows.length})`,
    );
  }
  const adapterRows = rows.filter(
    (/** @type {any} */ row) =>
      typeof row?.package === 'string' &&
      Object.hasOwn(ADAPTER_PACKAGES, row.package),
  );
  if (adapterRows.length !== 1) {
    throw new Error(
      `FREEZE_ADAPTER_SELECTION_INVALID: the lock must select exactly one adapter package (found ${adapterRows.length}: ${adapterRows
        .map((/** @type {any} */ row) => row.package)
        .join(', ')})`,
    );
  }
  const adapter = packageIdentity(adapterRows[0], 'selected adapter');
  return {
    lockDigest: lock.lockDigest,
    publisher: packageIdentity(publisherRows[0], 'publisher'),
    adapter: {
      adapterId:
        ADAPTER_PACKAGES[
          /** @type {keyof typeof ADAPTER_PACKAGES} */ (adapter.package)
        ],
      adapterVersion: adapter.version,
      // DEC-097 section 3: the adapter digest byte-equals the locked
      // package's integrity.
      adapterDigest: adapter.integrity,
    },
    adapterPackage: adapter.package,
  };
}

/**
 * Read the publication's canonical base, the origin+base-path root the
 * destination serves (DEC-097 section 5).
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the carrier files
 * @returns {{canonicalBase: string}} the publication facts
 */
export function readPublicationFacts(files) {
  const publication = readJsonMember(files, PUBLICATION_PATH);
  const canonicalBase = publication.canonicalBase;
  if (
    typeof canonicalBase !== 'string' ||
    !/^https:\/\/(?![^/?#]*@)[^?#]*\/$/u.test(canonicalBase)
  ) {
    throw new Error(
      'VERIFIED_SOURCE_PUBLICATION_INVALID: canonicalBase is absent, not https, carries credentials or a query, or does not end in /',
    );
  }
  return { canonicalBase };
}
