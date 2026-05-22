/**
 * Local HTTP shim that lets the OCSolar Portal's SCE submission panel
 * drive PowerClerk against the user's *own* Chromium via Playwright,
 * running inside this Electron app instead of a shared backend.
 *
 *   POST /run                  — body: { payload: PtoSubmissionPayload }
 *                                resp: { jobId }
 *   GET  /events/:jobId        — Server-Sent Events stream of parsed
 *                                driver stderr lines (chip-strip ready).
 *   GET  /health               — { ok: true, version }
 *
 * Lifted from the portal's `src/app/scripts/local-driver-server.ts`
 * dev shim — same wire protocol — but boots from the Electron main
 * process during `app.whenReady` so end users get the same surface
 * without having to start a separate Node script.
 *
 * Listen port defaults to 9999; override with OCS_LOCAL_PORT.  CORS
 * is restricted to localhost — anyone on the local machine can POST,
 * which matches the existing trust boundary (anything that can open
 * the portal in your browser can already POST to a localhost port).
 */

import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";

const DEFAULT_PORT = Number(process.env["OCS_LOCAL_PORT"] || 9999);
// The Electron tsc step compiles `electron/sce-driver/*.ts` →
// `dist-electron/sce-driver/*.js`, so we spawn the compiled output
// with plain `node` — no ts-node dependency at runtime.
const SCE_DRIVER_REL = "sce-driver/powerclerk-submit-driver.js";

interface JobEvent {
  ts: number;
  raw: string;
  level: "info" | "ok" | "warn" | "err";
  step?: string;
  cellId?: string | null;
  kind?: string;
  ok?: boolean;
  note?: string;
}

interface Job {
  id: string;
  child: ChildProcess;
  events: JobEvent[];
  status: "running" | "completed" | "failed";
  exitCode: number | null;
  stoppedBeforeSubmit: boolean;
  finalError: string | null;
  listeners: Set<http.ServerResponse>;
}

const jobs = new Map<string, Job>();

// ── stderr line parser ─────────────────────────────────────────────────

const RE_OK = /^\s*OK\s+\[([^\]]+)\]\s+([\w-]+)(?:\s+\(([^)]+)\))?\s*(.*)$/;
const RE_HOLD = /^pre-action: holding (\d+)ms before nav on ([\w-]+)/;
const RE_MATERIAL = /^Materializ(?:ing|ed)\b(?:\s+(\w+))?/;
const RE_STOPPED = /^Stopped before submit/;
const RE_PAYLOAD = /^Payload loaded:/;
const RE_ERROR = /\b(error|failed|exception)\b/i;

function parseDriverLine(raw: string): JobEvent {
  const ts = Date.now();
  const m = raw.match(/^\[powerclerk\]\s?(.*)$/);
  const body = m ? m[1] : raw;
  const ok = body.match(RE_OK);
  if (ok) {
    const trailing = ok[4]?.trim();
    const note = trailing?.startsWith("—")
      ? trailing.replace(/^—\s*/, "")
      : trailing || undefined;
    return compact({
      ts,
      raw,
      level: "ok" as const,
      step: ok[1],
      kind: ok[2],
      cellId: ok[3] || null,
      ok: true,
      note,
    });
  }
  const hold = body.match(RE_HOLD);
  if (hold) {
    return {
      ts,
      raw,
      level: "info",
      step: hold[2],
      kind: "hold",
      note: `holding ${hold[1]}ms`,
    };
  }
  const mat = body.match(RE_MATERIAL);
  if (mat) {
    return compact({
      ts,
      raw,
      level: "info" as const,
      kind: "materialize",
      note: mat[1],
    });
  }
  if (RE_STOPPED.test(body)) return { ts, raw, level: "info", kind: "stopped-before-submit" };
  if (RE_PAYLOAD.test(body)) return { ts, raw, level: "info", kind: "payload-loaded" };
  if (RE_ERROR.test(body))   return { ts, raw, level: "err" };
  return { ts, raw, level: "info" };
}

function compact<T extends object>(o: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

// ── SSE helpers ─────────────────────────────────────────────────────────

function writeSse(res: http.ServerResponse, eventName: string, data: any) {
  if (res.writableEnded) return;
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(job: Job, eventName: string, data: any) {
  for (const res of job.listeners) writeSse(res, eventName, data);
}

// ── Job lifecycle ───────────────────────────────────────────────────────

/**
 * Resolve the directory holding the sce-driver bundle.  In dev
 * (`npm run electron:dev`) the compiled Electron main lives at
 * `dist-electron/main.js`, with the driver bundled alongside.  In a
 * packaged build electron-builder mirrors the same layout under the
 * app's `resources/app.asar.unpacked` (or unpacked dir).  `__dirname`
 * resolves the same way in both cases as long as we keep sce-driver
 * adjacent to main.js.
 */
function resolveDriverPath(): string {
  return path.join(__dirname, SCE_DRIVER_REL);
}

function startJob(payload: any): Job {
  const jobId = "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const payloadPath = path.join(os.tmpdir(), `sce-local-${jobId}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

  const driverPath = resolveDriverPath();
  const args = [
    driverPath,
    "--payload",
    payloadPath,
    "--pause-on-error",
  ];
  if (process.env["OCS_AUTH_STATE_PATH"]) {
    args.push("--auth-state", process.env["OCS_AUTH_STATE_PATH"]);
  }
  console.log(`[local-driver-server] starting job ${jobId}`);
  console.log(`  payload: ${payloadPath}`);
  console.log(`  driver:  ${driverPath}`);

  // Electron ships its own Node — process.execPath points at the
  // Electron binary, which runs as Node when given a script path
  // and the ELECTRON_RUN_AS_NODE env var.  This avoids depending on
  // a system Node install on the user's machine.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  };
  if (process.env["PLAYWRIGHT_BROWSERS_PATH_OVERRIDE"]) {
    childEnv["PLAYWRIGHT_BROWSERS_PATH"] = process.env["PLAYWRIGHT_BROWSERS_PATH_OVERRIDE"];
  }
  const child = spawn(process.execPath, args, {
    cwd: path.dirname(driverPath),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const job: Job = {
    id: jobId,
    child,
    events: [],
    status: "running",
    exitCode: null,
    stoppedBeforeSubmit: false,
    finalError: null,
    listeners: new Set(),
  };
  jobs.set(jobId, job);

  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    const s = chunk.toString("utf8");
    process.stdout.write(s);
    stderrBuf += s;
    let nl: number;
    while ((nl = stderrBuf.indexOf("\n")) >= 0) {
      const line = stderrBuf.slice(0, nl);
      stderrBuf = stderrBuf.slice(nl + 1);
      if (!line) continue;
      const event = parseDriverLine(line);
      job.events.push(event);
      if (event.kind === "stopped-before-submit") job.stoppedBeforeSubmit = true;
      broadcast(job, "event", event);
    }
  });
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));

  child.on("close", (code, signal) => {
    if (stderrBuf) {
      const event = parseDriverLine(stderrBuf);
      job.events.push(event);
      broadcast(job, "event", event);
    }
    job.exitCode = code ?? -1;
    if (code === 0 || job.stoppedBeforeSubmit) {
      job.status = "completed";
    } else {
      job.status = "failed";
      const tail = job.events
        .filter((e) => e.level === "err")
        .slice(-5)
        .map((e) => e.raw)
        .join("\n");
      job.finalError =
        `driver exited code ${code}${signal ? ` (signal ${signal})` : ""}` +
        (tail ? `\n--- last errors ---\n${tail}` : "");
    }
    console.log(`[local-driver-server] job ${jobId} done — status=${job.status}, code=${code}`);
    broadcast(job, "done", {
      status: job.status,
      exitCode: job.exitCode,
      stoppedBeforeSubmit: job.stoppedBeforeSubmit,
      finalError: job.finalError,
    });
    for (const res of job.listeners) res.end();
  });

  return job;
}

// ── HTTP routing ────────────────────────────────────────────────────────

const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|ocsolarprocess\.com|ocsolar-portal\.web\.app)(:\d+)?$/;
function applyCors(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && ALLOWED_ORIGIN_RE.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "null"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Boot the local driver server.  Called from the Electron main
 * process during `app.whenReady`.  Returns the actual port the
 * server is listening on.
 *
 * `playwrightBrowsersPath`: in a packaged build, Playwright's
 * Chromium binaries live in `app.asar.unpacked/...` (the asar fork
 * Playwright's `__dirname` resolver doesn't follow on its own).
 * Main passes the unpacked path here; we forward it into the driver
 * subprocess via PLAYWRIGHT_BROWSERS_PATH so `chromium.launch()`
 * finds the bundled browser without a system install.
 */
export function startLocalDriverServer(opts: {
  port?: number;
  appVersion?: string;
  playwrightBrowsersPath?: string;
  authStatePath?: string;
} = {}): Promise<number> {
  const port = opts.port ?? DEFAULT_PORT;
  const appVersion = opts.appVersion ?? "unknown";
  const playwrightBrowsersPath = opts.playwrightBrowsersPath;
  const authStatePath = opts.authStatePath;
  // Re-export through env so startJob() can read these without
  // re-threading the options object through.
  if (playwrightBrowsersPath) {
    process.env["PLAYWRIGHT_BROWSERS_PATH_OVERRIDE"] = playwrightBrowsersPath;
  }
  if (authStatePath) {
    process.env["OCS_AUTH_STATE_PATH"] = authStatePath;
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      applyCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url || "/", `http://localhost:${port}`);

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, version: appVersion, jobs: jobs.size }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/run") {
        try {
          const body = await readJsonBody(req);
          if (!body?.payload) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "payload required" }));
            return;
          }
          const job = startJob(body.payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jobId: job.id }));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err?.message || String(err) }));
        }
        return;
      }

      const eventsMatch = url.pathname.match(/^\/events\/([\w.-]+)$/);
      if (req.method === "GET" && eventsMatch) {
        const jobId = eventsMatch[1];
        const job = jobs.get(jobId);
        if (!job) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "job not found" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        for (const e of job.events) writeSse(res, "event", e);
        if (job.status !== "running") {
          writeSse(res, "done", {
            status: job.status,
            exitCode: job.exitCode,
            stoppedBeforeSubmit: job.stoppedBeforeSubmit,
            finalError: job.finalError,
          });
          res.end();
          return;
        }
        job.listeners.add(res);
        req.on("close", () => job.listeners.delete(res));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.on("error", (err) => {
      console.error(`[local-driver-server] failed to bind ${port}:`, err.message);
      reject(err);
    });
    server.listen(port, "127.0.0.1", () => {
      console.log(`[local-driver-server] listening on http://127.0.0.1:${port}`);
      resolve(port);
    });
  });
}
