# Deluge Implementation Quick Reference

## The Problem

Zoho Cliq was rejecting requests with error: `Invalid x-cliq-signature`

**Why?** → The message handler wasn't generating the HMAC signature!

---

## The Solution (One Function)

```deluge
signature = encodeHMAC(jsonBody, hmacSecret, "SHA256");
```

That's it! Deluge's native `encodeHMAC()` function generates SHA256 HMAC signatures.

---

## Complete Flow

```
URL from user: "https://example.com"
        ↓
Generate JSON: {"url":"https://example.com"}
        ↓
Generate HMAC: encodeHMAC(json, secret, "SHA256")
        ↓
Add to Headers: x-cliq-signature: <signature>
        ↓
POST to Server: /analyze with headers
        ↓
Server validates: Regenerate signature and compare
        ↓
Success! Job queued.
```

---

## Copy-Paste Template

```deluge
response = Map();

if(message.startsWith("http://") || message.startsWith("https://"))
{
	try
	{
		// 1. Create request body
		reqBody = Map();
		reqBody.put("url", message);
		jsonBody = reqBody.toString();
		
		// 2. Generate HMAC signature
		hmacSecret = "YOUR_SECRET_HERE";
		signature = encodeHMAC(jsonBody, hmacSecret, "SHA256");
		
		// 3. Prepare headers with signature
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
		
		// 5. Return result
		if(apiResponse.get("ok") == true)
		{
			response.put("text", "✅ Job queued! ID: " + apiResponse.get("jobId"));
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
	response.put("text", "Send me a URL!");
}

return response;
```

---

## Key Implementation Details

### 1. Signature Generation

```deluge
// Format: encodeHMAC(message, key, algorithm)
signature = encodeHMAC(jsonBody, hmacSecret, "SHA256");

// ✅ CORRECT
// ❌ WRONG: encodeHMAC(jsonBody, hmacSecret, "sha256") - case matters
```

### 2. Request Body Must Be JSON String

```deluge
// ✅ CORRECT
reqBody = Map();
reqBody.put("url", "https://example.com");
jsonBody = reqBody.toString();  // Converts Map to JSON string

// ❌ WRONG
jsonBody = "https://example.com";  // Not JSON
```

### 3. Secret Must Match Server

In Deluge:
```deluge
hmacSecret = "1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5";
```

In server `.env`:
```env
CLIQ_SECRET=1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5
```

### 4. Headers Must Include Signature

```deluge
headers = Map();
headers.put("Content-Type", "application/json");
headers.put("x-cliq-signature", signature);  // <- CRITICAL

// Without this line, request will be rejected
```

### 5. Use invokeurl with POST

```deluge
apiResponse = invokeurl
[
	url: "https://cliq-webpage-analyser.onrender.com/analyze"
	type: POST
	parameters: reqBody
	headers: headers
];
```

---

## Common Mistakes & Fixes

| Mistake | Fix |
|---------|-----|
| `encodeHMAC(..., "sha256")` | Change to `"SHA256"` (uppercase) |
| No `x-cliq-signature` header | Add: `headers.put("x-cliq-signature", signature);` |
| Secret doesn't match | Verify exact string, no spaces |
| `reqBody` not JSON | Use `reqBody.toString()` |
| Wrong URL endpoint | Use: `https://cliq-webpage-analyser.onrender.com/analyze` |
| GET instead of POST | Use: `type: POST` |

---

## Validation Server-Side

The server does this automatically:

```javascript
// 1. Receives request with x-cliq-signature header
// 2. Captures raw request body
// 3. Regenerates signature: encodeHMAC(rawBody, CLIQ_SECRET, "SHA256")
// 4. Compares with provided signature
// 5. If match: Process job
// 6. If no match: Return 401 Unauthorized
```

**You don't need to do this in Deluge** - just generate the signature and include the header!

---

## Testing Signature Generation

### In Deluge (Debug)
```deluge
jsonBody = "{\"url\":\"https://example.com\"}";
hmacSecret = "1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5";
signature = encodeHMAC(jsonBody, hmacSecret, "SHA256");
info "Generated signature: " + signature;
```

### In Bash (for comparison)
```bash
BODY='{"url":"https://example.com"}'
SECRET="1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5"
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
echo "Generated signature: $SIGNATURE"
```

Both should produce identical signatures!

---

## Testing Integration

### Step 1: Deploy Deluge Code
- Copy code from `cliq-message-handler.deluge` into your Zoho Cliq message handler
- Save and deploy

### Step 2: Test in Cliq
Send message:
```
https://www.example.com
```

Expected response:
```
✅ Job queued! ID: job-1701345600000-abc123def
```

### Step 3: Check Job Status
```bash
curl "https://cliq-webpage-analyser.onrender.com/result/job-1701345600000-abc123def" \
  -H "x-cliq-signature: <signature>" \
  -H "Content-Type: application/json"
```

---

## Production Security

### ⚠️ Never Hardcode Secrets

```deluge
// ❌ BAD
hmacSecret = "1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5";
```

### ✅ Use Zoho Vault Instead

```deluge
// GOOD - Store in Zoho Vault
vaultResponse = zoho.vault.getSecrets("cliq_analyser_secret");
hmacSecret = vaultResponse.get("secret");
```

Or use environment variables:
```deluge
hmacSecret = zoho.system.getSystemProperty("CLIQ_SECRET");
```

---

## Logging & Debugging

### Add Debug Logs

```deluge
info "Body: " + jsonBody;
info "Secret: " + hmacSecret;
info "Signature: " + signature;
info "Response: " + apiResponse.toString();
```

### Check Zoho Cliq Logs
1. Go to Admin → Bots & Integrations
2. Click on your bot → View Logs
3. Look for error messages
4. Check if request was sent with signature

---

## Response Handling

### Success Response
```json
{
  "ok": true,
  "status": "queued",
  "jobId": "job-1701345600000-abc123def",
  "pollUrl": "/result/job-1701345600000-abc123def"
}
```

Handle in Deluge:
```deluge
if(apiResponse.get("ok") == true)
{
	jobId = apiResponse.get("jobId");
	response.put("text", "✅ Job submitted! ID: " + jobId);
}
```

### Error Response
```json
{
  "ok": false,
  "error": "Invalid x-cliq-signature"
}
```

Handle in Deluge:
```deluge
else if(apiResponse.get("error") != null)
{
	response.put("text", "❌ Error: " + apiResponse.get("error"));
}
```

---

## Implementation Checklist

- [ ] Deluge code has `encodeHMAC()` function call
- [ ] Secret is set correctly (matches server)
- [ ] Headers include `x-cliq-signature`
- [ ] Request body is JSON string (use `.toString()`)
- [ ] URL endpoint is correct: `https://cliq-webpage-analyser.onrender.com/analyze`
- [ ] POST method is used (not GET)
- [ ] Error handling is in place
- [ ] Response is returned to user
- [ ] Tested with sample URL in Cliq
- [ ] Signature generation verified

---

## Files Reference

| File | Purpose | Use When |
|------|---------|----------|
| `cliq-message-handler.deluge` | Basic handler, 20 lines | Just need to submit jobs |
| `cliq-message-handler-advanced.deluge` | Advanced with polling | Need to check job status in Cliq |
| `CLIQ_INTEGRATION.md` | Full integration guide | Learning the complete flow |
| `server/index.js` | API server | Understanding signature validation |
| `test-e2e.mjs` | Test in Node.js | Verifying server works |
| `test-e2e.sh` | Test in Bash | Verifying on Linux/Mac |

---

## One-Minute Summary

1. **Problem**: Cliq sends URL, server says "Invalid signature"
2. **Root Cause**: Deluge handler wasn't generating HMAC signature
3. **Solution**: Add one line: `signature = encodeHMAC(jsonBody, secret, "SHA256");`
4. **Deploy**: Copy `cliq-message-handler.deluge` into your Cliq message handler
5. **Test**: Send URL to bot → Should get job ID back
6. **Verify**: Check job status via polling endpoint

That's it! The rest is handled automatically by the server.

---

**Ready to deploy?**

1. Copy → `cliq-message-handler.deluge`
2. Paste → Into Zoho Cliq message handler
3. Update → Secret variable
4. Save → And test!

Questions? See `CLIQ_INTEGRATION.md` or `README.md` for more details.
