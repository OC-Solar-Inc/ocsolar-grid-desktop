/**
 * Manual mapping table for nexus → CEC name mismatches.
 *
 * The `nexusProducts` collection stores manufacturer / model strings
 * the way OC Solar catalogs them — these don't always match the
 * California Energy Commission's certified-list labels that PowerClerk
 * renders in its CEC manufacturer / model dropdowns.  When that
 * happens, search-by-substring filters to zero options and the driver
 * stalls.
 *
 * Rather than mutate `nexusProducts` (which would ripple through every
 * product surface in the app), we map at the submit layer here.  The
 * combobox-search action in `powerclerk-apply-field.ts` consults this
 * table before typing into the CEC search box.
 *
 * To add a new mapping: append a row.  Keys are case-sensitive and
 * matched verbatim — paste the exact string from the nexus doc on the
 * left, the exact string PowerClerk renders on the right.
 */

export const CEC_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  // Exact-match overrides.  Keys are matched case-insensitively against
  // the nexus value.  Add a row when a single specific variant is
  // wrong; for whole product families that share a parent brand, use
  // CEC_NAME_PATTERNS below.
};

/**
 * Pattern-based overrides for whole brand families.  The first regex
 * that matches the nexus value wins.  Anchor with `^…$` if the match
 * should require the entire string; use loose patterns (no anchors)
 * to catch variants like "Q-Cells", "Hanwha Q CELLS (Qidong)",
 * "Q Cells North America" — every nexus row that looks like a
 * Q-Cells SKU should funnel to PowerClerk's "Qcells North America"
 * CEC label.
 */
export const CEC_NAME_PATTERNS: ReadonlyArray<{ test: RegExp; replace: string }> = [
  // Hanwha Q-Cells: nexus stores at least three variants
  // ("Hanwha Q CELLS (Qidong)", "Q-Cells", "Q Cells"); PowerClerk's
  // CEC list uses the North American distribution arm.
  { test: /q[\s\.\-]?cells?/i, replace: "Qcells North America" },
];

/**
 * Resolve a nexus-side name to the CEC label, falling back to the
 * input verbatim when no override is registered.  Exact matches win
 * before pattern matches so a one-off override can supersede a
 * brand-wide pattern when needed.
 */
export function applyCecOverride(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  const lower = value.toLowerCase();
  for (const [k, v] of Object.entries(CEC_NAME_OVERRIDES)) {
    if (k.toLowerCase() === lower) return v;
  }
  for (const { test, replace } of CEC_NAME_PATTERNS) {
    if (test.test(value)) return replace;
  }
  return value;
}
