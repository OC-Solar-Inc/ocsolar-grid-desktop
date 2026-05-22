/**
 * SCE PowerClerk credentials used by `powerclerk-submit-driver.ts`
 * for the initial login step.  This file is a template — copy it
 * to `credentials.ts` (gitignored) and fill in the real values.
 *
 * The driver consults values in this order:
 *   1. process.env.OCS_POWERCLERK_USERNAME / PASSWORD
 *      (dev convenience — set in the shell that launches the app)
 *   2. The constants exported from `./credentials` (this file's
 *      shape, when the gitignored copy exists)
 *
 * Once the first login succeeds the driver caches the PowerClerk
 * session in `<userData>/.powerclerk-auth.json` and reads from
 * that on subsequent runs, so credentials are only needed cold.
 *
 * Distribution: GitHub Actions base64-decodes a repository secret
 * (`POWERCLERK_CREDENTIALS_TS`) into `credentials.ts` before
 * `electron-builder` packages the app, so production users never
 * see this file directly.  For local builds, copy this template
 * to `credentials.ts` by hand and fill in the OC Solar shared
 * PowerClerk login.
 */

export const credentials = {
  powerClerkUsername: "",
  powerClerkPassword: "",
};
