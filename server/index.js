// server/index.js
import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import helmet from "helmet";
import { chromium } from "playwright";

dotenv.config();

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
      const browser = await chromium.launch({ headless: true });

      // FIXED USER AGENT → Use browser context
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
      });

      const page = await context.newPage();

      try {
        await page.goto(url, { waitUntil: "load", timeout: 20000 });
      } catch {}

      // scroll to load lazy elements
      await page.evaluate(async () => {
        await new Promise(res => {
          let total = 0;
          const step = 300;
          const interval = setInterval(() => {
            window.scrollBy(0, step);
            total += step;
            if (total >= document.body.scrollHeight) {
              clearInterval(interval);
              setTimeout(res, 300);
            }
          }, 100);
        });
      });

      const elements = await page.evaluate(() => {
        const selectors = ["button", "input", "label", "a", "img", "select", "textarea"];

        function isVisible(el) {
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            cs.display !== "none" &&
            cs.visibility !== "hidden" &&
            cs.opacity !== "0"
          );
        }

        function getStyles(el) {
          const cs = getComputedStyle(el);
          const map = {};
          [
            "display", "position", "top", "left", "right", "bottom",
            "width", "height", "margin", "margin-top", "margin-bottom",
            "margin-left", "margin-right", "padding", "padding-top",
            "padding-bottom", "padding-left", "padding-right",
            "font-size", "font-weight", "line-height", "color",
            "background-color", "border", "border-radius", "box-shadow", "text-align"
          ].forEach(prop => {
            const val = cs.getPropertyValue(prop);
            if (val && val !== "auto" && val !== "0px" && val !== "normal") {
              map[prop] = val;
            }
          });
          return map;
        }

        const found = [];

        selectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            if (!isVisible(el)) return;

            found.push({
              tagName: el.tagName,
              outerHTML: el.outerHTML,
              innerText: el.innerText || "",
              id: el.id || null,
              name: el.name || null,
              type: el.type || null,
              placeholder: el.placeholder || null,
              src: el.src || null,
              href: el.href || null,
              alt: el.alt || null,
              "aria-label": el.getAttribute("aria-label"),
              computedStyles: getStyles(el)
            });
          });
        });

        // Deduplicate by outerHTML signature
        const seen = new Set();
        const unique = [];
        for (const el of found) {
          const sig = el.outerHTML.slice(0, 200);
          if (!seen.has(sig)) {
            seen.add(sig);
            unique.push(el);
          }
        }

        return unique.slice(0, 80);
      });

      await browser.close();
      return elements;
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
