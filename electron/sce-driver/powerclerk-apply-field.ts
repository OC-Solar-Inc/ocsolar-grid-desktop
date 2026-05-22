/**
 * PowerClerk field-action runtime.
 *
 * Extracted from `powerclerk-submit-driver.ts` so the production
 * mirror in OC_Solar_MCP can copy it verbatim — see
 * SCE_APPLICATION_SUBMISSION_SYSTEM.md for the sync workflow.
 *
 * Owns the "how" of filling each field-map entry against a live
 * Playwright `Page`: selector resolution, value transforms, and
 * the per-kind action switch (text / select / combobox-search /
 * radio / checkbox-all / checkbox-list / file / signature / nav).
 *
 * Pure with respect to the field map — adding a new PowerClerk
 * field never requires touching this file (add it to FIELD_MAP).
 * Adding a new entry kind = add a `case` here.
 */

import { Page, Locator } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FieldMapEntry } from "./powerclerk-field-map";
import { applyCecOverride } from "./powerclerk-cec-overrides";

function log(msg: string) {
  process.stderr.write(`[powerclerk] ${msg}\n`);
}

// ── Selector resolution ────────────────────────────────────────────────

/** Resolve a FieldMapEntry.selector to a Playwright Locator. */
export function resolveSelector(page: Page, entry: FieldMapEntry): Locator {
  const s = entry.selector;
  const scope = (root: Locator | Page, within?: string): Locator | Page => {
    if (!within) return root;
    // fieldset whose <legend> text matches `within` — used to disambiguate
    // labels that repeat across contact blocks on the same page.
    return (root as Page).locator(`fieldset:has(legend:text-is(${JSON.stringify(within)}))`);
  };
  if ("role" in s) {
    const within = "within" in s ? s.within : undefined;
    const root: any = scope(page, within);
    const base = root.getByRole(s.role, { name: s.name });
    return typeof s.nth === "number" ? base.nth(s.nth) : base;
  }
  if ("label" in s) {
    const within = "within" in s ? s.within : undefined;
    const root: any = scope(page, within);
    const base = root.getByLabel(s.label);
    return typeof s.nth === "number" ? base.nth(s.nth) : base;
  }
  if ("placeholder" in s) {
    const within = "within" in s ? s.within : undefined;
    const root: any = scope(page, within);
    const base = root.getByPlaceholder(s.placeholder);
    return typeof s.nth === "number" ? base.nth(s.nth) : base;
  }
  const base = page.locator(s.css);
  return typeof (s as any).nth === "number" ? base.nth((s as any).nth) : base;
}

// ── Value transforms ───────────────────────────────────────────────────

/**
 * Parse a US address string into parts.  Handles the calculator's
 * canonical format "<street words> <city words>, <ST> <zip>".  When the
 * street/city split is ambiguous (no separating comma), falls back to a
 * street-suffix heuristic (Dr, St, Ave, …) then a last-two-words guess.
 */
export function parseAddress(
  full: string
): { street: string; city: string; state: string; zip: string } | null {
  const m = full.trim().match(
    /^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/
  );
  if (!m) return null;
  const combined = m[1].trim();
  const state = m[2];
  const zip = m[3];
  // Prefer comma-splitting: real addresses are canonically written as
  // "Street[, Suite/Apt], City, State Zip" — the last comma-separated
  // segment before the state is the city, everything before is the
  // street (joined back with ", " to preserve suite/unit notation).
  // Example: "1616 Camden Road, Suite 300, Charlotte, NC 28203"
  //   → street: "1616 Camden Road, Suite 300", city: "Charlotte".
  const commaParts = combined
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (commaParts.length >= 2) {
    const city = commaParts[commaParts.length - 1];
    const street = commaParts.slice(0, -1).join(", ");
    return { street, city, state, zip };
  }
  // No comma separating street from city — fall back to street-suffix
  // heuristic for one-line addresses like "123 Oak Dr Pasadena".
  const streetSuffix =
    /^(.*?\b(?:Dr|Drive|St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Blvd|Boulevard|Ct|Court|Way|Pl|Place|Pkwy|Parkway|Ter|Terrace|Cir|Circle|Hwy|Highway)\b\.?)\s+(.+)$/i;
  const sm = combined.match(streetSuffix);
  if (sm) return { street: sm[1].trim(), city: sm[2].trim(), state, zip };
  const parts = combined.split(/\s+/);
  if (parts.length >= 3) {
    return {
      street: parts.slice(0, -2).join(" "),
      city: parts.slice(-2).join(" "),
      state,
      zip,
    };
  }
  return { street: combined, city: "", state, zip };
}

export function applyValueTransform(
  value: string,
  transform: FieldMapEntry["valueTransform"]
): string {
  if (!transform || !value) return value;
  if (transform.startsWith("address.")) {
    const parsed = parseAddress(value);
    if (!parsed) return value;
    const part = transform.split(".")[1] as "street" | "city" | "state" | "zip";
    const raw = parsed[part] || "";
    // PowerClerk rejects ZIP+4 — keep only the 5-digit base.
    return part === "zip" ? raw.split("-")[0] : raw;
  }
  if (transform === "shading.percent") {
    // B73 is currently a human string like "84% for each month January
    // - December".  Pull out the first integer; blank if nothing found.
    const m = value.match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : "";
  }
  if (transform.startsWith("name.")) {
    // Split on first whitespace — "Atlas Curcie" → ["Atlas", "Curcie"];
    // single-word names go to first, leaving last empty.
    const idx = value.trim().indexOf(" ");
    if (idx < 0) return transform === "name.first" ? value.trim() : "";
    return transform === "name.first"
      ? value.slice(0, idx).trim()
      : value.slice(idx + 1).trim();
  }
  return value;
}

// ── Per-kind action handler ───────────────────────────────────────────

/**
 * Per-kind fill handlers.  Add a new kind = add a case here.  The
 * `value` argument is whatever `resolveValue` (in the driver) produced
 * — already transformed via `applyValueTransform` when applicable.
 */
export async function applyField(
  page: Page,
  entry: FieldMapEntry,
  value: string | string[] | { checkAll: true } | null
): Promise<void> {
  const target = resolveSelector(page, entry);

  // Skip text/select entries with no value.  "#VALUE!" always means the
  // calculator couldn't compute; never push it.  "N/A" is intentionally
  // NOT skipped — some PowerClerk dropdowns offer "N/A" as a real
  // option (e.g. "Are the modules multiple facing arrays?").
  const empty =
    value == null ||
    (typeof value === "string" && (value.trim() === "" || value === "#VALUE!"));
  if (empty && (entry.kind === "text" || entry.kind === "select" || entry.kind === "radio")) {
    return;
  }
  // Optional file rows (e.g. wizard-7 Job Card "if available") may
  // resolve to "" when the payload has no URL.  Skip rather than
  // calling setInputFiles("") which Playwright interprets as
  // "clear the input".
  if (empty && entry.kind === "file") {
    return;
  }

  // Pre-action hold: applies to any entry kind.  Useful for diagnosing
  // wizard transitions (e.g. land on a step, sit idle for N s, observe)
  // and for gating actions behind in-flight async work from a prior
  // entry (parallel file uploads in particular).
  if (entry.preDelayMs) {
    log(`pre-action: holding ${entry.preDelayMs}ms before ${entry.kind} on ${entry.step}`);
    await page.waitForTimeout(entry.preDelayMs);
  }

  // Scroll into view so fills/clicks on long forms don't miss.
  await target.first().scrollIntoViewIfNeeded().catch(() => {});

  switch (entry.kind) {
    case "text":
      await target.first().fill(String(value ?? ""));
      return;
    case "select": {
      const want = String(value ?? "");
      const el = target.first();
      // Try exact-label match first.  If the calculator's string has
      // drifted from PowerClerk's option text (whitespace, casing —
      // e.g. "1MW" vs "1 MW", trailing space), fall back to a
      // whitespace/case-normalized match against the option list.
      try {
        // Short timeout on the exact-label attempt: if the calculator's
        // string has drifted from PowerClerk's option text we want to
        // fall through to the fuzzy matcher quickly, not wait Playwright's
        // default 30 s.  Conditional fields still get their normal wait
        // because selectOption auto-waits for visibility before matching.
        await el.selectOption({ label: want }, { timeout: 3000 });
      } catch {
        const options: string[] = await el
          .locator("option")
          .allTextContents();
        // Strip parens content, non-alphanumeric, lowercase.  Handles
        // "1MW" ≡ "1 MW", "240" ≡ "240 V", and "TOUD-4-9PM (SCE)" ≡
        // "TOU-D-4-9PM".  Collisions are unlikely — option lists are
        // short and deliberately distinct.
        const norm = (s: string) =>
          s.replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
        const nw = norm(want);
        let match = options.find((o) => norm(o) === nw);
        if (!match && nw.length >= 3) {
          // Substring either direction — e.g. "240" ⊂ "240V", or
          // "TOUD49PMSCE" ⊃ "TOUD49PM".
          match = options.find((o) => {
            const no = norm(o);
            return no && (no.includes(nw) || nw.includes(no));
          });
        }
        if (!match) {
          throw new Error(
            `No matching option for "${want}". Available: ${options
              .filter((o) => o && o !== "Select...")
              .slice(0, 8)
              .map((o) => JSON.stringify(o))
              .join(", ")}`
          );
        }
        await el.selectOption({ label: match });
      }
      return;
    }
    case "combobox-search": {
      // PowerClerk's custom dropdown widget: the visible trigger shows
      // "Please select…"; clicking opens a panel with a search input.
      // Strategy — always target the FIRST visible "Please select…"
      // element (as each one is filled the trigger's text changes, so
      // the next unfilled one becomes first).  Type a short search
      // query, then click the matching option.  Critical: confirm the
      // trigger's text has changed before returning, otherwise the
      // next combobox-search will re-open the same unfilled dropdown.
      // CEC-name override runs first so nexus-side strings that don't
      // match PowerClerk's CEC labels (e.g. "Hanwha Q CELLS (Qidong)"
      // vs "Qcells North America") get rewritten before we search.
      const raw = applyCecOverride(value).trim();
      if (!raw) return;
      const trigger = page.getByText("Please select...", { exact: true }).first();
      await trigger.scrollIntoViewIfNeeded().catch(() => {});
      await trigger.click();

      const searchCandidates = [
        'input[type="search"]:visible',
        'input[role="searchbox"]:visible',
        'input[aria-label*="Search" i]:visible',
      ].join(", ");
      let search = page.locator(searchCandidates).first();
      if (!(await search.isVisible({ timeout: 1500 }).catch(() => false))) {
        search = page.locator("input:visible").last();
      }

      // Long model strings with trailing spaces, unbalanced parens, or
      // special chars like `+` / `.` sometimes cause PowerClerk's
      // server-side filter to return zero options.  Try progressively
      // shorter prefixes so a model like
      //   "Q.PEAK DUO BLK ML-G10.C+ 410 AC"
      // falls through to "Q.PEAK DUO BLK", "Q.PEAK DUO", "Q.PEAK"
      // before giving up.  The order is full → strip-parens → first
      // 4 words → first 3 words → first 2 words → first word, so
      // the most specific query that still returns matches wins.
      const words = raw.split(/\s+/).filter(Boolean);
      const firstN = (n: number) => words.slice(0, n).join(" ").trim();
      const prefixes = [
        raw,
        raw.split(/[(\[]/)[0].trim(),
        firstN(4),
        firstN(3),
        firstN(2),
        firstN(1),
      ].filter((p, i, a) => p && a.indexOf(p) === i);

      // Build case-insensitive matchers up front.  Playwright's
      // getByRole `name` and filter `hasText` default to case-sensitive
      // strings, which makes them brittle when PowerClerk's CEC labels
      // and our typed search drift on capitalization (e.g. "QCells"
      // vs "Qcells").  Wrapping in a regex with the /i flag eliminates
      // that whole class of misses.
      const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const exactRe = new RegExp(`^${escapeRe(raw)}$`, "i");
      const looseRe = new RegExp(escapeRe(raw.split(/\s+/)[0] || raw), "i");

      let clicked = false;
      for (const q of prefixes) {
        await search.fill("");
        await search.fill(q);
        await page.waitForTimeout(400);
        const exact = page.getByRole("option", { name: exactRe }).first();
        if (await exact.isVisible({ timeout: 800 }).catch(() => false)) {
          await exact.click();
          clicked = true;
          break;
        }
        const loose = page.getByRole("option").filter({ hasText: looseRe }).first();
        if (await loose.isVisible({ timeout: 800 }).catch(() => false)) {
          await loose.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        // Try Enter (auto-highlight on single-match) and if that still
        // didn't take, close the dropdown with Escape so the page state
        // isn't left stale — the next combobox-search would otherwise
        // re-open this same unfilled widget.
        await search.press("Enter").catch(() => {});
        await page.waitForTimeout(200);
      }
      // Confirm selection landed: the trigger should no longer read
      // "Please select…".  If it does, close with Escape and throw so
      // the error bubbles up instead of corrupting later selections.
      const stillOpen = await page
        .getByText("Please select...", { exact: true })
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      const triggerStillUnselected = await trigger
        .isVisible({ timeout: 300 })
        .catch(() => false);
      if (!clicked && (stillOpen || triggerStillUnselected)) {
        await page.keyboard.press("Escape").catch(() => {});
        throw new Error(`combobox-search: could not select "${raw}"`);
      }
      return;
    }
    case "radio": {
      const want = String(value ?? "");
      // Honor the selector's `within` so pages with multiple Yes/No
      // radio groups don't pick the wrong one.  Falls back to page-wide.
      const s = entry.selector as any;
      const within = s && "within" in s ? s.within : undefined;
      const root: any = within
        ? page.locator(
            `fieldset:has(legend:text-is(${JSON.stringify(within)}))`
          )
        : page;
      await root.getByRole("radio", { name: want }).first().check();
      return;
    }
    case "checkbox-all": {
      const all = await target.all();
      // Honor entry.limit so pages like wizard-5 can check A/B/C1/C2
      // (the first 10 boxes) while leaving the trailing D1 opt-in
      // box unchecked.
      const toCheck = typeof entry.limit === "number" ? all.slice(0, entry.limit) : all;
      for (const cb of toCheck) await cb.check();
      return;
    }
    case "checkbox-list": {
      const labels = Array.isArray(value) ? value : [];
      for (const label of labels) {
        await page.getByRole("checkbox", { name: label }).check();
      }
      return;
    }
    case "file": {
      const tempPath = String(value ?? "");
      // setInputFiles dispatches the upload async; the actual HTTP
      // POST is handled by PowerClerk's JS after this returns.  When
      // `parallel: true` we return immediately so the next file
      // entry can fire its upload concurrently.  The subsequent nav
      // entry's postDelayMs governs how long we wait for all
      // in-flight uploads to actually settle before clicking Next.
      await target.setInputFiles(tempPath);
      if (entry.parallel) return;
      await page.waitForTimeout(entry.postDelayMs ?? 1500);
      return;
    }
    case "signature":
      // placeholder — real impl will depend on PowerClerk's widget
      await target.fill(String(value ?? ""));
      return;
    case "download": {
      // Click a button that triggers a file download.  Playwright's
      // download event resolves with a `Download` object that exposes
      // the temp path; we copy it to ~/Downloads/ so the user can open
      // the file from Finder / `open` after the run.  Without this and
      // `acceptDownloads: true` on the context, Chromium silently
      // drops downloads in headed mode.
      const downloadsDir = path.join(os.homedir(), "Downloads");
      try { fs.mkdirSync(downloadsDir, { recursive: true }); } catch {}
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30000 }),
        target.first().click({ timeout: 15000 }),
      ]);
      // Build a stable filename: <step>-<suggested-or-fallback>.
      const suggested = download.suggestedFilename();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeSuggested = suggested && suggested.length > 0
        ? suggested
        : `${entry.step}-download-${stamp}.bin`;
      const outPath = path.join(downloadsDir, `${entry.step}-${stamp}-${safeSuggested}`);
      await download.saveAs(outPath);
      log(`download: saved → ${outPath}`);
      return;
    }
    case "nav":
      // Bound the click itself.  Playwright auto-waits for the
      // element to be actionable; in headless mode, an overlay
      // (banner, mid-flight upload spinner) can leave the click
      // hanging up to Playwright's default 30 s timeout.  Cap it
      // at 15 s and swallow timeouts so the walker can continue
      // — the entry's preDelayMs is the real "wait for prior
      // async work" gate.
      await target.first().click({ timeout: 15000 }).catch((e) => {
        log(`nav: click timed out / failed on ${entry.step}: ${e.message}`);
      });
      // networkidle is belt-and-suspenders here — wizard transitions
      // are SPA state changes, not navigations, so networkidle fires
      // immediately when it works.  But on the headless backend
      // PowerClerk holds long-poll connections that never let
      // networkidle resolve, leaving the walker stuck indefinitely.
      // Bound the wait at 8 s and swallow timeouts so postDelayMs
      // does the real gating.
      await page
        .waitForLoadState("networkidle", { timeout: 8000 })
        .catch(() => {});
      await page.waitForTimeout(entry.postDelayMs ?? 1500);
      return;
  }
}
