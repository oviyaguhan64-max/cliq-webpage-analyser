// server/index.js
import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import helmet from "helmet";
import chromiumLib from "@sparticuz/chromium";
import puppeteerCore from "puppeteer-core";
import puppeteerFull from "puppeteer";

dotenv.config();

const isRender = process.env.RENDER === "true";

// Use full puppeteer on local dev, puppeteer-core + chromium on Render
const chromium = isRender ? chromiumLib : null;
const puppeteer = isRender ? puppeteerCore : puppeteerFull;


const PORT = process.env.PORT || 3000;
const CLIQ_SECRET = process.env.CLIQ_SECRET || "testsecret";
const ENFORCE_ALLOWLIST = (process.env.ENFORCE_ALLOWLIST || "false") === "true";
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || "example.com")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const app = express();
app.use(helmet());
app.use(bodyParser.json({ limit: "300kb" }));

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
  const token = (req.headers["x-cliq-signature"] || "").trim();
  return token === CLIQ_SECRET;
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

    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: chromium.headless,
    });

  } else {
    // LOCAL WINDOWS DEVELOPMENT
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { width: 1280, height: 800 },
    });
  }

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });

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


    // ---------- API ----------
    app.post("/analyze", async (req, res) => {
      try {
        if (!validateSecret(req)) {
          return res.status(401).json({ error: "Invalid x-cliq-signature." });
        }

        const url = (req.body.url || "").trim();
        if (!url) return res.status(400).json({ error: "Missing URL." });

        let finalUrl = url.startsWith("http") ? url : `https://${url}`;
        if (!isAllowedUrl(finalUrl)) {
          return res.status(403).json({ error: "URL not allowed." });
        }

        const raw = await extractElementsFromUrl(finalUrl);

        const components = raw.map((el, idx) => buildComponentResult(el, idx));

        const cssFile = components.map(c => c.css).join("\n\n");
        const reactFile = components.map(c => c.reactSnippet).join("\n\n");

        const summary = {
          url: finalUrl,
          componentCount: components.length,
          components,
          cssFile,
          reactFile
        };

        return res.json({ ok: true, summary });
      } catch (err) {
        console.error("Analyze error:", err);
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

    app.listen(PORT, () => {
      console.log("UI Component Rebuilder running on port", PORT);
    });
