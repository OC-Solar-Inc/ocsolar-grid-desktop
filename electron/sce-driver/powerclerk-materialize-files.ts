/**
 * Download payload.files.* URLs to local temp paths so Playwright's
 * setInputFiles can hand them to PowerClerk's <input type="file">.
 * The bucket is currently public-read, so an unauthenticated fetch
 * is sufficient; if access is tightened later, switch to the
 * service-account download path documented in
 * SCE_APPLICATION_SUBMISSION_SYSTEM.md (Option 3).
 *
 * Extracted from `powerclerk-submit-driver.ts` so the production
 * mirror in OC_Solar_MCP can copy it verbatim.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import { PtoSubmissionPayload } from "./payload-types";

function log(msg: string) {
  process.stderr.write(`[powerclerk] ${msg}\n`);
}

export interface MaterializedFiles {
  sldUrl: string | null;     // local temp path, or null when payload had no URL
  jobCardUrl: string | null;
  contractFullUrl: string | null;
  contractFirst24Url: string | null;
  contractLast4Url: string | null;
  cpucPacketUrl: string | null;
}

/**
 * Sniff a buffer's file type from its leading magic bytes.  PowerClerk's
 * Section 7 form rejects anything where the actual content doesn't match
 * the file extension (it accepts only DOCX/PDF/CSV/XLSX), so we can't just
 * rename a PNG to .pdf — we have to wrap it in a real PDF.
 */
export function detectFileType(buf: Buffer): "pdf" | "png" | "jpeg" | "unknown" {
  if (buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "%PDF") return "pdf";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  return "unknown";
}

/**
 * Wrap a PNG/JPEG into a single-page PDF whose page matches the image's
 * aspect ratio.  Used when a Job Card was uploaded as a phone photo —
 * the form requires PDF, so we materialize a real one rather than just
 * renaming.
 */
export async function imageBytesToPdf(
  buf: Buffer,
  kind: "png" | "jpeg"
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const img =
    kind === "png" ? await doc.embedPng(buf) : await doc.embedJpg(buf);
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  const out = await doc.save();
  return Buffer.from(out);
}

export async function materializeFiles(
  payload: PtoSubmissionPayload
): Promise<MaterializedFiles> {
  const fetchOne = async (url: string | null, label: string) => {
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${label} download failed: HTTP ${res.status} ${url}`);
    }
    let buf = Buffer.from(await res.arrayBuffer());
    const kind = detectFileType(buf);
    if (kind === "png" || kind === "jpeg") {
      log(`Materialized ${label}: source is ${kind.toUpperCase()}, wrapping into single-page PDF`);
      buf = await imageBytesToPdf(buf, kind);
    } else if (kind === "unknown") {
      throw new Error(
        `${label} download is not a PDF, PNG, or JPEG — refusing to upload (bytes start with: ${buf.slice(0, 8).toString("hex")})`
      );
    }
    const tmp = path.join(
      os.tmpdir(),
      `sce-${label}-${crypto.randomBytes(6).toString("hex")}.pdf`
    );
    await fs.promises.writeFile(tmp, buf);
    log(`Materialized ${label}: ${tmp} (${buf.length} bytes)`);
    return tmp;
  };
  return {
    sldUrl: await fetchOne(payload.files.sldUrl, "sld"),
    jobCardUrl: await fetchOne(payload.files.jobCardUrl, "jobCard"),
    contractFullUrl: await fetchOne(payload.files.contractFullUrl, "contractFull"),
    contractFirst24Url: await fetchOne(payload.files.contractFirst24Url, "contractFirst24"),
    contractLast4Url: await fetchOne(payload.files.contractLast4Url, "contractLast4"),
    cpucPacketUrl: await fetchOne(payload.files.cpucPacketUrl, "cpucPacket"),
  };
}
