/**
 * Generic PowerClerk submission driver.
 *
 * Run locally:
 *   ts-node src/app/scripts/powerclerk-submit-driver.ts \
 *     --payload ./tmp/pto-payload-SBP-162372.json \
 *     [--dry-run] [--stop-before-submit] [--pause-on-error]
 *
 * The driver never auto-submits during dev — it lands on PowerClerk's
 * review page so a human verifies before clicking the final button.
 *
 * Design: this file owns the *how* (browser mechanics, retries, error
 * collection).  FIELD_MAP (powerclerk-field-map.ts) owns the *what*
 * (which fields, which selectors, which step).  Adding a new PowerClerk
 * field should never require touching this file.
 */

import * as fs from "fs";
import { chromium, Browser, Page } from "playwright";
import {
  PtoSubmissionPayload,
  PTO_SUBMISSION_SCHEMA_VERSION,
  PtoSubmissionCell,
} from "./payload-types";

// PowerClerk credentials come from environment variables when the
// driver runs inside the OC Solar Grid desktop app.  The Electron
// main process injects them via spawn `env`; in dev a developer
// exports OCS_POWERCLERK_USERNAME / OCS_POWERCLERK_PASSWORD in
// their shell.  Phase 1: env-var-only.  Phase 3 wires a proper
// credentials store inside the desktop app.
const environment = {
  powerClerkUsername: process.env["OCS_POWERCLERK_USERNAME"] || "",
  powerClerkPassword: process.env["OCS_POWERCLERK_PASSWORD"] || "",
};
import { FIELD_MAP, FieldMapEntry, FieldKind } from "./powerclerk-field-map";
import {
  applyField,
  applyValueTransform,
  resolveSelector,
} from "./powerclerk-apply-field";
import {
  materializeFiles,
  MaterializedFiles,
} from "./powerclerk-materialize-files";

interface CliFlags {
  payloadPath: string;
  dryRun: boolean;
  stopBeforeSubmit: boolean;
  pauseOnError: boolean;
  authStatePath: string;
}

interface FieldResult {
  step: string;
  cellId: string | null;
  kind: FieldKind;
  ok: boolean;
  error?: string;
  screenshot?: string;
}

function log(msg: string) {
  process.stderr.write(`[powerclerk] ${msg}\n`);
}

function parseFlags(argv: string[]): CliFlags {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name: string) => argv.includes(name);
  return {
    payloadPath: get("--payload") || "",
    dryRun: has("--dry-run"),
    stopBeforeSubmit: !has("--submit"), // default: stop
    pauseOnError: has("--pause-on-error"),
    authStatePath: get("--auth-state") || "./.powerclerk-auth.json",
  };
}

function loadPayload(path: string): PtoSubmissionPayload {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  if (raw.schemaVersion !== PTO_SUBMISSION_SCHEMA_VERSION) {
    throw new Error(
      `Payload schemaVersion ${raw.schemaVersion} !== expected ${PTO_SUBMISSION_SCHEMA_VERSION}`
    );
  }
  return raw as PtoSubmissionPayload;
}

// resolveSelector / parseAddress / applyValueTransform / applyField
// were lifted into ./powerclerk-apply-field for sharing with the
// production mirror in OC_Solar_MCP.  Imports at the top of this
// file; behavior unchanged.

// MaterializedFiles + materializeFiles + detectFileType +
// imageBytesToPdf were lifted into ./powerclerk-materialize-files
// for the same reason.

/** Resolve a FieldMapEntry.source to a value from the payload. */
function resolveValue(
  entry: FieldMapEntry,
  payload: PtoSubmissionPayload,
  files: MaterializedFiles
): string | string[] | { checkAll: true } | null {
  const src = entry.source;
  if (!src) return null;
  if (src.kind === "literal") return src.value;
  if (src.kind === "cell") {
    const cell: PtoSubmissionCell | undefined = payload.cells[src.cellId];
    // Missing cell → treat as empty; applyField's empty-skip will pass
    // it through without touching the PowerClerk field.  The driver
    // summary still surfaces which cells were absent.
    if (!cell) return "";
    return cell.value == null ? "" : String(cell.value);
  }
  if (src.kind === "payload-files") {
    // Already materialized to a temp path at driver startup.  Empty
    // string for missing optional files (e.g. Job Card not yet
    // available) — applyField's file-empty-skip will pass through.
    return files[src.path] ?? "";
  }
  const group = payload.checkboxGroups[src.groupId];
  if (!group) throw new Error(`Payload missing checkboxGroup ${src.groupId}`);
  if ("checkAll" in group) return { checkAll: true };
  return group.check;
}


async function login(page: Page): Promise<void> {
  const { powerClerkUsername, powerClerkPassword } = environment as any;
  if (!powerClerkUsername || !powerClerkPassword) {
    throw new Error("PowerClerk credentials missing in environment.ts");
  }
  await page.goto("https://sceinterconnect.powerclerk.com/MvcAccount/Login");
  await page.waitForLoadState("networkidle");
  if (await page.getByRole("button", { name: "Log In" }).isVisible().catch(() => false)) {
    await page.getByPlaceholder("example@company.com").fill(powerClerkUsername);
    await page.getByLabel("Password:").fill(powerClerkPassword);
    await page.getByRole("button", { name: "Log In" }).click();
    await page.waitForLoadState("networkidle");
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (!flags.payloadPath) {
    console.error("Usage: --payload <path.json> [--dry-run] [--pause-on-error] [--submit]");
    process.exit(1);
  }

  const payload = loadPayload(flags.payloadPath);
  log(`Payload loaded: project ${payload.projectId} (${payload.customerName ?? "?"})`);

  // Readiness gate: SLD is required by the wizard-7 form (red asterisk).
  // Job Card is "(if available)" so null is allowed.
  if (!payload.files?.sldUrl) {
    throw new Error(
      "Readiness check failed: payload.files.sldUrl is null. " +
        "Re-export the payload after the plan-set analyzer publishes an SLD."
    );
  }

  if (flags.dryRun) {
    // Use empty placeholders for files in dry-run — we don't want to
    // hit GCS during a "what would happen" preview.
    const dryFiles: MaterializedFiles = {
      sldUrl: null,
      jobCardUrl: null,
      contractFullUrl: null,
      contractFirst24Url: null,
      contractLast4Url: null,
      cpucPacketUrl: null,
    };
    for (const entry of FIELD_MAP) {
      const v = (() => { try { return resolveValue(entry, payload, dryFiles); } catch (e: any) { return `<ERROR ${e.message}>`; } })();
      log(`  [${entry.step}] ${entry.kind.padEnd(14)} ← ${JSON.stringify(v)}`);
    }
    return;
  }

  log("Materializing payload.files attachments to temp paths...");
  const files = await materializeFiles(payload);

  // slowMo was 150 ms during initial development to make the driver
  // visibly auditable; that adds 12+ s across the full field map for
  // no functional benefit.  Run at full speed by default.  Re-enable
  // (e.g. slowMo: 100) if you need to step through actions visually
  // while diagnosing a new selector.
  const browser: Browser = await chromium.launch({ headless: false });
  const useSavedAuth = fs.existsSync(flags.authStatePath);
  // `acceptDownloads` is required for the wizard-8 "Generate" button
  // (and any future download action).  Without it Playwright cancels
  // the download silently, leaving Chromium with a file it can't
  // open / surface in the downloads tray.
  const context = await browser.newContext(
    useSavedAuth
      ? { storageState: flags.authStatePath, acceptDownloads: true }
      : { acceptDownloads: true }
  );
  const page = await context.newPage();
  const results: FieldResult[] = [];

  try {
    await login(page);
    if (!useSavedAuth) await context.storageState({ path: flags.authStatePath });

    // Navigate to the New Application flow — re-use the proven path
    // from powerclerk-new-application.ts.
    await page.locator('a:text("SCE - Solar Billing Plan")').first().click();
    await page.waitForLoadState("networkidle");
    await page.locator("text=New Application").first().click();
    await page.waitForLoadState("networkidle");

    // PowerClerk occasionally renders a banner overlay that intercepts
    // clicks on the acknowledgment checkbox.  Dismiss it if present.
    const dismissBtn = page.locator("#cpr-banner-dimiss-btn");
    if (await dismissBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dismissBtn.click().catch(() => {});
    }

    for (const entry of FIELD_MAP) {
      const cellId =
        entry.source && "cellId" in entry.source ? entry.source.cellId : null;
      const cellSuffix = cellId ? ` (${cellId})` : "";
      try {
        const value = resolveValue(entry, payload, files);
        // Optional entries: if the element isn't present (conditional
        // field hidden because its gate answered "No"), silently skip.
        //
        // combobox-search needs special handling — its placeholder
        // selector is `{ css: "body" }` (the action targets the first
        // "Please select…" trigger anywhere on the page) so the
        // generic locator.count() always reports >0 and we'd never
        // skip even when the surrounding section is hidden.  Instead
        // we probe for a visible "Please select…" trigger directly.
        if (entry.optional) {
          let rendered: boolean;
          if (entry.kind === "combobox-search") {
            const probe = page.getByText("Please select...", { exact: true }).first();
            rendered = await probe.isVisible({ timeout: 800 }).catch(() => false);
          } else {
            const locator = resolveSelector(page, entry);
            rendered = (await locator.count().catch(() => 0)) > 0;
          }
          if (!rendered) {
            results.push({ step: entry.step, cellId, kind: entry.kind, ok: true, error: "skipped (optional, not rendered)" });
            log(`  OK  [${entry.step}] ${entry.kind}${cellSuffix} — skipped (optional, not rendered)`);
            continue;
          }
        }
        const transformed =
          typeof value === "string"
            ? applyValueTransform(value, entry.valueTransform)
            : value;
        await applyField(page, entry, transformed);
        results.push({ step: entry.step, cellId, kind: entry.kind, ok: true });
        // Live per-field progress.  The Firestore worker parses these
        // into `submissionJobs/{id}.events` so the panel can render a
        // wizard-by-wizard chip strip + latest-action line in real
        // time instead of batching everything until end-of-run.
        log(`  OK  [${entry.step}] ${entry.kind}${cellSuffix}`);
      } catch (err: any) {
        const shot = `./tmp/powerclerk-error-${entry.step}-${entry.kind}.png`;
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        results.push({
          step: entry.step,
          cellId,
          kind: entry.kind,
          ok: false,
          error: err.message,
          screenshot: shot,
        });
        log(`  ERR [${entry.step}] ${entry.kind}${cellSuffix} — ${err.message}`);
        if (flags.pauseOnError) {
          log(`PAUSED at ${entry.step}/${entry.kind}: ${err.message}`);
          log("Browser stays open — inspect and Ctrl+C when done.");
          await page.waitForTimeout(10 * 60 * 1000);
          break;
        }
      }
    }

    if (flags.stopBeforeSubmit) {
      log("Stopped before submit (--submit not passed).  Browser will stay open for inspection.");
      await page.waitForTimeout(10 * 60 * 1000);
    }
  } finally {
    await browser.close();
    // Best-effort cleanup of materialized file temps.  Don't fail the
    // run if these are already gone (e.g. OS swept /tmp).
    for (const tmp of [
      files.sldUrl,
      files.jobCardUrl,
      files.contractFullUrl,
      files.contractFirst24Url,
      files.contractLast4Url,
      files.cpucPacketUrl,
    ]) {
      if (tmp) {
        await fs.promises.unlink(tmp).catch(() => {});
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
