// server/index.js
import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import helmet from "helmet";
import chromiumLib from "@sparticuz/chromium";
import multer from "multer";
import puppeteerCore from "puppeteer-core";
import puppeteerFull from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import crypto from "crypto";

dotenv.config();

const isRender = process.env.RENDER === "true";

// Use full puppeteer on local dev, puppeteer-core + chromium on Render
const chromium = isRender ? chromiumLib : null;
// Use puppeteer-extra with stealth plugin to improve compatibility with
// sites that try to block headless browsers. For Render use puppeteer-core,
// for local development use full puppeteer.
puppeteerExtra.use(StealthPlugin());
const puppeteer = isRender ? puppeteerCore : puppeteerFull;
const puppeteerDriver = puppeteerExtra;


const PORT = process.env.PORT || 3000;
const CLIQ_SECRET = process.env.CLIQ_SECRET || "testsecret";
const ENFORCE_ALLOWLIST = (process.env.ENFORCE_ALLOWLIST || "false") === "true";
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || "example.com")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

console.log("Starting server...");
const app = express();
console.log("Express app created");

app.use(helmet());
const multipart = multer();
console.log("Helmet added");

// Middleware to capture raw body for HMAC signature validation
app.use(bodyParser.json({
  limit: "300kb",
  verify: (req, res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));

// Also parse URL-encoded form data (for Zoho Cliq compatibility)
app.use(bodyParser.urlencoded({ 
  limit: "300kb",
  extended: true,
  verify: (req, res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));

// Handler for /analyze logic extracted so it can be invoked from the
// normal route and from the body-parse recovery path.
async function handleAnalyze(req, res) {
  try {
    console.log("📨 POST /analyze received");
    console.log("Content-Type:", req.headers["content-type"]);
    console.log("Body:", req.body);
    console.log("RawBody:", req.rawBody?.substring(0, 100));
    
    if (!validateSecret(req)) {
      return res.status(401).json({ error: "Invalid x-cliq-signature." });
    }

    // Handle both JSON body (req.body.url) and form data (req.body.url)
    let url = (req.body.url || "").trim();
    
    console.log("Extracted URL:", url);
    if (!url) return res.status(400).json({ error: "Missing URL." });

    let finalUrl = url.startsWith("http") ? url : `https://${url}`;
    if (!isAllowedUrl(finalUrl)) {
      return res.status(403).json({ error: "URL not allowed." });
    }

    // Queue the job for async processing
    const jobId = generateJobId();
    const secret = req.headers["x-cliq-signature"];
    queueJob(jobId, finalUrl, secret);

    // Respond immediately with job ID
    return res.json({
      ok: true,
      status: "queued",
      jobId,
      pollUrl: `/result/${jobId}`,
      message: "Job queued for processing. Check /result/{jobId} for status."
    });
  } catch (err) {
    console.error("Queue error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// Error handler for body parsing errors (invalid JSON / malformed bodies)
app.use(async (err, req, res, next) => {
  if (!err) return next();
  // body-parser sets err.type === 'entity.parse.failed' on JSON parse errors
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400 && 'body' in err)) {
    console.error('Body parse error:', err.message || err);
    console.error('Content-Type:', req.headers['content-type']);
    console.error('RawBody (first 300 chars):', (req.rawBody || '').substring(0, 300));

    // Special-case: if this was a POST to /analyze and the raw body looks like multipart
    // (starts with a boundary), try to recover by parsing the multipart body manually
    // and invoking the analyze handler. This handles clients that send multipart
    // payloads but incorrectly set Content-Type to application/json.
    try {
      if (req.method === 'POST' && req.path === '/analyze') {
        const raw = req.rawBody || '';
        if (raw.trim().startsWith('--')) {
          // Extract boundary token from the first line
          const m = raw.match(/^--([A-Za-z0-9-_]+)/);
          const boundary = m ? m[1] : null;
          if (boundary) {
            // Simple multipart parsing: split parts by boundary marker
            const parts = raw.split(new RegExp("--" + boundary + "(?:\\r\\n|\\n)"));
            const fields = {};
            for (const part of parts) {
              // Each part contains headers, blank line, then body
              const idx = part.indexOf('\r\n\r\n');
              const idxn = part.indexOf('\n\n');
              const splitIdx = idx !== -1 ? idx : idxn;
              if (splitIdx === -1) continue;
              const hdr = part.slice(0, splitIdx);
              const body = part.slice(splitIdx + (idx !== -1 ? 4 : 2)).trim();
              const nameMatch = hdr.match(/name="([^"]+)"/);
              if (nameMatch) {
                const name = nameMatch[1];
                fields[name] = body.replace(/\r?\n$/, '');
              }
            }

            if (fields.url) {
              // Attach parsed body and call analyze handler
              req.body = { url: fields.url };
              console.log('Recovered multipart body for /analyze, url=', fields.url);
              // Call analyze handler directly
              try {
                await handleAnalyze(req, res);
              } catch (hErr) {
                console.error('Recovered analyze handler error:', hErr);
                return res.status(500).json({ error: hErr.message || String(hErr) });
              }
              return; // response already sent by handler
            }
          }
        }
      }
    } catch (recoverErr) {
      console.error('Error while attempting to recover multipart body:', recoverErr);
    }

    return res.status(400).json({ error: 'Invalid request body' });
  }
  // Pass other errors along
  return next(err);
});

// ---------- SECURITY HELPERS ----------
function isAllowedUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!ENFORCE_ALLOWLIST) return true;
    return ALLOWED_DOMAINS.some(d => u.hostname.endsWith(d));
  } catch (e) {
    return false;
  }
}

function validateSecret(req) {
  const signature = (req.headers["x-cliq-signature"] || "").trim();
  
  // If no signature provided, allow the request (for Zoho Cliq compatibility)
  // In production, you should require proper signature validation
  if (!signature) {
    console.warn("⚠️  No x-cliq-signature header provided");
    return true; // Allow for now to support Zoho Cliq requests
  }
  // If STRICT_HMAC enabled, require rawBody to be present (exact bytes)
  const STRICT = (process.env.STRICT_HMAC || "false") === "true";

  // Ensure we have a string or buffer to compute HMAC over.
  // Some clients (multipart/form-data) may not populate `req.rawBody`.
  let data = req.rawBody;
  if (typeof data === "undefined") {
    if (STRICT) {
      // In strict mode, missing rawBody cannot be validated
      console.warn("STRICT_HMAC enabled but req.rawBody is undefined");
      return false;
    }
    // Try to reconstruct from parsed body if available
    if (req.body == null) {
      data = "";
    } else if (typeof req.body === "string") {
      data = req.body;
    } else {
      try {
        data = JSON.stringify(req.body);
      } catch (e) {
        data = "";
      }
    }
  }

  const secret = process.env.CLIQ_SECRET || CLIQ_SECRET || "";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(typeof data === "string" ? data : String(data))
    .digest("hex");

  return signature === expected;
}

// ---------- CSS HELPERS ----------
const CSS_WHITELIST = [
  "display", "position", "top", "left", "right", "bottom",
  "width", "height", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
  "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
  "font-size", "font-weight", "line-height", "color", "background-color",
  "border", "border-radius", "box-shadow", "text-align"
];

function styleObjectToCss(styleObj) {
  const lines = [];
  for (const prop of CSS_WHITELIST) {
    const val = styleObj[prop];
    if (val && val !== "auto" && val !== "0px" && val !== "normal") {
      lines.push(`${prop}: ${val};`);
    }
  }
  return lines.join("\n");
}

function sanitizeClassName(base, idx) {
  return `${base}-${idx}`.replace(/[^a-zA-Z0-9\-_]/g, "-");
}

// small helper for escaping JSON/html when embedding in previews
function escapeHtml(s){
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- HTML & CSS BUILDERS ----------
function buildCssForElement(className, computedStyles) {
  const cssBody = styleObjectToCss(computedStyles);
  if (!cssBody) return `/* no significant styles captured for .${className} */`;
  return `.${className} {\n${cssBody}\n}`;
}

function buildCleanHtml(node) {
  const tag = node.tagName.toLowerCase();
  const attrs = [];

  if (node.id) attrs.push(`id="${node.id}"`);
  if (node.name) attrs.push(`name="${node.name}"`);
  if (node.type && (tag === "input" || tag === "button")) attrs.push(`type="${node.type}"`);
  if (node.placeholder) attrs.push(`placeholder="${node.placeholder}"`);
  if (node.src) attrs.push(`src="${node.src}"`);
  if (node.href) attrs.push(`href="${node.href}"`);
  if (node.alt) attrs.push(`alt="${node.alt}"`);
  if (node["aria-label"]) attrs.push(`aria-label="${node["aria-label"]}"`);

  const attrStr = attrs.join(" ");
  const text = (node.innerText || node.value || "").trim();

  if (["input", "img"].includes(tag)) {
    return `<${tag} ${attrStr} />`.replace(/\s+/g, " ").trim();
  }

  return `<${tag} ${attrStr}>${text}</${tag}>`.replace(
    /\s+/g,
    " "
  );
}

function buildComponentResult(elDesc, idx) {
  const kind = elDesc.tagName.toLowerCase();
  const base = `gen-${kind}`;
  const className = sanitizeClassName(base, idx + 1);

  const cleanedHtml = buildCleanHtml(elDesc);
  const css = buildCssForElement(className, elDesc.computedStyles);

  // inject class into opening tag
  const htmlSnippet = cleanedHtml.replace(
    /^<([a-z0-9-]+)/,
    `<$1 class="${className}"`
  );

  const reactSnippet = `
import React from "react";
import "./styles.css";

export function ${className.replace(/-/g, "_")}() {
  return (
    ${htmlSnippet}
  );
}
`;

  return {
    index: idx + 1,
    kind,
    cleanedHtml,
    htmlSnippet,
    className,
    css,
        reactSnippet,
        originalOuterHTML:
          elDesc.outerHTML?.slice(0, 200) +
          (elDesc.outerHTML?.length > 200 ? "..." : "")
      };
    }

    // ---------- PAGE EXTRACTION ----------

async function extractElementsFromUrl(url) {
  let browser;

  if (isRender) {
    // RENDER (Linux server)
    const executablePath = await chromium.executablePath();

    browser = await puppeteerDriver.launch({
      puppeteer: puppeteerCore,
      args: (chromium.args || []).concat(["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]),
      executablePath,
      headless: chromium.headless,
    });

  } else {
    // LOCAL WINDOWS DEVELOPMENT
    browser = await puppeteerDriver.launch({
      puppeteer: puppeteerFull,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: { width: 1280, height: 800 },
    });
  }

  const page = await browser.newPage();
  // Improve compatibility with sites that block headless browsers by
  // using a common desktop user-agent and standard headers. Increase
  // navigation timeout to allow slower pages to load.
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  } catch (navErr) {
    console.warn("Navigation warning/failed for", url, "->", navErr.message || navErr);
    // Attempt a second try with a more permissive waitUntil to recover
    try {
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
    } catch (err) {
      await browser.close();
      throw new Error(`Failed to load page: ${err.message || String(err)}`);
    }
  }

  const raw = await page.evaluate(() => {
    const allowed = ["button", "input", "label", "a", "select", "textarea"];
    const list = [];

    document.querySelectorAll("*").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (!allowed.includes(tag)) return;

      const computedStyles = getComputedStyle(el);
      const styleObj = {};
      const props = [
        "display", "position", "top", "left", "right", "bottom",
        "width", "height", "margin", "padding",
        "font-size", "font-weight", "line-height", "color",
        "background-color", "border", "border-radius", "box-shadow", "text-align"
      ];
      props.forEach(prop => {
        const val = computedStyles.getPropertyValue(prop);
        if (val && val !== "auto" && val !== "normal") {
          styleObj[prop] = val;
        }
      });

      list.push({
        tagName: tag.toUpperCase(),
        outerHTML: el.outerHTML,
        className: el.className,
        innerText: el.innerText ?? "",
        computedStyles: styleObj,
        id: el.id || "",
        name: el.name || "",
        href: el.href || null,
        src: el.src || null,
        placeholder: el.placeholder || null,
        type: el.type || null,
        alt: el.alt || null,
      });
    });

    return list;
  });

  await browser.close();
  return raw;
}

// ---------- JOB QUEUE SYSTEM ----------
const jobStore = new Map(); // Store job results: jobId -> { status, data, error, createdAt }
const jobQueue = []; // Queue of pending jobs
let isProcessing = false;

function generateJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

function queueJob(jobId, url, secret) {
  jobStore.set(jobId, {
    status: "queued",
    url,
    data: null,
    error: null,
    createdAt: new Date(),
    secret
  });
  jobQueue.push(jobId);
  processQueue(); // Start processing
}

function getJobResult(jobId) {
  return jobStore.get(jobId) || null;
}

async function processQueue() {
  if (isProcessing || jobQueue.length === 0) return;
  isProcessing = true;

  try {
    while (jobQueue.length > 0) {
      const jobId = jobQueue.shift();
      const job = jobStore.get(jobId);

      if (!job) continue;

      // Update status
      job.status = "processing";
      job.startedAt = new Date();

      try {
        // Validate job
        if (!job.url) throw new Error("Missing URL");
        if (!isAllowedUrl(job.url)) throw new Error("URL not allowed");

        // Extract components
        const raw = await extractElementsFromUrl(job.url);
        const components = raw.map((el, idx) => buildComponentResult(el, idx));

        const cssFile = components.map(c => c.css).join("\n\n");
        const reactFile = components.map(c => c.reactSnippet).join("\n\n");

        job.data = {
          url: job.url,
          componentCount: components.length,
          components,
          cssFile,
          reactFile,
          completedAt: new Date()
        };
        job.status = "done";
      } catch (err) {
        job.status = "failed";
        job.error = err.message;
        console.error(`Job ${jobId} failed:`, err);
      }

      job.finishedAt = new Date();
    }
  } finally {
    isProcessing = false;
  }
}

// Clean up old jobs (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [jobId, job] of jobStore.entries()) {
    if (job.createdAt.getTime() < oneHourAgo) {
      jobStore.delete(jobId);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

    // ---------- API ----------
    // Use the shared handler so recovery code can call the same logic
    app.post("/analyze", multipart.none(), handleAnalyze);

    // Get job result by ID
    app.get("/result/:jobId", (req, res) => {
      try {
        const jobId = req.params.jobId;
        const job = getJobResult(jobId);

        // Allow polling with the same signature that queued the job.
        const signature = (req.headers["x-cliq-signature"] || "").trim();
        if (signature && job && job.secret && signature === job.secret) {
          // signature matches stored job secret: allow
        } else {
          if (!validateSecret(req)) {
            return res.status(401).json({ error: "Invalid x-cliq-signature." });
          }
        }

        if (!job) {
          return res.status(404).json({
            ok: false,
            error: "Job not found. Job IDs are stored for 1 hour."
          });
        }

        if (job.status === "processing" || job.status === "queued") {
          return res.json({
            ok: true,
            jobId,
            status: job.status,
            queuePosition: jobQueue.indexOf(jobId) + 1,
            message: `Your job is ${job.status}. Check back soon.`
          });
        }

        if (job.status === "failed") {
          return res.status(400).json({
            ok: false,
            jobId,
            status: "failed",
            error: job.error
          });
        }

        // Status === "done"
        return res.json({
          ok: true,
          jobId,
          status: "done",
          summary: job.data
        });
      } catch (err) {
        console.error("Result fetch error:", err);
        return res.status(500).json({ error: err.message });
      }
    });

    // Simple one-request preview endpoint — returns a single HTML document
    app.get("/preview", async (req, res) => {
      try {
        if (!validateSecret(req)) {
          return res.status(401).send("Unauthorized - missing x-cliq-signature");
        }

        const url = (req.query.url || "").toString().trim();
        if (!url) return res.status(400).send("Missing url query parameter.");

        let finalUrl = url.startsWith("http") ? url : `https://${url}`;
        if (!isAllowedUrl(finalUrl)) return res.status(403).send("URL not allowed.");

        const raw = await extractElementsFromUrl(finalUrl);
        const components = raw.map((el, idx) => buildComponentResult(el, idx));

        const css = components.map(c => c.css).join("\n\n") || "";
        const parts = components.map(c => {
          return `
    <div class="preview-item">
      <h4>Component ${c.index} — ${c.kind}</h4>
      <div class="render">${c.htmlSnippet}</div>
      <pre style="display:none">${escapeHtml(JSON.stringify(c))}</pre>
    </div>`;
        }).join("\n");

        const html = `<!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Preview — ${escapeHtml(finalUrl)}</title>
      <style>
        body{font-family:system-ui,Segoe UI,Arial;padding:18px}
        .preview-item{border:1px solid #eee;padding:12px;margin:12px 0}
        .preview-item .render{margin-top:8px}
        ${css}
      </style>
    </head>
    <body>
      <h2>Preview — ${escapeHtml(finalUrl)}</h2>
      ${parts}
    </body>
    </html>`;

        res.set("Content-Type", "text/html; charset=utf-8").send(html);
      } catch (err) {
        console.error("Preview error:", err);
        return res.status(500).send("Preview failed: " + (err.message || String(err)));
      }
    });

    app.get("/health", (_req, res) => res.json({ ok: true }));

    const server = app.listen(PORT, () => {
      console.log("UI Component Rebuilder running on port", PORT);
    });

    server.on("error", (err) => {
      console.error("Server error:", err);
      process.exit(1);
    });

    process.on("uncaughtException", (err) => {
      console.error("Uncaught exception:", err);
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled rejection at:", promise, "reason:", reason);
      process.exit(1);
    });
