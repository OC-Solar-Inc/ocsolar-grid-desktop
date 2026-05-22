/**
 * Declarative map of PowerClerk form fields.  Each entry tells the
 * driver (powerclerk-submit-driver.ts) *what* to do; the driver handles
 * *how* per `kind`.
 *
 * Adding a new field = append one entry.  If a field needs special
 * behavior no existing `kind` covers, add a new kind to the driver
 * rather than embedding imperative logic here.
 *
 * Selectors should use role/label/text queries wherever possible so
 * they survive PowerClerk's class-name churn.  Fall back to CSS
 * selectors only when the framework-generated ids are stable.
 */

export type FieldKind =
  | "text"          // plain <input type=text|number>
  | "select"        // native <select> or searchable combobox
  | "combobox-search" // PowerClerk's custom dropdown: click "Please select…",
                      //   type search query, pick the matching option.  Used
                      //   for Inverter/PV Array mfr+model dropdowns.
  | "radio"         // one-of-N radio group
  | "checkbox-all"  // group where every option must be checked
  | "checkbox-list" // group where a list of option labels must be checked
  | "file"          // file upload input
  | "signature"     // drawn/typed signature field
  | "download"      // click a button that triggers a file download.
                    //   Driver waits for the download event, saves the
                    //   file under ~/Downloads/, logs the path.
  | "nav";          // clicking a Next/Continue button — no value

export interface FieldMapEntry {
  /**
   * Which payload cell this field reads from.  Null for `nav` / checkbox
   * groups that read from payload.checkboxGroups instead.
   */
  source:
    | { kind: "cell"; cellId: string }
    | { kind: "checkboxGroup"; groupId: string }
    | { kind: "literal"; value: string }
    | { kind: "payload-files"; path: "sldUrl" | "jobCardUrl" | "contractFullUrl" | "contractFirst24Url" | "contractLast4Url" | "cpucPacketUrl" }
    | null;

  /**
   * Where on the page.  Prefer label; role is next best; CSS last resort.
   * `within` scopes the match to a fieldset with that legend text —
   * essential on pages where the same label ("Name", "Address") appears
   * in multiple contact blocks.
   */
  selector:
    | { role: "textbox" | "combobox" | "radio" | "checkbox" | "button"; name: string | RegExp; within?: string; nth?: number }
    | { label: string | RegExp; within?: string; nth?: number }
    | { placeholder: string; within?: string; nth?: number }
    | { css: string; nth?: number };

  kind: FieldKind;

  /**
   * Which "step" of the PowerClerk wizard this field lives on.  The
   * driver fills all entries for a step, clicks Next, then moves on.
   * Steps run in the order they first appear in FIELD_MAP.
   */
  step: string;

  /** Human note for debugging / screenshots. */
  note?: string;

  /**
   * When true, a missing or hidden element silently passes (driver
   * records OK and moves on).  Use for fields that only render based
   * on another field's value — e.g. the Storage subfields (B84–B101)
   * only appear when B31=Yes.
   */
  optional?: boolean;

  /**
   * Override the driver's default post-action wait (ms).  Useful for
   * buttons that trigger a slow async action — e.g. the "Search CSLB"
   * button takes ~15 s to populate downstream contractor fields, and
   * the subsequent field entries would race the populate if we didn't
   * wait.
   */
  postDelayMs?: number;

  /**
   * Override the driver's pre-action wait (ms).  Currently honored by
   * `nav` only.  Used on wizard-7's Next button to wait for both
   * parallel file uploads to actually finish on the server before
   * navigating — without this, setInputFiles returns immediately
   * (the upload is async), Next clicks before the multipart POST
   * has even started, and PowerClerk silently advances the wizard
   * with no files attached.
   */
  preDelayMs?: number;

  /**
   * Transform the source value before filling.  Named so the map stays
   * data-only (no inline functions).  Resolved in the driver.  Current
   * transforms:
   *   address.street | address.city | address.state | address.zip
   *     — parse a full "street city, ST zip" into parts.  Lets multiple
   *     fields share one B-code (the calculator emits the address
   *     pre-joined).
   */
  valueTransform?:
    | "address.street"
    | "address.city"
    | "address.state"
    | "address.zip"
    | "name.first"
    | "name.last"
    | "shading.percent";
  /**
   * For `checkbox-all` only: cap how many of the selector-matched
   * checkboxes actually get checked.  Useful when the page renders an
   * opt-in box (e.g. wizard-5's D1 residential-equity attestation) that
   * must NOT be checked by default.  When omitted, every matching
   * checkbox is checked.
   */
  limit?: number;

  /**
   * For `file` only: when true, the driver fires setInputFiles and
   * returns immediately, letting the next entry start its upload
   * concurrently.  PowerClerk uploads two files on wizard-7 (SLD +
   * Job Card); without this flag they upload serially and the wizard
   * pauses ~10 s between them.  The subsequent nav entry's
   * postDelayMs is what actually waits for both to finish.
   */
  parallel?: boolean;
}

/**
 * Field map for the SCE NBT application, wizards 1–5.  Each entry maps
 * a PowerClerk form field to the calculator B-code it reads from.
 *
 * Selectors are label-based — PowerClerk's input `id`s are stable per
 * form version but visually meaningless (e.g. "DWU5WVHC8VU8Input"), so
 * labels give us a readable map that survives form churn better than
 * raw ids.
 *
 * Source of truth: `tmp/powerclerk-walk-final/wizard-N-*.json` captures
 * from the inspector.  When PowerClerk changes a label, re-run the
 * inspector and diff; update labels here accordingly.
 *
 * Coverage notes:
 *   • Wizard 5's 12 monthly solar-access inputs (Jan–Dec) are TODO —
 *     need a payload extension beyond cells.
 *   • Optional/non-required fields are mostly omitted; add as we learn
 *     which ones SCE actually checks.
 *   • Wizard 6 (NBT size attestation + disclosure) is excluded until
 *     the conditional-checkbox policy is decided.
 */
export const FIELD_MAP: FieldMapEntry[] = [
  // ── Acknowledgment page (pre-wizard-1) ────────────────────────────
  {
    step: "acknowledgment",
    source: null,
    selector: { css: "input[type='checkbox']" },
    kind: "checkbox-all",
    note: "Single acknowledgment checkbox on the landing page",
  },
  {
    step: "acknowledgment",
    source: null,
    selector: { role: "button", name: /^Next$/ },
    kind: "nav",
  },

  // ── Wizard 1 — Program / NBT setup ────────────────────────────────
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B23" },
    selector: { label: "Please indicate the program under which you intend to participate:" },
    kind: "select",
  },
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B25" },
    selector: { label: "Are you participating in the Net Surplus Compensation (NSC) program?" },
    kind: "select",
  },
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B26" },
    selector: {
      label:
        "Please indicate below if the Customer elects to participate in the CEO pursuant to Section F.7 of Rule 21 for the costs associated with any applicable Interconnection Facilities, Distribution Upgrades and/or Network Upgrades.",
    },
    kind: "select",
  },
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B27" },
    selector: { role: "radio", name: /New NBT or NEM|Modification to Existing/ },
    kind: "radio",
    note: "B27 value must exactly match one of: 'New NBT or NEM - Existing SCE Meter', 'New NBT or NEM - New SCE Meter', 'Modification to Existing NBT or NEM'",
  },
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B29" },
    selector: { label: "Is the Generating Facility part of a New Construction?" },
    kind: "select",
  },
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B36a" },
    selector: { label: "Is there an Electric Vehicle (EV) Charger installed at the Generating Facility?" },
    kind: "select",
  },
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B30" },
    selector: { label: "Please indicate if the Generating Facility will be operated as a Microgrid System?" },
    kind: "select",
  },
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B31" },
    selector: {
      label:
        "Will an Energy Storage Device (ESD) be newly interconnected or modified (e.g., Batteries, NBT Paired Storage), or are you applying for Vehicle-Grid Integration (VGI) as part of this Application?",
    },
    kind: "select",
  },
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B32" },
    selector: {
      label:
        "Will you be installing 1) a non-export relay on the storage device(s) or 2) a NGOM Directly to the NBT or NEM REGF(s) or 3) Utilizing a Certified Power Control System or 4) Utilizing a non-export protection scheme or 5) Utilizing the Maximum Continuous Discharge rating methodology for the storage device(s)?",
    },
    kind: "select",
  },
  // Confirmation checkbox that conditionally appears AFTER B32 is
  // selected: "Please click on the checkbox to confirm understanding
  // of these options".  Optional flag covers older form versions
  // where the checkbox doesn't render.  checkbox-all matches every
  // checkbox returned by the selector — anchoring on the label text
  // narrows it to just this one.
  {
    step: "wizard-1",
    source: null,
    selector: {
      label: "Please click on the checkbox to confirm understanding of these options",
    },
    kind: "checkbox-all",
    optional: true,
    note: "B33 — confirmation checkbox (conditionally rendered)",
  },
  // B34 — "What use case will the Certified Power Control System
  // operate with?".  Renders only when B32 = "Certified Power
  // Control System"; for the other B32 options this select is hidden
  // and the optional flag silently skips it.
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B34" },
    selector: {
      label: "What use case will the Certified Power Control System operate with?",
    },
    kind: "select",
    optional: true,
    note: "B34 — PCS use case (conditional on B32 = Certified Power Control System)",
  },
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B36b" },
    selector: {
      label:
        "A. Indicate below if Applicant is proposing to use Certified Power Control Systems to maintain a level of export that is lower than the Generating Facility’s Gross Nameplate Rating:",
    },
    kind: "select",
  },
  {
    step: "wizard-1",
    source: { kind: "cell", cellId: "B36c" },
    selector: { label: "B. Is the Generating Facility a Limited Generation Profile participant (LGP Facility)?" },
    kind: "select",
  },
  {
    step: "wizard-1",
    source: null,
    selector: { role: "button", name: /^Next$/ },
    kind: "nav",
  },

  // ── Wizard 2 — Customer / Contact info ────────────────────────────
  { step: "wizard-2", source: { kind: "cell", cellId: "B38" }, selector: { label: "Customer Sector" }, kind: "select" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B38a" }, selector: { label: "Title of person signing Agreement" }, kind: "text" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B39" }, selector: { label: "Customer Type" }, kind: "select" },
  {
    step: "wizard-2",
    source: { kind: "cell", cellId: "B40" },
    selector: {
      label:
        'Service Account Number (looks like 8xxxxxxxxx on your bill). Enter the "8" followed by digits only. Do NOT include dashes.',
    },
    kind: "text",
  },
  {
    step: "wizard-2",
    source: { kind: "cell", cellId: "B41" },
    selector: {
      label:
        'Customer Account Number (looks like 7xxxxxxxxxxx on your bill). Enter the "7" followed by the digits only. Do NOT include dashes.',
    },
    kind: "text",
  },
  { step: "wizard-2", source: { kind: "cell", cellId: "B42" }, selector: { label: "Meter Number" }, kind: "text" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B43" }, selector: { label: "Annual usage (kWh)" }, kind: "text" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B44" }, selector: { label: "Electric Rate Schedule" }, kind: "select" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B45" }, selector: { label: "Service Voltage of Main Panel (Volts)" }, kind: "select" },

  // Generating Service Account block — fieldset-scoped to disambiguate
  // from the Customer Contact block that reuses the same labels.
  { step: "wizard-2", source: { kind: "cell", cellId: "B46" }, selector: { label: "Name", within: "Generating Service Account" }, kind: "text", valueTransform: "name.first" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B46" }, selector: { label: "Last", nth: 0 }, kind: "text", valueTransform: "name.last", note: "Last field within Generating Service Account — first 'Last' on the page" },
  // B47 (Company) is guidance text ("Can leave this box empty..."), not
  // a real value — intentionally omitted.  Re-add with a real source if
  // the calculator starts emitting an actual company.
  { step: "wizard-2", source: { kind: "cell", cellId: "B48" }, selector: { label: "Address", within: "Generating Service Account" }, kind: "text", valueTransform: "address.street" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B48" }, selector: { label: "City", within: "Generating Service Account" }, kind: "text", valueTransform: "address.city" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B48" }, selector: { label: "State", within: "Generating Service Account" }, kind: "select", valueTransform: "address.state" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B48" }, selector: { label: "Zip Code", within: "Generating Service Account" }, kind: "text", valueTransform: "address.zip" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B49" }, selector: { label: "Email", within: "Generating Service Account" }, kind: "text" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B50" }, selector: { label: "Phone", within: "Generating Service Account" }, kind: "text" },

  { step: "wizard-2", source: { kind: "cell", cellId: "B51" }, selector: { label: "County" }, kind: "select" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B52" }, selector: { label: "Existing contact to use for this contact" }, kind: "select" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B53" }, selector: { label: "Are you a Self-Installer? (i.e., Homeowner, Service Account Holder,etc.)" }, kind: "select" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B54" }, selector: { label: "Who is the main PROJECT contact for this application?" }, kind: "select" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B55" }, selector: { label: "CSLB Number" }, kind: "text" },
  // Click "Search CSLB" to auto-populate the contractor block from the
  // state license database.  The request takes ~15 s — subsequent
  // contractor fields race the populate if we don't wait.  Any values
  // our own entries fill afterward will overwrite CSLB's data, which is
  // usually what we want (calculator strings are curated).
  {
    step: "wizard-2",
    source: null,
    selector: { role: "button", name: /^Search CSLB$/ },
    kind: "nav",
    postDelayMs: 15000,
  },

  // Contractor / Installer block — name splits across First (labeled
  // "Contractor / Installer Contact Name") and Last (plain "Last", the
  // 2nd "Last" on the page after Generating Service Account's).
  // getByLabel wouldn't bind to the Contractor First field (likely a
  // help-icon or required-asterisk span inside the <label> confuses
  // Playwright's accessibility tree), so select by placeholder + nth
  // instead.  "First" placeholder is the 3rd such field on the page:
  // Generating Service Account, Customer Contact, Contractor.
  { step: "wizard-2", source: { kind: "cell", cellId: "B57" }, selector: { placeholder: "First", nth: 2 }, kind: "text", valueTransform: "name.first" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B57" }, selector: { placeholder: "Last", nth: 2 }, kind: "text", valueTransform: "name.last" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B58" }, selector: { label: "Contractor / Installer Email Address" }, kind: "text" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B59" }, selector: { label: "Contractor / Installer Phone" }, kind: "text" },

  // B60 — "Was there a licensed salesperson..." — radio scoped by the
  // fieldset legend (full legend text truncated here; partial match is
  // handled by the scope helper's :text-is being exact, so we use the
  // full known text).
  {
    step: "wizard-2",
    source: { kind: "cell", cellId: "B60" },
    selector: {
      role: "radio",
      name: /^(Yes|No)$/,
      within:
        "Was there a licensed salesperson with a Home Improvement Salesperson (HIS) Registration Number involved in this transaction?",
    },
    kind: "radio",
  },
  { step: "wizard-2", source: { kind: "literal", value: "Yes" }, selector: { label: "Has the California Solar Consumer Protection Packet been electronically signed?" }, kind: "select" },
  // B61 preparer — same First/Last split as contractor.  4th "First"
  // and 4th "Last" on the page (GSA, Customer Contact, Contractor,
  // Preparer).
  { step: "wizard-2", source: { kind: "cell", cellId: "B61" }, selector: { placeholder: "First", nth: 3 }, kind: "text", valueTransform: "name.first" },
  { step: "wizard-2", source: { kind: "cell", cellId: "B61" }, selector: { placeholder: "Last", nth: 3 }, kind: "text", valueTransform: "name.last" },

  // Wizard-2 attachments — the 4 contract-related file inputs render
  // BELOW the HIS Registration radio on this page.  Index-based
  // selectors don't work here: PowerClerk has hidden file inputs
  // interspersed in DOM order (a previous run with nth=0..3 put
  // the Consumer Protection Packet file into the Electronic
  // Signature Certificate slot — DOM order ≠ visible order).
  // Anchor each entry on its label text via xpath so it binds to
  // the right row regardless of hidden siblings.
  // Wrap the whole "ancestors w/ matching text → following input"
  // pattern in `(...)[1]` so the xpath evaluates as a single
  // node-set and Playwright sees exactly one match — avoids both
  // strict-mode violations and ancestor-explosion (every ancestor
  // of the label has the text in its subtree, each yielding a
  // different `following::input`).
  { step: "wizard-2", source: { kind: "payload-files", path: "contractFullUrl" },    selector: { css: 'xpath=(//label[contains(normalize-space(.), "Executed Purchase Agreement")]/following::input[@type="file"])[1]' }, kind: "file", parallel: true, note: "Executed Purchase Agreement (full contract)" },
  { step: "wizard-2", source: { kind: "payload-files", path: "contractFirst24Url" }, selector: { css: 'xpath=(//label[contains(normalize-space(.), "California Solar Consumer Protection Packet") and not(contains(normalize-space(.), "Electronic Signature"))]/following::input[@type="file"])[1]' }, kind: "file", parallel: true, note: "Consumer Protection Packet (first 24 pp)" },
  { step: "wizard-2", source: { kind: "payload-files", path: "contractLast4Url" },   selector: { css: 'xpath=(//label[contains(normalize-space(.), "Electronic Signature Certificate")]/following::input[@type="file"])[1]' }, kind: "file", parallel: true, optional: true, note: "CPP Electronic Signature Certificate (last 4 pp)" },
  { step: "wizard-2", source: { kind: "payload-files", path: "cpucPacketUrl" },      selector: { css: 'xpath=(//label[contains(normalize-space(.), "CSLB Solar Disclosure Document")]/following::input[@type="file"])[1]' }, kind: "file", parallel: true, note: "CSLB Solar Disclosure Document (CPUC packet)" },

  // preDelay holds the wizard-2 Next click long enough for all four
  // parallel uploads to finish server-side.  Largest of these is the
  // full contract (~5 MB).  Observed real upload time was well under
  // 12 s in practice; tune higher if uploads start racing the click
  // on slower networks.
  { step: "wizard-2", source: null, selector: { role: "button", name: /^Next$/ }, kind: "nav", preDelayMs: 12500 },

  // ── Wizard 3 — Generation Facility (combined old wizards 3+4+5) ──
  // ALL of these fields live on ONE PowerClerk page.  Earlier I split
  // them into three "wizards" because the inspector captured progressive
  // reveals, but those were just DOM states of the same page.  Flow:
  //   1. Technology Type (B63) — selecting "Solar PV" reveals the
  //      Inverter/PV Array setup block.
  //   2. Optional storage fields (B84–B91) if B31=Yes.
  //   3. Inverter Qty (B64), PV Array Qty (B67).  Mfr/Model dropdowns
  //      (B65/B66/B68/B69) are custom combobox widgets — TODO.
  //   4. Click Calculate — reveals Mounting / Tilt / Azimuth / monthly
  //      solar access.
  //   5. Fill Mounting (B74), Multiple-facing (B75), Monitoring (B76),
  //      Connection (B78), Tilt (B70), Azimuth (B71), Tracking (B72).
  //      Monthly solar access is TODO (needs payload extension).
  //   6. Click Next to advance to wizard 4 (NBT attestation + disclosure).
  // No intermediate Next clicks — those advanced past the whole page.
  { step: "wizard-3", source: { kind: "cell", cellId: "B63" }, selector: { label: "Technology Type" }, kind: "select" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B83" }, selector: { label: 'Do you have a 2nd New Generator "type" different from above?' }, kind: "select" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B84" }, selector: { label: "What type of Energy Storage?" }, kind: "select", optional: true },
  { step: "wizard-3", source: { kind: "cell", cellId: "B85" }, selector: { label: "Number of Energy Storage Devices" }, kind: "text", optional: true },
  { step: "wizard-3", source: { kind: "cell", cellId: "B86" }, selector: { label: "Energy Storage Device Manufacturer" }, kind: "text", optional: true },
  { step: "wizard-3", source: { kind: "cell", cellId: "B87" }, selector: { label: "Energy Storage Device Model" }, kind: "text", optional: true },
  { step: "wizard-3", source: { kind: "cell", cellId: "B88" }, selector: { label: "Energy Storage Max Capacity (kWh)" }, kind: "text", optional: true },
  { step: "wizard-3", source: { kind: "cell", cellId: "B89" }, selector: { label: "Energy Storage Rated Discharge (kW)" }, kind: "text", optional: true },
  { step: "wizard-3", source: { kind: "cell", cellId: "B90" }, selector: { label: "Energy Storage Max Discharge (kW)" }, kind: "text", optional: true },
  { step: "wizard-3", source: { kind: "cell", cellId: "B91" }, selector: { label: "Will the ESD/EVSE utilize its own inverters (different from above)?" }, kind: "select", optional: true },

  // B92/B93/B94 — ESD inverter details.  Only render when B91="Yes"; most
  // OC Solar projects have battery-integrated inverters (Powerwall 3, etc.)
  // so B91=No and these fields never appear.  Marked optional.
  { step: "wizard-3", source: { kind: "cell", cellId: "B92" }, selector: { label: "Number of ESD Inverters" }, kind: "text", optional: true },
  { step: "wizard-3", source: { kind: "cell", cellId: "B93" }, selector: { label: "ESD/EVSE Inverter Manufacturer" }, kind: "text", optional: true },
  { step: "wizard-3", source: { kind: "cell", cellId: "B94" }, selector: { label: "ESD/EVSE Inverter Model Number" }, kind: "text", optional: true },

  // B95 — "Please list the devices used to limit discharge, if any"
  // (free-text).  Calculator resolves to a manufacturer-specific device
  // name (inverter model) or "N/A".
  { step: "wizard-3", source: { kind: "cell", cellId: "B95" }, selector: { label: "Please list the devices used to limit discharge, if any" }, kind: "text" },

  // B96 — "Will you be interconnecting an additional 'type' of ESD/EVSE
  // different (manufacturer and model) from above?"  Yes/No select.
  { step: "wizard-3", source: { kind: "cell", cellId: "B96" }, selector: { label: "Will you be interconnecting an additional" }, kind: "select" },

  // B97 — "Please describe the intended use of the storage device or EVSE"
  // (free-text).  Calculator emits a manufacturer-specific canned answer
  // or "N/A".
  { step: "wizard-3", source: { kind: "cell", cellId: "B97" }, selector: { label: "Please describe the intended use of the storage device or EVSE" }, kind: "text" },

  // B98 — "Rated Charge Load Demand (kW)".  Same numeric value as B89
  // (rated discharge) in the calculator.
  { step: "wizard-3", source: { kind: "cell", cellId: "B98" }, selector: { label: "Rated Charge Load Demand (kW)" }, kind: "text" },

  // B99 — "Estimated annual Net Energy Usage* of the ESD/EVSE (kWh)".
  // Derived from B85 × 1000 in the calculator.
  { step: "wizard-3", source: { kind: "cell", cellId: "B99" }, selector: { label: "Estimated annual Net Energy Usage" }, kind: "text" },

  // B100 — "Will SCE's Distribution System be used to charge the storage
  // device or EVSE?"  Yes/No select.  Calculator hardcodes "No".
  { step: "wizard-3", source: { kind: "cell", cellId: "B100" }, selector: { label: "Will SCE" }, kind: "select" },

  // B101 — "Please provide information on either (1) how the grid will be
  // used to charge the ESD/EVSE, or (2) if the grid will not be used..."
  // Long free-text.  Calculator emits a canned PCS description paragraph.
  { step: "wizard-3", source: { kind: "cell", cellId: "B101" }, selector: { label: "Please provide information on either" }, kind: "text" },

  // B102 — "Will the Generating Facility(ies) export power to SCE's
  // Distribution System?"  Yes/No select.  Calculator hardcodes "Yes".
  { step: "wizard-3", source: { kind: "cell", cellId: "B102" }, selector: { label: "Will the Generating Facility" }, kind: "select" },

  // B103 — "Specify the Generating Facility's maximum coincident export to
  // the grid (kW)".  Only rendered when B102="Yes" — marked optional in case
  // future policy changes flip B102.
  { step: "wizard-3", source: { kind: "cell", cellId: "B103" }, selector: { label: "Specify the Generating Facility" }, kind: "text", optional: true },

  // B104 — "If all generation sources are not simultaneously exporting to
  // the grid, please provide a technical description of the control systems
  // for this function".  Long free-text.  Calculator emits a canned
  // PCS-coordination paragraph.
  { step: "wizard-3", source: { kind: "cell", cellId: "B104" }, selector: { label: "If all generation sources are not simultaneously" }, kind: "text" },

  // Inverter and PV Array setup (live on same page as Technology Type).
  // The mfr/model dropdowns are custom combobox widgets: click "Please
  // select…" → type search term → pick the matching option.  Order
  // matters — Inverter Qty + Mfr + Model come first (Model only renders
  // after Mfr is chosen), then PV Array.  The driver always targets the
  // first visible "Please select…" trigger, so positions take care of
  // themselves as each dropdown is filled.
  { step: "wizard-3", source: { kind: "cell", cellId: "B64" }, selector: { placeholder: "Qty", nth: 0 }, kind: "text", note: "Inverter Qty" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B65" }, selector: { css: "body" /* unused — driver picks first 'Please select…' */ }, kind: "combobox-search", note: "Inverter Mfr" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B66" }, selector: { css: "body" }, kind: "combobox-search", note: "Inverter Model" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B67" }, selector: { placeholder: "Qty", nth: 1 }, kind: "text", note: "PV Array Qty" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B68" }, selector: { css: "body" }, kind: "combobox-search", note: "PV Array Mfr" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B69" }, selector: { css: "body" }, kind: "combobox-search", note: "PV Array Model" },

  // Tilt / Azimuth / Tracking live inside the PV Array block, directly
  // below the mfr/model dropdowns on the page.
  { step: "wizard-3", source: { kind: "cell", cellId: "B70" }, selector: { label: "Tilt" }, kind: "text" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B71" }, selector: { label: "Azimuth" }, kind: "text" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B72" }, selector: { label: "Tracking" }, kind: "select" },

  // 12 monthly solar-access inputs.  PowerClerk assigns stable IDs
  // `pvSystemSubsystem1Array0ShadingN` (N=0..11 for Jan..Dec).  B73's
  // value is currently a human-readable string ("84% for each month
  // January - December"); the `shading.percent` transform pulls the
  // leading number and we paste it into each month.  When the calc
  // starts emitting per-month values, upgrade this to per-index.
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading0" }, kind: "text", valueTransform: "shading.percent", note: "Jan" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading1" }, kind: "text", valueTransform: "shading.percent", note: "Feb" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading2" }, kind: "text", valueTransform: "shading.percent", note: "Mar" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading3" }, kind: "text", valueTransform: "shading.percent", note: "Apr" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading4" }, kind: "text", valueTransform: "shading.percent", note: "May" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading5" }, kind: "text", valueTransform: "shading.percent", note: "Jun" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading6" }, kind: "text", valueTransform: "shading.percent", note: "Jul" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading7" }, kind: "text", valueTransform: "shading.percent", note: "Aug" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading8" }, kind: "text", valueTransform: "shading.percent", note: "Sep" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading9" }, kind: "text", valueTransform: "shading.percent", note: "Oct" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading10" }, kind: "text", valueTransform: "shading.percent", note: "Nov" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B73" }, selector: { css: "#pvSystemSubsystem1Array0Shading11" }, kind: "text", valueTransform: "shading.percent", note: "Dec" },

  // Calculate must fire AFTER Tilt/Azimuth/Shading — it computes the
  // System/Inverter Rating from them; if clicked earlier the ratings
  // stay blank and Next refuses to advance.
  {
    step: "wizard-3",
    source: null,
    selector: { role: "button", name: /^Calculate$/ },
    kind: "nav",
    postDelayMs: 3000,
  },

  // Mounting / Multi-facing / Monitoring / Connection live below the
  // PV Array block, and don't feed into Calculate — safe to fill after.
  { step: "wizard-3", source: { kind: "cell", cellId: "B74" }, selector: { label: "Mounting Method" }, kind: "select" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B75" }, selector: { label: "Are the modules multiple facing arrays?" }, kind: "select" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B76" }, selector: { label: "Are System Output Performance Monitoring and Reporting Services being utilized?" }, kind: "select" },
  // B77 — "Please indicate who is receiving the data" (Customer | Vendor | Other).
  // Driven by PPA status: Customer for non-PPA, Vendor for PPA.
  { step: "wizard-3", source: { kind: "cell", cellId: "B77" }, selector: { label: "Please indicate who is receiving the data" }, kind: "select" },
  // B77a — conditional text field revealed only when B77 = "Vendor".  Holds
  // the PPA provider name (Palmetto / Goodleap / Enfin).  Marked optional
  // so the driver silently skips it on non-PPA (Customer) submissions.
  {
    step: "wizard-3",
    source: { kind: "cell", cellId: "B77a" },
    selector: { label: "If applicable, which vendor is receiving the data?" },
    kind: "text",
    optional: true,
  },
  { step: "wizard-3", source: { kind: "cell", cellId: "B78" }, selector: { label: "Electrical Connection Method" }, kind: "select" },

  // B79/B80/B81 — Meter Socket Adapter block.  Only renders when B78 =
  // "Load side connection-Meter Socket Adapter"; marked optional so
  // the driver skips them cleanly otherwise.  B79 is a Yes/No radio;
  // B80/B81 are native selects (Manufacturer → Tesla/Enphase; Model
  // depends on Manufacturer).
  {
    step: "wizard-3",
    source: { kind: "cell", cellId: "B79" },
    selector: {
      role: "radio",
      name: /^(Yes|No)$/,
      within: "Does the MSA request meet ALL of the criteria above?",
    },
    kind: "radio",
    optional: true,
  },
  // B79's radio click triggers PowerClerk to lazy-load the MSA
  // Manufacturer options.  preDelayMs gives the option list time to
  // populate; without it the select fires before the network round
  // trip and PowerClerk hands us back an empty <options> list, which
  // surfaces as "No matching option for ... Available: ".  B81 model
  // dropdown depends on B80 the same way.
  { step: "wizard-3", source: { kind: "cell", cellId: "B80" }, selector: { label: "Manufacturer" }, kind: "select", optional: true, preDelayMs: 1200, note: "MSA Manufacturer" },
  { step: "wizard-3", source: { kind: "cell", cellId: "B81" }, selector: { label: "Model" }, kind: "select", optional: true, preDelayMs: 1200, note: "MSA Model" },

  // B82 — "Does the Generating Facility meet any of the criteria below?"
  // Yes/No radio.  Calculator resolves to "Yes" for virtually every
  // battery project (criterion: additional generation on-site includes
  // ESS).  Scoped to the question's legend so it doesn't collide with
  // B79's similarly-shaped Yes/No radio.
  {
    step: "wizard-3",
    source: { kind: "cell", cellId: "B82" },
    selector: {
      role: "radio",
      name: /^(Yes|No)$/,
      within: "Does the Generating Facility meet any of the criteria below?",
    },
    kind: "radio",
  },

  { step: "wizard-3", source: null, selector: { role: "button", name: /^Next$/ }, kind: "nav" },

  // ── WIZARD-4 — Section (5) Existing Generating Facility ────────────
  // Short page: B106 gates everything.  When B106=No (no prior
  // interconnection), the page collapses to just B106 + B121.  When
  // B106=Yes, B107/B109/B118/B119/B120 render before B121.  Every
  // B106=Yes dependent field is marked optional so the driver skips
  // cleanly on new-construction / first-time solar projects.

  // B106 — "Do you have existing Generator(s) that have been previously
  // interconnected?"  Gates every downstream field on this page.
  { step: "wizard-4", source: { kind: "cell", cellId: "B106" }, selector: { label: "Do you have existing Generator" }, kind: "select" },

  // B107 — "Is the Generator served on a NBT/NEM program?"  Only renders
  // when B106=Yes.
  { step: "wizard-4", source: { kind: "cell", cellId: "B107" }, selector: { label: "Is the Generator served on a NBT" }, kind: "select", optional: true },

  // B109 — "Technology Type" for the existing generator.  Typically
  // "Solar PV".
  { step: "wizard-4", source: { kind: "cell", cellId: "B109" }, selector: { label: "Technology Type" }, kind: "select", optional: true },

  // B111-B116 — Existing inverter + PV array nested-row block.  Same
  // PowerClerk widget shape as wizard-3's B64-B69 setup (Qty text +
  // CEC manufacturer combobox + CEC model combobox).  Only renders
  // when B106=Yes / B109=Solar PV.  Filled from project.existingGenerator
  // via buildPreview's override; placeholders marked optional so the
  // driver skips cleanly on no-prior-NEM submissions where these
  // controls don't render.
  //
  // Order matters identically to wizard-3: Qty before Mfr, Mfr before
  // Model (Model dropdown only populates after Mfr is chosen).  The
  // `nth` selector counts visible "Qty" placeholders on the page —
  // wizard-4's existing-generator block is independent of wizard-3, so
  // nth: 0 / 1 select Inverter / PV Array within the existing block.
  { step: "wizard-4", source: { kind: "cell", cellId: "B111" }, selector: { placeholder: "Qty", nth: 0 }, kind: "text", optional: true, note: "Existing Inverter Qty" },
  { step: "wizard-4", source: { kind: "cell", cellId: "B112" }, selector: { css: "body" }, kind: "combobox-search", optional: true, note: "Existing Inverter Mfr" },
  // Inverter Model dropdown lazy-loads its option list after the Mfr
  // is chosen.  preDelayMs gives the dropdown time to populate before
  // we open it; without this the search filters against an empty
  // option list and the throw bubbles up.  Same trick on B116 below.
  { step: "wizard-4", source: { kind: "cell", cellId: "B113" }, selector: { css: "body" }, kind: "combobox-search", optional: true, preDelayMs: 1200, note: "Existing Inverter Model" },
  { step: "wizard-4", source: { kind: "cell", cellId: "B114" }, selector: { placeholder: "Qty", nth: 1 }, kind: "text", optional: true, note: "Existing PV Array Qty" },
  { step: "wizard-4", source: { kind: "cell", cellId: "B115" }, selector: { css: "body" }, kind: "combobox-search", optional: true, note: "Existing PV Array Mfr" },
  { step: "wizard-4", source: { kind: "cell", cellId: "B116" }, selector: { css: "body" }, kind: "combobox-search", optional: true, preDelayMs: 1200, note: "Existing PV Array Model" },

  // Tilt + Azimuth on the existing PV Array block.  PowerClerk
  // renders these as labeled text inputs nested under the PV Array
  // row (same widget shape as wizard-3's B70/B71 for the new
  // system).  The cellIds use an EG_-prefixed namespace because the
  // calculator's result sections don't carry these fields — they're
  // SCE-submission-only and the panel attaches them to the payload
  // in onSubmit().  Optional so no-prior-NEM submissions skip
  // cleanly.  Filled BEFORE Calculate so the System Rating /
  // Inverter Rating computation has the geometry it needs.
  { step: "wizard-4", source: { kind: "cell", cellId: "EG_TILT" }, selector: { label: "Tilt" }, kind: "text", optional: true, note: "Existing PV Array Tilt" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EG_AZIMUTH" }, selector: { label: "Azimuth" }, kind: "text", optional: true, note: "Existing PV Array Azimuth" },

  // Calculate button on the existing-generator block.  Mirrors
  // wizard-3's Calculate — clicking it computes System Rating /
  // Inverter Rating from the Qty + Mfr + Model entries.  Marked
  // optional so submissions where the existing block isn't rendered
  // (B106=No path) skip it cleanly.  postDelayMs holds long enough
  // for the ratings to land before the next field interacts.
  {
    step: "wizard-4",
    source: null,
    selector: { role: "button", name: /^Calculate$/ },
    kind: "nav",
    optional: true,
    postDelayMs: 3000,
  },

  // B117 — "Electrical Connection Method" for the existing generator.
  // Only renders when B106=Yes.  Same label text as wizard-3's B78
  // but on a different page — wizard-4 scope prevents collision.
  { step: "wizard-4", source: { kind: "cell", cellId: "B117" }, selector: { label: "Electrical Connection Method" }, kind: "select", optional: true },

  // B118 — "Prime Mover Type".  Calculator emits "Photovoltaic Panels".
  { step: "wizard-4", source: { kind: "cell", cellId: "B118" }, selector: { label: "Prime Mover Type" }, kind: "select", optional: true },

  // B119 — "Operating Voltage (kV)".  Numeric text.  Calculator emits
  // 0.24 (residential 240V).
  { step: "wizard-4", source: { kind: "cell", cellId: "B119" }, selector: { label: "Operating Voltage (kV)" }, kind: "text", optional: true },

  // B120 — "Do you have a 2nd Existing Generator 'type' different from
  // above?"  Yes/No select, calculator hardcodes "No".
  { step: "wizard-4", source: { kind: "cell", cellId: "B120" }, selector: { label: "Do you have a 2nd Existing Generator" }, kind: "select", optional: true },

  // B121 — "Is an Energy Storage Device currently interconnected (e.g.,
  // batteries, EVSE)?"  Always shown regardless of B106.  Calculator
  // derives Yes when B3 reports existing battery equipment, else No.
  { step: "wizard-4", source: { kind: "cell", cellId: "B121" }, selector: { label: "Is an Energy Storage Device currently interconnected" }, kind: "select" },

  // ── Existing-battery sub-block (revealed when B121=Yes) ────────────
  // Filled from project.existingBattery via the panel's onSubmit
  // payload mutation.  All entries marked optional so projects without
  // a previously-installed battery (B3 != "Existing Battery" and
  // != "Existing Solar & Battery") skip cleanly.  The "What type of
  // Energy Storage?" select is hardcoded to "Battery" via a literal
  // source — there's only one valid value for OC Solar projects.
  { step: "wizard-4", source: { kind: "literal", value: "Battery" }, selector: { label: "What type of Energy Storage" }, kind: "select", optional: true, note: "Existing Battery — Type" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_NUM_DEVICES" }, selector: { label: "Number of Energy Storage Devices" }, kind: "text", optional: true, note: "Existing Battery — # Devices" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_DEVICE_MFR" }, selector: { label: "Energy Storage Device Manufacturer" }, kind: "text", optional: true, note: "Existing Battery — Mfr" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_DEVICE_MODEL" }, selector: { label: "Energy Storage Device Model" }, kind: "text", optional: true, note: "Existing Battery — Model" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_MAX_CAPACITY_KWH" }, selector: { label: "Energy Storage Max Capacity" }, kind: "text", optional: true, note: "Existing Battery — Max Capacity (kWh)" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_RATED_DISCHARGE_KW" }, selector: { label: "Energy Storage Rated Discharge" }, kind: "text", optional: true, note: "Existing Battery — Rated Discharge (kW)" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_MAX_DISCHARGE_KW" }, selector: { label: "Energy Storage Max Discharge" }, kind: "text", optional: true, note: "Existing Battery — Max Discharge (kW)" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_USES_OWN_INVERTERS" }, selector: { label: "Does the ESD/EVSE utilize its own inverters" }, kind: "select", optional: true, note: "Existing Battery — Uses Own Inverters" },
  // ESD/EVSE inverter sub-block — only renders when the answer to
  // "Does the ESD/EVSE utilize its own inverters" is Yes.  Marked
  // optional so the No-path skips them silently.  The panel only
  // includes the EB_ESD_INV_* cells in the payload when usesOwnInverters
  // === "Yes", so on the No path the cell-source resolves to no value
  // and `applyField` short-circuits.
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_ESD_INV_COUNT" }, selector: { label: "Number of ESD/EVSE Inverters" }, kind: "text", optional: true, note: "Existing Battery — ESD Inverter Count" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_ESD_INV_MFR" }, selector: { label: "ESD/EVSE Inverter Manufacturer" }, kind: "text", optional: true, note: "Existing Battery — ESD Inverter Mfr" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_ESD_INV_MODEL" }, selector: { label: "ESD/EVSE Inverter Model Number" }, kind: "text", optional: true, note: "Existing Battery — ESD Inverter Model" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_LIMIT_DISCHARGE_DEVICES" }, selector: { label: "Please list the devices used to limit discharge" }, kind: "text", optional: true, note: "Existing Battery — Limit Discharge Devices" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_RATED_CHARGE_LOAD_DEMAND_KW" }, selector: { label: "Rated Charge Load Demand" }, kind: "text", optional: true, note: "Existing Battery — Rated Charge Load Demand (kW)" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_NET_ENERGY_USAGE_KWH" }, selector: { label: "Estimated annual Net Energy Usage" }, kind: "text", optional: true, note: "Existing Battery — Net Energy Usage (kWh)" },
  // Apostrophe-safe substring: PowerClerk renders "SCE's" with a
  // typographic curly apostrophe (’) while our source string has a
  // straight ASCII one ('), and Playwright's label matcher is exact-
  // string by default — so we drop the apostrophe-bearing prefix and
  // match on a span that contains neither.
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_SCE_DIST_FOR_CHARGE" }, selector: { label: "Distribution System be used to charge" }, kind: "select", optional: true, note: "Existing Battery — SCE Distribution Used" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_GRID_INCREASES_PEAK_LOAD" }, selector: { label: "Will charging the storage device or EVSE from the grid" }, kind: "select", optional: true, note: "Existing Battery — Grid Charging Increases Peak Load" },
  // SCE-charging sub-block — only renders when sceDistForCharge="Yes".
  // Optional so the No path skips them silently.  The panel only
  // attaches the cells when sceDistForCharge === "Yes" so on No the
  // cell-source resolves to no value and applyField short-circuits.
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_ADDED_DEMAND_KW" }, selector: { label: "Please provide the amount of added demand" }, kind: "text", optional: true, note: "Existing Battery — Added Demand (kW)" },
  { step: "wizard-4", source: { kind: "cell", cellId: "EB_CHARGE_INFO" }, selector: { label: "Please provide information on either" }, kind: "text", optional: true, note: "Existing Battery — Charging Info" },

  { step: "wizard-4", source: null, selector: { role: "button", name: /^Next$/ }, kind: "nav" },

  // ── WIZARD-5 — Section (6) Rebate Information ──────────────────────
  // 10 attestation checkboxes across A/B/C1/C2 (all must be checked).
  // D1's residential-equity box is deliberately LEFT UNCHECKED — it only
  // applies when the project is in a disadvantaged community and we
  // don't want to falsely attest.  Keeping scope to A/B/C1/C2 also
  // future-proofs against other opt-in boxes SCE may add to the page.
  //
  //   A   Equipment Verification              (1 box)
  //   B   Warranty Verification               (1 box)
  //   C1  NBT Size Attestation — Existing     (5 boxes)
  //   C2  NBT Size Attestation — New Service  (3 boxes)
  //
  // checkbox-all with `limit: 10` — D1 is always the last section on the
  // page, so capping to the first 10 visible checkboxes skips it cleanly
  // without needing exact accessible names.
  {
    step: "wizard-5",
    source: { kind: "checkboxGroup", groupId: "nbtSizeAttestation" },
    selector: { css: 'input[type="checkbox"]:visible' },
    kind: "checkbox-all",
    limit: 10,
  },

  // Follow-up Yes/No questions below the checkbox block — always shown.

  // B127 — "Is this a residential Generation Facility with a maximum
  // capacity of 15 kW or less of electricity?"
  { step: "wizard-5", source: { kind: "cell", cellId: "B127" }, selector: { label: "Is this a residential Generation Facility" }, kind: "select" },

  // B128 — "Is this a single-family home?"
  { step: "wizard-5", source: { kind: "cell", cellId: "B128" }, selector: { label: "Is this a single-family home?" }, kind: "select" },

  // B129 — "Is this a public works project (as defined in Section 1720
  // of the Labor Code)..."  Calculator hardcodes "No".
  { step: "wizard-5", source: { kind: "cell", cellId: "B129" }, selector: { label: "Is this a public works project" }, kind: "select" },

  // B130 — "Does this Generating Facility serve only a modular home,
  // a modular home community, or multiunit housing that has two or
  // fewer stories?"
  { step: "wizard-5", source: { kind: "cell", cellId: "B130" }, selector: { label: "Does this Generating Facility serve only a modular home" }, kind: "select" },

  // B136 — "Are you participating in a California rebate program
  // related to the installation of the Generating Facility?"  "No".
  { step: "wizard-5", source: { kind: "cell", cellId: "B136" }, selector: { label: "Are you participating in a California rebate program" }, kind: "select" },

  // B137 — "Please indicate whether the Generating Facility is or will
  // be owned by a third party".  Options: "Yes (third-party-owned)" vs
  // "No (SCE customer-owned)".  Gates the PPA and customer-owned blocks
  // below.
  { step: "wizard-5", source: { kind: "cell", cellId: "B137" }, selector: { label: "Please indicate whether the Generating Facility is or will be owned by a third party" }, kind: "select" },

  // ── Customer-owned branch (B137 = "No (SCE customer-owned)") ──
  // Both optional so the PPA branch can skip these silently.

  // B138 — "Purchase Price (indicate the system cost paid by the Customer)".
  { step: "wizard-5", source: { kind: "cell", cellId: "B138" }, selector: { label: "Purchase Price" }, kind: "text", optional: true },

  // B139 — "Was this system financed?"  Yes/No select.
  { step: "wizard-5", source: { kind: "cell", cellId: "B139" }, selector: { label: "Was this system financed?" }, kind: "select", optional: true },

  // ── Third-party-owned branch (B137 = "Yes (third-party-owned)") ──
  // All optional so the customer-owned branch can skip these silently.

  // B140 — "Third-Party Owner Company Name".
  { step: "wizard-5", source: { kind: "cell", cellId: "B140" }, selector: { label: "Third-Party Owner Company Name" }, kind: "text", optional: true },

  // B141 — "Third-Party Owner Company Address" — split into Street /
  // City / State / Zip the same way wizard-2 handles the service
  // address.  PowerClerk renders the block as an unlabeled Street /
  // (optional line 2) / City / State / Zip trio, so we target via
  // placeholder for street/city/zip and label for the State dropdown.
  { step: "wizard-5", source: { kind: "cell", cellId: "B141" }, selector: { placeholder: "Street", nth: 0 }, kind: "text", valueTransform: "address.street", optional: true, note: "Third-Party Owner — Street" },
  { step: "wizard-5", source: { kind: "cell", cellId: "B141" }, selector: { placeholder: "City", nth: 0 }, kind: "text", valueTransform: "address.city", optional: true, note: "Third-Party Owner — City" },
  { step: "wizard-5", source: { kind: "cell", cellId: "B141" }, selector: { label: "State" }, kind: "select", valueTransform: "address.state", optional: true, note: "Third-Party Owner — State" },
  { step: "wizard-5", source: { kind: "cell", cellId: "B141" }, selector: { placeholder: "Zip Code", nth: 0 }, kind: "text", valueTransform: "address.zip", optional: true, note: "Third-Party Owner — Zip" },

  // B142 — "Claimed Federal Investment Tax Credit (ITC) Cost Basis".
  // Calculator emits contract cost (B19) for PPA projects, "N/A" otherwise.
  { step: "wizard-5", source: { kind: "cell", cellId: "B142" }, selector: { label: "Claimed Federal Investment Tax Credit" }, kind: "text", optional: true },

  // B143 — "Contract Type".  Select with "PPA" option for PPA projects.
  { step: "wizard-5", source: { kind: "cell", cellId: "B143" }, selector: { label: "Contract Type" }, kind: "select", optional: true },

  // Q5 — "Should this project be considered for review for an
  // exemption from PU Code Section 769.2…"  Yes/No dropdown; we
  // always select No.  Hardcoded via a `literal` source — invariant
  // for OC Solar submissions.
  { step: "wizard-5", source: { kind: "literal", value: "No" }, selector: { label: "Should this project be considered for review for an exemption" }, kind: "select", note: "Q5 PU Code exemption" },

  // "Solar Energy System Supporting Information" file upload — appears
  // on PowerClerk's page 6 (Rebate Information).  The file uploaded
  // here is the same CPUC packet that goes into the CSLB Solar
  // Disclosure Document slot on page 3, so we re-use cpucPacketUrl.
  // Anchored on label text via xpath (paren-grouped to avoid strict-
  // mode violation); see wizard-2 file entries for the same pattern.
  { step: "wizard-5", source: { kind: "payload-files", path: "cpucPacketUrl" }, selector: { css: 'xpath=(//label[contains(normalize-space(.), "Solar Energy System Supporting Information")]/following::input[@type="file"])[1]' }, kind: "file", note: "Solar Energy System Supporting Information (CPUC packet)" },

  // preDelay holds the wizard-5 Next click long enough for the
  // upload to finish.  Single 605 KB file → ~5 s safety margin.
  { step: "wizard-5", source: null, selector: { role: "button", name: /^Next$/ }, kind: "nav", preDelayMs: 6000 },

  // ── WIZARD-6 — Section (7) Agreement Selection ─────────────────────
  // Single dropdown — calculator hardcodes "Standard GFIA" (the
  // residential PPA / cash default).  Other options appear if SCE
  // policy or our Stage-2 selection rules expand later; for now this
  // is a one-line page.
  //
  // IMPORTANT: this dropdown lives on the SAME PowerClerk page as
  // the wizard-7 attachments (PowerClerk's "page 7" — see the step
  // indicator labeled "Attachments").  We do NOT click Next here;
  // the single Next click for the whole page lives at the end of
  // the wizard-7 entries below.
  { step: "wizard-6", source: { kind: "cell", cellId: "B144" }, selector: { label: "Please select the appropriate NBT/NEM Agreement Type" }, kind: "select" },

  // ── WIZARD-7 — Section (7) Attachments ─────────────────────────────
  // SLD is required (red asterisk on the form); Job Card is "(if
  // available)" and may be omitted when the project doesn't yet have a
  // signed inspection card flagged as `isFinalInspectionCard: true`.
  // Both values are temp file paths materialized at driver startup
  // (see materializeFiles in powerclerk-submit-driver.ts).
  // Both uploads fire concurrently (parallel: true).  Selectors are
  // index-based on `input[type="file"]` because PowerClerk renders
  // the file input as a hidden sibling of the visible "Browse"
  // button and the label is not associated via for=/aria-labelledby
  // — getByLabel resolved to the wrong element and timed out on
  // setInputFiles.  Wizard-7 has 5 file inputs in DOM order:
  //   nth=0 Form 16-344 Interconnection Agreement (NOT ours — this
  //         is the optional signed agreement upload at the top of
  //         the page, header "INTERCONNECTION AGREEMENT (If
  //         available)").  Skipped intentionally.
  //   nth=1 Single Line Diagram (B146 — required)
  //   nth=2 Final Electrical Inspection Job Card (B147 — optional)
  //   nth=3 AC Disconnect (open & closed) — unused for now
  //   nth=4 Generating Facility Point of Connection — unused for now
  { step: "wizard-7", source: { kind: "payload-files", path: "sldUrl" }, selector: { css: 'input[type="file"]', nth: 1 }, kind: "file", parallel: true, note: "B146 — SLD" },
  { step: "wizard-7", source: { kind: "payload-files", path: "jobCardUrl" }, selector: { css: 'input[type="file"]', nth: 2 }, kind: "file", optional: true, parallel: true, note: "B147 — Final Electrical Inspection Job Card" },

  // Single Next click for the whole PowerClerk page-7 (which holds
  // both the wizard-6 Agreement dropdown and the wizard-7 file
  // attachments).  preDelayMs holds long enough for the two
  // parallel uploads to fully complete server-side before nav —
  // observed ~10 s for SLD (~500 KB) + Job Card (~75 KB), so 12 s
  // gives a small safety margin without making the driver feel
  // pointlessly slow.  Bump higher if you start seeing uploads
  // race the click on slower networks.
  { step: "wizard-7", source: null, selector: { role: "button", name: /^Next$/ }, kind: "nav", preDelayMs: 12000 },

  // ── WIZARD-8 — Review Application ──────────────────────────────────
  // Read-only review page.  Generate button downloads a summary PDF
  // (saved to ~/Downloads/ via the `download` action kind), then we
  // click Proceed to Payment to advance to wizard-9.  Without
  // clicking Generate first, PowerClerk holds the page —
  // Proceed-to-Payment is disabled until the summary is produced.
  // PowerClerk's "Generate Document" trigger isn't a real <button>
  // (no role="button" on the element), so getByRole misses.  Playwright's
  // `text=` selector engine matches by visible text across element
  // types — covers the actual <input type="button"> / styled <a>
  // variants without us having to know the exact tag.
  { step: "wizard-8", source: null, selector: { css: "text=Generate Document" }, kind: "download", note: "Generate Document (NBT/NEM Application Form 14-957)" },
  { step: "wizard-8", source: null, selector: { role: "button", name: /^Proceed to Payment$/ }, kind: "nav", preDelayMs: 1500 },

  // ── WIZARD-9 — ePayment ────────────────────────────────────────────
  // Radio group ("Credit Card" / "Debit Card") under the
  // "Please select your ePayment method" heading.  OC Solar always
  // pays via Credit Card; literal source.
  //
  // No preDelayMs needed — Playwright's `check()` action auto-waits
  // up to 30 s for the radio to be attached + actionable.  Wizard-9
  // takes 5-15 s to render (PowerClerk allocates the SBP
  // application number server-side first), and the auto-wait
  // adapts to whatever that load actually takes on each run.
  // Driver still stops before the final ePay-and-Submit click
  // (--stop-before-submit default).
  { step: "wizard-9", source: { kind: "literal", value: "Credit Card" }, selector: { role: "radio", name: /Credit Card/ }, kind: "radio", note: "ePayment method = Credit Card" },

  // NOTE: wizard-7 intentionally has NO Next click while we diagnose
  // the auto-advance behavior.  After both parallel setInputFiles
  // calls dispatch the uploads, the driver simply ends — the
  // browser stays open ("Stopped before submit").  Watch the page:
  //   - If PowerClerk auto-advances to wizard-8 once both files
  //     validate, no Next click is needed (our prior runs were
  //     racing PowerClerk's own auto-advance).
  //   - If it does NOT auto-advance, restore a nav entry like:
  //       { step: "wizard-7", source: null,
  //         selector: { role: "button", name: /^Next$/ },
  //         kind: "nav", preDelayMs: 30000 }
  //     and tune preDelayMs to a value larger than the longest
  //     upload time you observe.
];
