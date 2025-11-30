# Async Job Queue System

## Overview

The async job queue system allows long-running component extractions to be processed without blocking client requests. This is essential for Render and other serverless/time-limited deployments.

## Architecture

### Job States
```
┌─────────┐    ┌────────────┐    ┌──────┐
│ Queued  │───▶│ Processing │───▶│ Done │
└─────────┘    └────────────┘    └──────┘
                       │
                       └──────▶ Failed
```

### Components
- **Job Queue** - In-memory FIFO queue of job IDs
- **Job Store** - Map of job metadata and results
- **Background Worker** - Processes jobs sequentially from the queue
- **Cleanup Service** - Removes jobs older than 1 hour every 5 minutes

## API Endpoints

### 1. Queue a Job (Non-blocking)
```http
POST /analyze
Content-Type: application/json
x-cliq-signature: testsecret

{
  "url": "https://example.com"
}
```

**Response (Immediate):**
```json
{
  "ok": true,
  "status": "queued",
  "jobId": "job-1701345600000-abc123def",
  "pollUrl": "/result/job-1701345600000-abc123def",
  "message": "Job queued for processing. Check /result/{jobId} for status."
}
```

### 2. Poll Job Status
```http
GET /result/:jobId
x-cliq-signature: testsecret
```

**Response - Queued:**
```json
{
  "ok": true,
  "jobId": "job-1701345600000-abc123def",
  "status": "queued",
  "queuePosition": 2,
  "message": "Your job is queued. Check back soon."
}
```

**Response - Processing:**
```json
{
  "ok": true,
  "jobId": "job-1701345600000-abc123def",
  "status": "processing",
  "message": "Your job is processing. Check back soon."
}
```

**Response - Complete:**
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
        "cleanedHtml": "<button>Click Me</button>",
        "htmlSnippet": "<button class=\"gen-button-1\">Click Me</button>",
        "className": "gen-button-1",
        "css": ".gen-button-1 { display: inline-block; ... }",
        "reactSnippet": "..."
      }
      // ... more components
    ],
    "cssFile": "/* consolidated CSS */",
    "reactFile": "/* consolidated React components */",
    "completedAt": "2024-11-30T12:34:56.789Z"
  }
}
```

**Response - Failed:**
```json
{
  "ok": false,
  "jobId": "job-1701345600000-abc123def",
  "status": "failed",
  "error": "URL not allowed"
}
```

**Response - Not Found:**
```json
{
  "ok": false,
  "error": "Job not found. Job IDs are stored for 1 hour."
}
```

## Usage Examples

### cURL
```bash
# 1. Queue a job
curl -X POST http://localhost:3000/analyze \
  -H "x-cliq-signature: testsecret" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

# Response: {"ok":true,"status":"queued","jobId":"job-...","pollUrl":"/result/job-..."}

# 2. Poll for results
curl http://localhost:3000/result/job-1701345600000-abc123def \
  -H "x-cliq-signature: testsecret"
```

### PowerShell
```powershell
# 1. Queue a job
$response = Invoke-RestMethod -Uri "http://localhost:3000/analyze" `
  -Method Post `
  -Headers @{"x-cliq-signature" = "testsecret"} `
  -Body (@{"url" = "https://example.com"} | ConvertTo-Json) `
  -ContentType "application/json"

$jobId = $response.jobId
Write-Host "Job queued: $jobId"

# 2. Poll with exponential backoff
$delay = 1000
do {
  Start-Sleep -Milliseconds $delay
  $result = Invoke-RestMethod -Uri "http://localhost:3000/result/$jobId" `
    -Headers @{"x-cliq-signature" = "testsecret"}
  
  Write-Host "Status: $($result.status)"
  $delay = [Math]::Min($delay * 1.2, 5000)
} while ($result.status -ne "done" -and $result.status -ne "failed")
```

### Node.js (with axios)
```javascript
import axios from "axios";

const client = axios.create({
  baseURL: "http://localhost:3000",
  headers: { "x-cliq-signature": "testsecret" }
});

// Queue a job
const { data: queued } = await client.post("/analyze", {
  url: "https://example.com"
});
console.log("Job queued:", queued.jobId);

// Poll with exponential backoff
let pollDelay = 1000;
let isComplete = false;

while (!isComplete) {
  await new Promise(r => setTimeout(r, pollDelay));
  const { data: result } = await client.get(`/result/${queued.jobId}`);
  
  console.log("Status:", result.status);
  
  if (result.status === "done") {
    console.log("Extracted components:", result.summary.componentCount);
    isComplete = true;
  } else if (result.status === "failed") {
    console.error("Job failed:", result.error);
    isComplete = true;
  }
  
  pollDelay = Math.min(pollDelay * 1.2, 5000);
}
```

## Testing

Run the async queue test script:
```bash
# Terminal 1: Start server
pnpm run start

# Terminal 2: Test async workflow
node test-async-queue.mjs
```

Expected output:
```
🚀 Testing Async Job Queue System

📤 1. Queuing extraction job for: https://www.zoho.com/cliq/login.html
✅ Job queued with ID: job-1701345600000-abc123def
📋 Poll URL: /result/job-1701345600000-abc123def

⏳ Polling for results...

📊 Poll #1 - Status: QUEUED
   Queue position: 1
📊 Poll #2 - Status: PROCESSING
📊 Poll #3 - Status: PROCESSING
✨ Job Complete!

📦 Components extracted: 24
⏱️  Completed at: 2024-11-30T12:34:56.789Z

📄 Sample component (first one):
   Kind: a
   HTML: <a href="https://www.zoho.com/">ZOHO</a>
   Class: gen-a-1

✅ Test complete! Total time: 12.5s
```

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Queue Response Time | <50ms |
| Poll Response Time | <10ms |
| Job Processing Time | 2-5s per page |
| Max Queue Depth | Unlimited (memory bound) |
| Job Retention | 1 hour |
| Cleanup Interval | Every 5 minutes |

## Deployment on Render

1. Set environment variable: `RENDER=true`
2. The server automatically uses `puppeteer-core` + `@sparticuz/chromium` for headless execution
3. Jobs can be processed in background while other requests are served
4. Multiple Render instances can share results via external database (PostgreSQL/Redis)

### Example Render Configuration

```yaml
# render.yaml
services:
  - type: web
    name: cliq-analyzer
    runtime: node
    buildCommand: pnpm install --shamefully-hoist
    startCommand: pnpm run start
    env:
      - key: PORT
        value: 3000
      - key: RENDER
        value: true
      - key: CLIQ_SECRET
        scope: secret
      - key: ENFORCE_ALLOWLIST
        value: true
```

## Architecture Advantages

✅ **Non-blocking** - Clients get immediate response with job ID  
✅ **Timeout-safe** - No request timeouts for long-running extractions  
✅ **Scalable** - Can be extended with Redis for multi-instance deployments  
✅ **Resilient** - Failed jobs don't block queue processing  
✅ **Memory-efficient** - Old jobs automatically cleaned up  
✅ **Observable** - Queue position shows progress to clients  
✅ **Simple** - No external dependencies (built-in Map/Array)

## Future Enhancements

1. **Persistence** - Store jobs in PostgreSQL or MongoDB
2. **Distributed Queue** - Use Redis or RabbitMQ for multi-instance setups
3. **Webhooks** - Notify client when job completes
4. **Retries** - Automatic retry for failed extractions
5. **Priority Queue** - Process premium users' jobs first
6. **Rate Limiting** - Limit jobs per user/IP
7. **Dead Letter Queue** - Store permanently failed jobs for analysis
