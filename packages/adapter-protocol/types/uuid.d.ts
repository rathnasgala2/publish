/**
 * Generate one lowercase canonical UUIDv7 string.
 *
 * @returns {string} a UUIDv7 matching the `stableId` schema pattern
 *   (`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
 */
export function generateUuidV7(): string;
