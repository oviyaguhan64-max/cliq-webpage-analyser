#!/bin/bash

# End-to-End Testing Script for CLIQ Webpage Analyser
# Demonstrates HMAC signature validation and async job queue

API_URL="${API_URL:-http://localhost:3000}"
CLIQ_SECRET="${CLIQ_SECRET:-1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5}"

echo "═══════════════════════════════════════════════════════════════"
echo "🧪 END-TO-END TEST SUITE"
echo "═══════════════════════════════════════════════════════════════"
echo "API URL: $API_URL"
echo "Secret: ${CLIQ_SECRET:0:20}..."
echo ""

# Test 1: Health Check
echo "🏥 Test 1: Health Check"
HEALTH=$(curl -s "$API_URL/health")
if echo "$HEALTH" | grep -q '"ok"'; then
  echo "✅ Health check passed: $HEALTH"
else
  echo "❌ Health check failed"
  exit 1
fi
echo ""

# Test 2: Invalid Signature
echo "🔒 Test 2: Invalid Signature Rejection"
BODY='{"url":"https://example.com"}'
INVALID_RESPONSE=$(curl -s -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -H "x-cliq-signature: invalid_signature_123456" \
  -d "$BODY")

if echo "$INVALID_RESPONSE" | grep -q "Invalid"; then
  echo "✅ Invalid signature correctly rejected: $INVALID_RESPONSE"
else
  echo "❌ Invalid signature was accepted (security issue!)"
  exit 1
fi
echo ""

# Test 3: Valid Signature - Queue Job
echo "🔐 Test 3: Valid HMAC Signature - Queue Job"
BODY='{"url":"https://www.zoho.com/cliq/login.html"}'
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$CLIQ_SECRET" | sed 's/^.* //')

echo "📝 Request body: $BODY"
echo "🔐 HMAC SHA256: $SIGNATURE"
echo ""
echo "📤 Queuing job..."

QUEUE_RESPONSE=$(curl -s -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -H "x-cliq-signature: $SIGNATURE" \
  -d "$BODY")

echo "📋 Queue response: $QUEUE_RESPONSE"

# Extract jobId
JOB_ID=$(echo "$QUEUE_RESPONSE" | grep -o '"jobId":"[^"]*' | cut -d'"' -f4)

if [ -z "$JOB_ID" ]; then
  echo "❌ Failed to extract jobId from response"
  exit 1
fi

echo "✅ Job queued with ID: $JOB_ID"
echo "📋 Poll URL: /result/$JOB_ID"
echo ""

# Test 4: Poll Job Status (with timeout)
echo "⏳ Test 4: Polling for Results..."
POLL_COUNT=0
MAX_POLLS=60
POLL_DELAY=1

while [ $POLL_COUNT -lt $MAX_POLLS ]; do
  POLL_COUNT=$((POLL_COUNT + 1))
  sleep $POLL_DELAY
  
  RESULT=$(curl -s -H "x-cliq-signature: $SIGNATURE" \
    "$API_URL/result/$JOB_ID")
  
  STATUS=$(echo "$RESULT" | grep -o '"status":"[^"]*' | cut -d'"' -f4)
  
  echo "📊 Poll #$POLL_COUNT: Status = $STATUS"
  
  if [ "$STATUS" = "done" ]; then
    echo ""
    echo "✨ JOB COMPLETE!"
    echo "📋 Full result:"
    echo "$RESULT" | jq '.' 2>/dev/null || echo "$RESULT"
    
    # Extract stats
    COMP_COUNT=$(echo "$RESULT" | grep -o '"componentCount":[0-9]*' | cut -d':' -f2)
    echo ""
    echo "📊 Summary:"
    echo "   ✓ Components extracted: $COMP_COUNT"
    
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "❌ Job failed"
    echo "$RESULT" | jq '.' 2>/dev/null || echo "$RESULT"
    exit 1
  elif [ "$STATUS" = "processing" ] || [ "$STATUS" = "queued" ]; then
    # Exponential backoff
    POLL_DELAY=$(echo "scale=2; $POLL_DELAY * 1.2" | bc)
    if (( $(echo "$POLL_DELAY > 5" | bc -l) )); then
      POLL_DELAY=5
    fi
  fi
done

if [ $POLL_COUNT -eq $MAX_POLLS ]; then
  echo "⏱️  Timeout: Job did not complete within $MAX_POLLS polls"
  echo "You can continue polling manually:"
  echo "curl $API_URL/result/$JOB_ID -H 'x-cliq-signature: $SIGNATURE' | jq '.'"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ ALL TESTS PASSED! 🎉"
echo "═══════════════════════════════════════════════════════════════"
