#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import axios from "axios";

const OUT_DIR = path.resolve(process.cwd(), "extracted-ui");
const SERVER = process.env.CLIQ_SERVER || "http://localhost:3000";
const SECRET = process.env.CLIQ_SECRET || "testsecret";

function usage() {
  console.log("Usage: node extract-and-test.js <url>");
}

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {}
}

async function writeFileSafe(filePath, contents) {
  await fs.writeFile(filePath, contents, "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), filePath)}`);
}

async function run() {
  const url = process.argv[2];
  if (!url) {
    usage();
    process.exit(1);
  }

  console.log(`Requesting analysis for: ${url}`);

  let resp;
  try {
    resp = await axios.post(
      `${SERVER}/analyze`,
      { url },
      { headers: { "x-cliq-signature": SECRET }, timeout: 120000 }
    );
  } catch (err) {
    if (err.response) {
      console.error("Server responded with status", err.response.status, err.response.data);
    } else {
      console.error("Request failed:", err.message);
    }
    process.exit(2);
  }

  if (!resp?.data?.ok) {
    console.error("Analysis failed:", resp?.data || resp?.statusText || "unknown");
    process.exit(3);
  }

  const summary = resp.data.summary;

  await ensureDir(OUT_DIR);

  // components.json
  await writeFileSafe(path.join(OUT_DIR, "components.json"), JSON.stringify(summary, null, 2));

  // styles.css
  const css = summary.cssFile || "/* no styles captured */";
  await writeFileSafe(path.join(OUT_DIR, "styles.css"), css);

  // Components.jsx
  const reactParts = summary.components?.map(c => c.reactSnippet).join("\n\n") || "";
  const reactFile = `// Auto-generated Components.jsx\n\n${reactParts}`;
  await writeFileSafe(path.join(OUT_DIR, "Components.jsx"), reactFile);

  // preview.html — simple inline preview
  const previewParts = (summary.components || []).map(c => {
    return `
<div class="preview-item">
  <h4>Component ${c.index} — ${c.kind}</h4>
  <div class="render">${c.htmlSnippet}</div>
  <pre class="meta">${escapeHtml(JSON.stringify(c, null, 2))}</pre>
</div>`;
  }).join("\n");

  const previewHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Extraction Preview</title>
  <link rel="stylesheet" href="./styles.css">
  <style>
    body{font-family:system-ui,Segoe UI,Arial; padding:18px}
    .preview-item{border:1px solid #eee;padding:12px;margin:12px 0}
    .preview-item .render{margin-top:8px}
    .preview-item pre{background:#f7f7f7;padding:8px;overflow:auto}
  </style>
</head>
<body>
  <h2>Extraction Preview — ${escapeHtml(summary.url)}</h2>
  <div id="content">
    ${previewParts}
  </div>
  <footer><small>${summary.componentCount} components</small></footer>
</body>
</html>`;

  await writeFileSafe(path.join(OUT_DIR, "preview.html"), previewHtml);

  console.log("Preview generated at ./extracted-ui/preview.html — open in your browser to inspect.");
}

function escapeHtml(s){
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

run().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(10);
});
