# CLIQ Webpage Analyser - UI Component Extractor

## 🎯 Project Overview

A powerful **server-based UI component extraction tool** that automatically analyzes webpages and extracts interactive components (buttons, inputs, links, images, etc.) with their computed CSS styles. The extracted components are bundled into **React-ready JSX code**, **clean CSS**, and an **HTML preview** for immediate visualization.

This tool is ideal for:
- Rapid UI prototyping from existing web designs
- Automated component library generation
- Web design analysis and replication
- CSS style capture and organization

## 🌟 Key Features

### 1. **Server-Based Architecture**
- RESTful Express.js API with authentication
- Built-in security validations (SSRF protection, secret-based auth)
- Health check endpoint for monitoring
- CORS-ready with Helmet security headers

### 2. **Intelligent Component Extraction**
- **Automated browser automation** using Playwright Chromium
- **DOM traversal** targeting interactive elements (buttons, inputs, links, images, selects, textareas)
- **Auto-scrolling** to trigger lazy-loaded content
- **Computed style capture** with CSS whitelisting (17 safe properties)
- **Duplicate deduplication** based on element signatures
- **Maximum 80 components** per page for optimal performance

### 3. **Multi-Format Output**
- **components.json** - Structured JSON with full component metadata
- **styles.css** - Consolidated CSS rules for all extracted components
- **Components.jsx** - Ready-to-use React JSX code with component snippets
- **preview.html** - Self-contained HTML preview with inline styles

### 4. **Production-Ready Code**
- HTML escaping and sanitization
- CSS property whitelisting (prevents injection)
- Error handling and detailed logging
- Environment-based configuration
- Request timeouts and rate limiting ready

## 📋 Requirements

- **Node.js**: v16+ (tested on v24.11.1)
- **pnpm**: v9+ (package manager)
- **Operating System**: Windows, macOS, Linux
- **Disk Space**: ~500MB for Playwright Chromium browser

## 🚀 Quick Start

### 1. Installation

```bash
# Clone or extract the project
cd cliq-webpage-analyser

# Install dependencies with pnpm
pnpm install --shamefully-hoist

# Install Playwright Chromium browser
pnpm dlx playwright install chromium
```

### 2. Configuration

Create a `.env` file (or copy from `.env.example`):

```env
PORT=3000
CLIQ_SECRET=your-secret-key-here
ENFORCE_ALLOWLIST=false
ALLOWED_DOMAINS=example.com,notion.com
```

**Environment Variables:**
- `PORT` - Server port (default: 3000)
- `CLIQ_SECRET` - Secret token for API authentication (default: "testsecret")
- `ENFORCE_ALLOWLIST` - Enable domain allowlist (default: false)
- `ALLOWED_DOMAINS` - Comma-separated list of allowed domains

### 3. Start the Server

```bash
# Production mode
pnpm run start

# Development mode (auto-reload on file changes)
pnpm run dev
```

Server will start on `http://localhost:3000`

## 📡 API Endpoints

### Health Check
```bash
GET /health
```
Returns server status:
```json
{"ok": true}
```

### Analyze Webpage
```bash
POST /analyze
Content-Type: application/json
x-cliq-signature: your-secret-key

{
  "url": "https://example.com"
}
```

**Response:**
```json
{
  "url": "https://example.com",
  "componentCount": 12,
  "components": [
    {
      "type": "button",
      "className": "btn-primary",
      "html": "<button class=\"btn-primary\">Click Me</button>",
      "css": "display: inline-block; padding: 10px 20px; ...",
      "reactSnippet": "const Button = () => (<button className=\"btn-primary\">Click Me</button>);"
    }
    // ... more components
  ],
  "cssFile": "/* All CSS rules consolidated */",
  "reactFile": "/* All React components combined */"
}
```

### Preview Webpage
```bash
GET /preview?url=https://example.com
x-cliq-signature: your-secret-key
```

Returns a single HTML file with all extracted components rendered and styled.

## 🛠️ Usage Examples

### Method 1: Using the CLI Helper (Recommended)

```bash
# Extract components from a website and generate files
pnpm run extract -- https://example.com

# Output files are written to extracted-ui/
# - components.json (full metadata)
# - styles.css (CSS rules)
# - Components.jsx (React code)
# - preview.html (visual preview)
```

### Method 2: Using cURL

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "x-cliq-signature: testsecret" \
  -d '{"url":"https://example.com"}'
```

### Method 3: Using the Test Script

```bash
# Simple API test
node test-api.mjs
```

### Method 4: Using PowerShell

```powershell
$headers = @{
  "x-cliq-signature" = "testsecret"
  "Content-Type" = "application/json"
}

$body = @{
  url = "https://example.com"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/analyze" `
  -Method Post `
  -Headers $headers `
  -Body $body
```

## 📁 Project Structure

```
cliq-webpage-analyser/
├── server/
│   └── index.js                    # Main Express server
├── extract-and-test.js             # CLI helper for extraction
├── test-api.mjs                    # Simple API test
├── .env                            # Environment config (create from .env.example)
├── .env.example                    # Environment template
├── .gitignore                      # Git ignore patterns
├── package.json                    # Dependencies and scripts
├── pnpm-lock.yaml                  # Locked dependency versions
├── extracted-ui/                   # Output directory for extraction results
│   ├── components.json
│   ├── styles.css
│   ├── Components.jsx
│   └── preview.html
└── README.md                       # This file
```

## 🔧 Technical Details

### Extracted Component Structure

Each component in the JSON output includes:

```json
{
  "type": "button|input|link|image|select|textarea",
  "index": 0,
  "className": "sanitized-class-name",
  "cleanedHtml": "<button>Raw HTML</button>",
  "htmlSnippet": "<button class=\"sanitized\">Raw HTML</button>",
  "css": "display: block; color: #000; ...",
  "reactSnippet": "const Component = () => (<button>...</button>);"
}
```

### Supported CSS Properties

Whitelist of 17 safe CSS properties captured:
- Layout: `display`, `position`, `top`, `left`, `right`, `bottom`, `width`, `height`
- Spacing: `margin`, `margin-*`, `padding`, `padding-*`
- Typography: `font-size`, `font-weight`, `line-height`, `color`, `text-align`
- Decoration: `background-color`, `border`, `border-radius`, `box-shadow`

### Security Features

- ✅ **Secret-based authentication** (x-cliq-signature header)
- ✅ **SSRF protection** with optional domain allowlist
- ✅ **CSS property whitelisting** (prevents injection)
- ✅ **HTML escaping** (prevents XSS)
- ✅ **Helmet security headers**
- ✅ **Request size limits** (300KB max)

## 🐛 Troubleshooting

### Server won't start
```bash
# Check if port 3000 is already in use
netstat -ano | findstr :3000  # Windows
lsof -i :3000                  # macOS/Linux

# Try a different port
PORT=3001 pnpm run start
```

### Extraction fails
```bash
# Ensure Chromium is installed
pnpm dlx playwright install chromium

# Check .env configuration
cat .env

# Enable debug logging (add to server/index.js)
console.log("Attempting to extract from:", url);
```

### Components not appearing
- Some websites block Chromium/headless browsers
- Try adding a custom User-Agent in `extractElementsFromUrl()`
- Check browser console for CORS or security warnings
- Verify the website doesn't use shadow DOM extensively

## 📊 Performance Notes

- Typical extraction: 2-5 seconds per page
- Chromium startup: ~1-2 seconds (first request)
- Maximum components: 80 per page (tunable)
- Timeout: 30 seconds per request

## 🤝 Contributing & Testing

Run the full test suite:

```bash
# Terminal 1: Start server
pnpm run start

# Terminal 2: Test extraction
pnpm run extract -- https://www.notion.com/desktop

# Terminal 3: Test API directly
node test-api.mjs

# Or use cURL
curl http://localhost:3000/health
```

## 📄 License

This project is submitted for the **Zoho Cliqtrix Contest**.

---

## 🎓 About This Project

Built with modern web technologies:
- **Express.js** - Lightweight, fast Node.js framework
- **Playwright** - Reliable cross-browser automation
- **ES Modules** - Modern JavaScript standards
- **pnpm** - Fast, efficient package management

Perfect for automating UI component discovery, design system generation, and rapid prototyping workflows.

**Created for**: Zoho Cliqtrix Contest  
**Status**: Production-Ready
