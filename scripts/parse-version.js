/**
 * Tiny helper to extract a major version from a Node version
 * string. Centralized so the matrix check + future test helpers
 * stay consistent about how they parse versions.
 */

export function major(version) {
  const dot = String(version).indexOf('.');
  if (dot < 0) return Number(version);
  return Number(version.slice(0, dot));
}
