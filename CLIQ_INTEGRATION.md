# Zoho Cliq Integration Guide

## Overview

Integrate the CLIQ Webpage Analyser with Zoho Cliq using Deluge message handlers and HMAC signature validation.

## Problem: Invalid x-cliq-signature Error

The error `{"error":"Invalid x-cliq-signature."}` occurs when:
1. ❌ No signature header is sent
2. ❌ Signature is incorrectly calculated
3. ❌ Secret doesn't match server's secret
4. ❌ Request body encoding is inconsistent

## Solution: Deluge HMAC Implementation

### Step 1: Generate HMAC Signature in Deluge

Deluge provides the `encodeHMAC()` function:

```deluge
// Prepare request body
reqBody = Map();
reqBody.put("url", "https://example.com");

// Convert to JSON string
jsonBody = reqBody.toString();

// Define secret (keep secure - use Zoho Vault in production!)
hmacSecret = "1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5";

// Generate HMAC SHA256 signature
signature = encodeHMAC(jsonBody, hmacSecret, "SHA256");
```

### Step 2: Add Signature to Request Headers

```deluge
headers = Map();
headers.put("Content-Type", "application/json");
headers.put("x-cliq-signature", signature);

apiResponse = invokeurl
[
	url: "https://cliq-webpage-analyser.onrender.com/analyze"
	type: POST
	parameters: reqBody
	headers: headers
];
```

## Complete Message Handler Code

### Basic Handler (Simple)

```deluge
response = Map();

if(message.startsWith("http://") || message.startsWith("https://"))
{
	try
	{
		// 1. Prepare request
		reqBody = Map();
		reqBody.put("url", message);
		jsonBody = reqBody.toString();
		
		// 2. Generate signature
		hmacSecret = "1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5";
		signature = encodeHMAC(jsonBody, hmacSecret, "SHA256");
		
		// 3. Add headers
		headers = Map();
		headers.put("Content-Type", "application/json");
		headers.put("x-cliq-signature", signature);
		
		// 4. Send request
		apiResponse = invokeurl
		[
			url: "https://cliq-webpage-analyser.onrender.com/analyze"
			type: POST
			parameters: reqBody
			headers: headers
		];
		
		// 5. Handle response
		if(apiResponse.get("ok") == true)
		{
			jobId = apiResponse.get("jobId");
			response.put("text", "✅ Job submitted! ID: " + jobId);
		}
		else
		{
			response.put("text", "❌ Error: " + apiResponse.get("error"));
		}
	}
	catch (e)
	{
		response.put("text", "❌ Error: " + e.getMessage());
	}
}
else
{
	response.put("text", "Send me a URL to analyze!");
}

return response;
```

### Advanced Handler (With Polling)

See `cliq-message-handler-advanced.deluge` for:
- Job status polling
- Error handling
- Helper functions
- Context management

## Testing the Integration

### Step 1: Update Secret

Make sure both Cliq and server use the same secret:

```deluge
// In Deluge (Cliq)
hmacSecret = "1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5";
```

```env
# In server .env
CLIQ_SECRET=1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5
```

### Step 2: Test with Cliq Bot

1. Open Zoho Cliq
2. Send message to your bot: `https://www.notion.com/desktop/`
3. Expected response: `✅ Job submitted! ID: job-...`

### Step 3: Verify Signature Generation

You can test signature generation independently:

```bash
# Generate signature with curl/bash
BODY='{"url":"https://example.com"}'
SECRET="1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5"
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
echo "Signature: $SIGNATURE"
```

## Production Security

### ⚠️ Never Hardcode Secrets

Use Zoho Vault to store sensitive data:

```deluge
// Fetch from Zoho Vault (better approach)
hmacSecret = zoho.encryption.decrypt(context.get("vault_secret_key"));
```

Or use Zoho Secrets:

```deluge
hmacSecret = zoho.system.getSecretField("cliq_analyser_secret");
```

## Troubleshooting

### Error: "Invalid x-cliq-signature"

**Cause**: Signature mismatch

**Fix**:
1. Verify `encodeHMAC()` is using "SHA256"
2. Check secret matches exactly (no extra spaces)
3. Ensure `reqBody.toString()` creates valid JSON
4. Log the signature and body for debugging

```deluge
info "Body: " + jsonBody;
info "Secret: " + hmacSecret;
info "Signature: " + signature;
```

### Error: "Missing URL"

**Cause**: URL parameter not passed correctly

**Fix**:
```deluge
// Correct
reqBody.put("url", message);

// Wrong
reqBody.put("url", "message"); // This sends string "message"
```

### Job Status Always "Queued"

**Cause**: Server not processing jobs

**Fix**:
1. Check server is running: `curl https://cliq-webpage-analyser.onrender.com/health`
2. Check logs on Render dashboard
3. Verify Puppeteer browser is installed

## Advanced Features

### Job Polling with Context

Store job ID in context for multi-message workflows:

```deluge
// Message 1: Submit URL
jobId = apiResponse.get("jobId");
context = {"jobId": jobId, "submitted_time": now()};
response.put("context", context);

// Message 2: Check status
jobId = context.get("jobId");
// Poll for results...
```

### Error Handling

```deluge
if(apiResponse.get("ok") == true)
{
	// Success
	response.put("text", "✅ Success");
}
else if(apiResponse.get("error") != null)
{
	// API error
	response.put("text", "❌ API Error: " + apiResponse.get("error"));
}
else
{
	// Unknown error
	response.put("text", "❌ Unknown error occurred");
}
```

## API Response Examples

### Successful Queue

```json
{
  "ok": true,
  "status": "queued",
  "jobId": "job-1701345600000-abc123def",
  "pollUrl": "/result/job-1701345600000-abc123def",
  "message": "Job queued for processing. Check /result/{jobId} for status."
}
```

### Job Status - Processing

```json
{
  "ok": true,
  "jobId": "job-1701345600000-abc123def",
  "status": "processing",
  "message": "Your job is processing. Check back soon."
}
```

### Job Status - Complete

```json
{
  "ok": true,
  "jobId": "job-1701345600000-abc123def",
  "status": "done",
  "summary": {
    "url": "https://example.com",
    "componentCount": 15,
    "components": [ ... ],
    "cssFile": "...",
    "reactFile": "...",
    "completedAt": "2024-11-30T12:34:56.789Z"
  }
}
```

## Files Provided

1. **cliq-message-handler.deluge** - Basic handler (20 lines, ready to use)
2. **cliq-message-handler-advanced.deluge** - Advanced with polling support
3. **CLIQ_INTEGRATION.md** - This file

## Implementation Steps

1. ✅ Copy code from `cliq-message-handler.deluge`
2. ✅ Paste into your Zoho Cliq message handler
3. ✅ Update the `hmacSecret` variable with your actual secret
4. ✅ Test by sending a URL
5. ✅ Monitor logs for debugging

## Security Checklist

- [ ] Use same secret in Cliq and server
- [ ] Verify `encodeHMAC()` uses "SHA256"
- [ ] Check `reqBody.toString()` format
- [ ] Never commit secrets to GitHub
- [ ] Use Zoho Vault in production
- [ ] Validate all inputs before sending

## Support

If you encounter issues:

1. Check server logs: `https://cliq-webpage-analyser.onrender.com/health`
2. Verify signature generation: Log it in Deluge with `info` statement
3. Compare with cURL test: Run `bash test-e2e.sh` to verify server
4. Check network: Ensure Cliq can reach your Render deployment

## Next Steps

- [ ] Test with multiple URLs
- [ ] Implement job polling with async task scheduling
- [ ] Store extracted components in database
- [ ] Display results in Cliq UI
- [ ] Add rate limiting per user
