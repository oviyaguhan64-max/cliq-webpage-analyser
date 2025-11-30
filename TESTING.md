# Testing Guide

Complete end-to-end testing for the CLIQ Webpage Analyser with HMAC signature validation.

## Quick Start

### 1. Start the Server

```bash
pnpm run start
```

Server runs on `http://localhost:3000`

### 2. Run Tests

**Option A: Node.js (Cross-platform)**
```bash
pnpm test                    # Full E2E test suite with HMAC
pnpm test:async              # Async queue polling test
```

**Option B: Bash/Linux/macOS (with openssl)**
```bash
bash test-e2e.sh
```

**Option C: Manual cURL Testing**
```bash
# See examples below
```

---

## Test Scripts

### `test-e2e.mjs` (Node.js)

Comprehensive end-to-end test suite that:
- ✅ Tests health endpoint
- ✅ Validates HMAC signature rejection
- ✅ Queues extraction job with valid HMAC
- ✅ Polls for results with exponential backoff
- ✅ Displays extraction statistics

**Run:**
```bash
pnpm test
# or
node test-e2e.mjs
```

**Output:**
```
═══════════════════════════════════════════════════════════════
🧪 END-TO-END TEST SUITE
═══════════════════════════════════════════════════════════════
API URL: http://localhost:3000
Secret: 1001.3ea9d992cfa4a3...

🏥 Testing /health endpoint
✅ Health check passed: { ok: true }

🔒 Testing Invalid Signature Rejection
📤 Attempting request with invalid signature...
✅ Correctly rejected invalid signature
   Response: Invalid x-cliq-signature.

🔄 Testing Async Job Queue with HMAC Signature
📝 Request body: {"url":"https://www.zoho.com/cliq/login.html"}
🔐 HMAC SHA256: a1b2c3d4e5f6...

📤 1. Queuing job for https://www.zoho.com/cliq/login.html...
✅ Job queued with ID: job-1701345600000-abc123def
📋 Full response: { ok: true, status: 'queued', jobId: '...', ... }

⏳ 2. Polling for results with exponential backoff...
📋 Poll #1: Status = QUEUED
   └─ Queue position: 1
⚙️ Poll #2: Status = PROCESSING
⚙️ Poll #3: Status = PROCESSING
✨ Poll #4: Status = DONE

✨ JOB COMPLETE!

📊 Extraction Summary:
   URL: https://www.zoho.com/cliq/login.html
   Components: 24
   Completed: 2024-11-30T12:34:56.789Z

📄 First Component:
   Type: a
   Class: gen-a-1
   HTML: <a href="https://www.zoho.com/">ZOHO</a>
   CSS lines: 15

📦 Output Files:
   ✓ components.json (24 items)
   ✓ styles.css (120 lines)
   ✓ Components.jsx (240 lines)

═══════════════════════════════════════════════════════════════
📊 TEST SUMMARY
═══════════════════════════════════════════════════════════════
✅ Health Check
✅ Invalid Signature Rejection
✅ Async Job Queue (Full Extraction)

3/3 tests passed 🎉
```

### `test-e2e.sh` (Bash)

Linux/macOS shell script using openssl and curl:

**Run:**
```bash
bash test-e2e.sh

# Or with custom API URL
API_URL=http://render-instance.onrender.com bash test-e2e.sh
```

**Features:**
- Uses `openssl dgst -sha256` for HMAC generation
- Automatic signature calculation
- Exponential backoff polling
- JSON parsing with `jq` (optional)

---

## Manual Testing with cURL

### 1. Health Check
```bash
curl http://localhost:3000/health
```

**Response:**
```json
{"ok": true}
```

### 2. Queue Job with HMAC Signature

**Generate Signature:**
```bash
BODY='{"url":"https://example.com"}'
CLIQ_SECRET="1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5"
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$CLIQ_SECRET" | sed 's/^.* //')
echo "Signature: $SIGNATURE"
```

**Queue the Job:**
```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "x-cliq-signature: $SIGNATURE" \
  -d "$BODY"
```

**Response:**
```json
{
  "ok": true,
  "status": "queued",
  "jobId": "job-1701345600000-abc123def",
  "pollUrl": "/result/job-1701345600000-abc123def",
  "message": "Job queued for processing. Check /result/{jobId} for status."
}
```

### 3. Poll Job Status

```bash
SIGNATURE="..." # Use the same signature
curl http://localhost:3000/result/job-1701345600000-abc123def \
  -H "x-cliq-signature: $SIGNATURE"
```

**Response (Queued):**
```json
{
  "ok": true,
  "jobId": "job-1701345600000-abc123def",
  "status": "queued",
  "queuePosition": 1,
  "message": "Your job is queued. Check back soon."
}
```

**Response (Processing):**
```json
{
  "ok": true,
  "jobId": "job-1701345600000-abc123def",
  "status": "processing",
  "message": "Your job is processing. Check back soon."
}
```

**Response (Complete):**
```json
{
  "ok": true,
  "jobId": "job-1701345600000-abc123def",
  "status": "done",
  "summary": {
    "url": "https://example.com",
    "componentCount": 15,
    "components": [
      {
        "index": 1,
        "kind": "button",
        "cleanedHtml": "<button>Click</button>",
        "className": "gen-button-1",
        "css": ".gen-button-1 { display: block; ... }",
        "reactSnippet": "..."
      }
    ],
    "cssFile": "...",
    "reactFile": "...",
    "completedAt": "2024-11-30T12:34:56.789Z"
  }
}
```

### 4. Test Invalid Signature (Should Fail)

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "x-cliq-signature: invalid_signature_123456" \
  -d '{"url":"https://example.com"}'
```

**Response (401 Unauthorized):**
```json
{
  "error": "Invalid x-cliq-signature."
}
```

---

## PowerShell Examples

### Full Async Workflow in PowerShell

```powershell
$API_URL = "http://localhost:3000"
$CLIQ_SECRET = "1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5"

# 1. Generate HMAC signature
$body = @{url = "https://www.zoho.com/cliq/login.html"} | ConvertTo-Json
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$keyBytes = [System.Text.Encoding]::UTF8.GetBytes($CLIQ_SECRET)
$hmac = New-Object System.Security.Cryptography.HMACSHA256($keyBytes)
$signature = $hmac.ComputeHash($bodyBytes) | ForEach-Object { $_.ToString("x2") } | Join-String

Write-Host "Generated Signature: $signature"

# 2. Queue the job
$response = Invoke-RestMethod -Uri "$API_URL/analyze" `
  -Method Post `
  -Headers @{"x-cliq-signature" = $signature} `
  -Body $body `
  -ContentType "application/json"

$jobId = $response.jobId
Write-Host "Job queued: $jobId"

# 3. Poll for results with exponential backoff
$delay = 1000
$maxPolls = 60
$pollCount = 0

do {
  $pollCount++
  Start-Sleep -Milliseconds $delay
  
  $result = Invoke-RestMethod -Uri "$API_URL/result/$jobId" `
    -Headers @{"x-cliq-signature" = $signature}
  
  Write-Host "Poll #$pollCount - Status: $($result.status)"
  
  if ($result.status -eq "done") {
    Write-Host "✅ Complete! Components: $($result.summary.componentCount)"
    break
  } elseif ($result.status -eq "failed") {
    Write-Host "❌ Failed: $($result.error)"
    break
  }
  
  # Exponential backoff
  $delay = [Math]::Min($delay * 1.2, 5000)
} while ($pollCount -lt $maxPolls)
```

---

## Environment Variables

Override defaults with environment variables:

```bash
# Node.js tests
API_URL=http://custom.url CLIQ_SECRET=your-secret pnpm test

# Bash script
API_URL=http://custom.url CLIQ_SECRET=your-secret bash test-e2e.sh
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: 'pnpm'
      
      - run: pnpm install --shamefully-hoist
      - run: pnpm exec puppeteer browsers install chrome
      
      - run: pnpm run start &
      - run: sleep 3
      - run: pnpm test
```

### Render Deployment

```yaml
# render.yaml
services:
  - type: web
    name: cliq-analyzer
    buildCommand: pnpm install --shamefully-hoist && pnpm exec puppeteer browsers install chrome
    startCommand: pnpm run start
    envVars:
      - key: RENDER
        value: true
      - key: CLIQ_SECRET
        scope: secret
```

---

## Troubleshooting

### Test Timeout

If tests timeout during job processing:
1. Check server is running: `curl http://localhost:3000/health`
2. Increase `MAX_POLLS` in test script
3. Check browser binaries are installed: `pnpm exec puppeteer browsers list`

### HMAC Signature Mismatch

Ensure:
1. Request body is exactly the same as when signature was generated
2. Secret matches in both signature generation and server `.env`
3. No extra whitespace in JSON

### Port Already in Use

```bash
# Find process on port 3000
lsof -i :3000

# Kill it
kill -9 <PID>
```

---

## Test Coverage

| Test | Coverage |
|------|----------|
| Health Check | ✅ API availability |
| Invalid Signature | ✅ Security validation |
| Valid Signature | ✅ HMAC correctness |
| Job Queuing | ✅ Async queue functionality |
| Job Polling | ✅ Status tracking |
| Extraction | ✅ Component extraction |
| Output Files | ✅ CSS & JSX generation |

---

## Performance Benchmarks

| Operation | Time |
|-----------|------|
| Health check | <10ms |
| Queue job | <50ms |
| Poll (idle) | <10ms |
| Extract components | 2-5s |
| Full test suite | 10-20s |

---

For more details, see [ASYNC_QUEUE.md](./ASYNC_QUEUE.md) and [README.md](./README.md).
