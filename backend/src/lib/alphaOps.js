// Alpha818 AI Ops — ships WARN/ERROR console output and crashes to the
// operations center so the AI team can see what went wrong, not only that
// the site is down. Fails silently: it must never affect the app itself.
// Enabled only when ALPHA_OPS_URL, ALPHA_OPS_KEY and ALPHA_OPS_PROJECT are set.
const util = require('util');
const os = require('os');

const BASE = (process.env.ALPHA_OPS_URL || '').replace(/\/+$/, '');
const ENDPOINT = BASE ? `${BASE}/api/ingest/logs` : null;
const KEY = process.env.ALPHA_OPS_KEY;
const PROJECT = process.env.ALPHA_OPS_PROJECT;
const SERVICE = process.env.ALPHA_OPS_SERVICE || (PROJECT ? `${PROJECT}-api` : 'app');

let queue = [];
let timer = null;
let inFlight = false;
let installed = false;

function enabled() {
  return Boolean(ENDPOINT && KEY && PROJECT && typeof fetch === 'function');
}

function entry(level, args) {
  const err = args.find((a) => a instanceof Error);
  return {
    timestamp: new Date().toISOString(),
    projectId: PROJECT,
    service: SERVICE,
    environment: 'PRODUCTION',
    level,
    message: util.format(...args).slice(0, 4000),
    stackTrace: err && err.stack ? String(err.stack).slice(0, 8000) : undefined,
    metadata: { pid: process.pid, host: os.hostname() },
  };
}

function schedule() {
  if (timer) return;
  timer = setTimeout(flush, 3000);
  if (timer.unref) timer.unref();
}

async function flush() {
  timer = null;
  if (inFlight || !queue.length) return;
  const batch = queue.splice(0, 100);
  inFlight = true;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-key': KEY },
      body: JSON.stringify(batch),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch {
    // dropped on purpose — the ops center being unreachable is never the app's problem
  } finally {
    inFlight = false;
    if (queue.length) schedule();
  }
}

function push(e) {
  if (queue.length >= 200) queue.shift();
  queue.push(e);
  schedule();
}

/** Report something explicitly (level: WARN | ERROR | FATAL). */
function report(level, message, metadata) {
  if (!enabled()) return;
  try {
    push({ ...entry(level, [message]), metadata: { ...metadata, pid: process.pid, host: os.hostname() } });
  } catch {
    /* ignore */
  }
}

/** Patch console.error / console.warn and watch for crashes. Returns true when active. */
function installAlphaOps() {
  if (installed) return true;
  if (!enabled()) return false;
  installed = true;
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args) => {
    origError(...args);
    try {
      push(entry('ERROR', args));
    } catch {
      /* ignore */
    }
  };
  console.warn = (...args) => {
    origWarn(...args);
    try {
      push(entry('WARN', args));
    } catch {
      /* ignore */
    }
  };
  // Observes crashes without changing crash behaviour.
  process.on('uncaughtExceptionMonitor', (err) => {
    try {
      push(entry('FATAL', [err]));
    } catch {
      /* ignore */
    }
  });
  origWarn(`[alpha-ops] log shipping enabled → ${BASE} (${PROJECT}/${SERVICE})`);
  return true;
}

module.exports = { installAlphaOps, report };
