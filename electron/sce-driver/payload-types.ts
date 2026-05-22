/**
 * Local copy of the PowerClerk submission payload types.
 *
 * Mirrors `pto-submission-payload.ts` in the ocsolar-portal repo —
 * the panel that produces these payloads lives there.  Kept structural
 * (interfaces only, no helpers) so the desktop app stays decoupled
 * from the portal's calculator pipeline.  Bump
 * `PTO_SUBMISSION_SCHEMA_VERSION` in lockstep with the portal copy.
 */

export const PTO_SUBMISSION_SCHEMA_VERSION = 3;

export type PtoFieldKind = "auto" | "static" | "guidance";

export interface PtoSubmissionCell {
  cellId: string;
  label: string;
  value: string | number | boolean | string[] | null;
  kind: PtoFieldKind;
}

export interface PtoSubmissionPayload {
  schemaVersion: typeof PTO_SUBMISSION_SCHEMA_VERSION;
  generatedAt: string;
  projectId: string;
  customerName: string | null;
  utility: "SCE";
  cells: Record<string, PtoSubmissionCell>;
  checkboxGroups: Record<string, { checkAll: true } | { check: string[] }>;
  files: {
    sldUrl: string | null;
    jobCardUrl: string | null;
    contractFullUrl: string | null;
    contractFirst24Url: string | null;
    contractLast4Url: string | null;
    cpucPacketUrl: string | null;
  };
}
