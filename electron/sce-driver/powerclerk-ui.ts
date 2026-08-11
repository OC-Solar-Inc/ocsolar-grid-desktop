import type { Page } from "playwright";

// Ported from OC_Solar_MCP `src/utils/powerclerk-ui.ts` (Jul 2026).  Keep the
// two copies in sync — the MCP scrapers and this submission driver hit the
// same PowerClerk tenant and break on the same overlays.
//
// PowerClerk (Clean Power Research) rolled out a post-login "Introducing the new
// Homepage" onboarding popup (July 2026). It renders a full-page dimming overlay
// (div.position-absolute.opacity-50.bg-black inside the Vue header) that
// intercepts every pointer event until dismissed. In this driver that killed the
// very first post-login click ("SCE - Solar Billing Plan"), which throws outside
// the per-field try/catch and exits before a single field is applied. There is
// also a cookie-consent banner at the bottom of the page. This dismisses both,
// with a JS overlay-removal fallback in case they ship another variant.
export async function dismissPowerClerkPopups(
  page: Page,
  log: (msg: string) => void
): Promise<void> {
  // 1. "Got it" on the new-homepage onboarding popup
  const gotIt = page.getByRole("button", { name: "Got it" }).first();
  if (await gotIt.isVisible({ timeout: 2000 }).catch(() => false)) {
    log('Dismissing "Introducing the new Homepage" popup...');
    await gotIt.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  // 2. Cookie-consent banner ("This site uses cookies..." with a Close button)
  const cookieClose = page.locator('button:has-text("Close")').last();
  if (await cookieClose.isVisible({ timeout: 1000 }).catch(() => false)) {
    log("Dismissing cookie-consent banner...");
    await cookieClose.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // 3. The older CPR announcement banner this driver already knew about.
  //    Harmless when absent; kept here so every dismissal lives in one place.
  const cprBanner = page.locator("#cpr-banner-dimiss-btn");
  if (await cprBanner.isVisible({ timeout: 1000 }).catch(() => false)) {
    log("Dismissing CPR announcement banner...");
    await cprBanner.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // 4. Fallback: if a dimming overlay still intercepts clicks, strip it in JS.
  const overlay = page.locator("div.position-absolute.opacity-50.bg-black");
  const overlayCount = await overlay.count().catch(() => 0);
  if (overlayCount > 0) {
    const anyVisible = await overlay
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (anyVisible) {
      log(`Removing ${overlayCount} leftover dimming overlay(s) via JS...`);
      await page
        .evaluate(() => {
          document
            .querySelectorAll("div.position-absolute.opacity-50.bg-black")
            .forEach((el) => el.remove());
        })
        .catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}
