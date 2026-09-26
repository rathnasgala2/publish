/**
 * Check an artifact's complete path set for containment safety: traversal,
 * absolute/escaping paths, disallowed member kinds (a symlink, device,
 * socket, fifo or any other non-regular-file archive member), destructive
 * Unicode normalization, case collisions and reserved target paths. The set
 * is evaluated as a whole so cross-entry case-folded collisions (two
 * distinct declared paths that collapse to the same case-folded form) are
 * caught, not only per-entry syntax. (An analogous cross-entry NFC
 * collision cannot occur: `checkPathSyntax` already rejects any individual
 * path that is not itself in NFC form, and two distinct NFC-normalized
 * strings cannot collapse to the same NFC form.)
 *
 * @param {readonly ArtifactPathEntry[]} entries the complete declared
 *   artifact member list
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when
 *   every entry and the set as a whole is safe
 */
export function checkPathContainment(entries: readonly ArtifactPathEntry[]): readonly import("./errors.js").KernelFinding[];
export type ArtifactPathEntry = Readonly<{
    path: string;
    kind: "file" | "directory" | "symlink" | "device" | "socket" | "fifo" | "other";
}>;
