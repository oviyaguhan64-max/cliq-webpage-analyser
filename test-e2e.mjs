#!/usr/bin/env node

import crypto from "crypto";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:3000";
const CLIQ_SECRET = process.env.CLIQ_SECRET || "1001.3ea9d992cfa4a3e0db5f5c83fb5a7710.b2631f1a4a9275a484f44c14afbf88e5";

/**
 * Generate HMAC SHA256 signature for request body
 */
function generateSignature(body) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return crypto
    .createHmac("sha256", CLIQ_SECRET)
    .update(bodyStr)
    .digest("hex");
}

/**
 * Test health endpoint
 */
async function testHealth() {
  console.log("\n🏥 Testing /health endpoint");
  try {
    const response = await axios.get(`${API_URL}/health`);
    console.log("✅ Health check passed:", response.data);
    return true;
  } catch (err) {
    console.error("❌ Health check failed:", err.message);
    return false;
  }
}

/**
 * Test async job queue with HMAC signature
 */
async function testAsyncQueue() {
  console.log("\n🔄 Testing Async Job Queue with HMAC Signature");
  
  const testUrl = "https://www.zoho.com/cliq/login.html";
  const body = { url: testUrl };
  const signature = generateSignature(body);

  console.log(`📝 Request body: ${JSON.stringify(body)}`);
  console.log(`🔐 HMAC SHA256: ${signature}`);

  try {
    console.log(`\n📤 1. Queuing job for ${testUrl}...`);
    
    const queueResponse = await axios.post(`${API_URL}/analyze`, body, {
      headers: {
        "x-cliq-signature": signature,
        "Content-Type": "application/json",
      },
    });

    const jobId = queueResponse.data.jobId;
    console.log(`✅ Job queued with ID: ${jobId}`);
    console.log(`📋 Full response:`, queueResponse.data);

    // Poll for results
    console.log(`\n⏳ 2. Polling for results with exponential backoff...`);
    
    let pollCount = 0;
    let pollDelay = 1000;
    const maxPolls = 60;
    let isComplete = false;

    while (!isComplete && pollCount < maxPolls) {
      pollCount++;
      await new Promise((resolve) => setTimeout(resolve, pollDelay));

      try {
        const resultResponse = await axios.get(`${API_URL}/result/${jobId}`, {
          headers: {
            "x-cliq-signature": signature,
          },
        });

        const result = resultResponse.data;
        const statusEmoji = {
          queued: "📋",
          processing: "⚙️",
          done: "✨",
          failed: "❌",
        }[result.status] || "❓";

        console.log(
          `${statusEmoji} Poll #${pollCount}: Status = ${result.status.toUpperCase()}`
        );

        if (result.status === "queued") {
          console.log(
            `   └─ Queue position: ${result.queuePosition || "unknown"}`
          );
          pollDelay = Math.min(pollDelay * 1.2, 5000);
        } else if (result.status === "processing") {
          pollDelay = Math.min(pollDelay * 1.2, 5000);
        } else if (result.status === "done") {
          const summary = result.summary;
          console.log(`\n✨ JOB COMPLETE!\n`);
          console.log(`📊 Extraction Summary:`);
          console.log(`   URL: ${summary.url}`);
          console.log(`   Components: ${summary.componentCount}`);
          console.log(`   Completed: ${summary.completedAt}`);

          if (summary.components.length > 0) {
            console.log(`\n📄 First Component:`);
            const comp = summary.components[0];
            console.log(`   Type: ${comp.kind}`);
            console.log(`   Class: ${comp.className}`);
            console.log(`   HTML: ${comp.cleanedHtml}`);
            console.log(`   CSS lines: ${comp.css.split("\n").length}`);
          }

          console.log(`\n📦 Output Files:`);
          console.log(`   ✓ components.json (${summary.components.length} items)`);
          console.log(
            `   ✓ styles.css (${summary.cssFile.split("\n").length} lines)`
          );
          console.log(
            `   ✓ Components.jsx (${summary.reactFile.split("\n").length} lines)`
          );

          isComplete = true;
        } else if (result.status === "failed") {
          console.error(`❌ Job failed: ${result.error}`);
          isComplete = true;
        }
      } catch (err) {
        console.log(`   ⚠️  Poll error: ${err.message}`);
      }
    }

    if (!isComplete) {
      console.log(
        `\n⏱️  Timeout: Job did not complete within ${maxPolls} polls`
      );
      console.log(`   You can continue polling manually:`);
      console.log(
        `   curl http://localhost:3000/result/${jobId} -H "x-cliq-signature: ${signature}"`
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error("❌ Test failed:", err.message);
    if (err.response) {
      console.error(`   Status: ${err.response.status}`);
      console.error(`   Data:`, err.response.data);
    }
    return false;
  }
}

/**
 * Test invalid signature rejection
 */
async function testInvalidSignature() {
  console.log("\n🔒 Testing Invalid Signature Rejection");

  const body = { url: "https://example.com" };
  const invalidSignature = "invalid_signature_123456";

  try {
    console.log("📤 Attempting request with invalid signature...");
    
    await axios.post(`${API_URL}/analyze`, body, {
      headers: {
        "x-cliq-signature": invalidSignature,
        "Content-Type": "application/json",
      },
    });

    console.error("❌ SECURITY ISSUE: Invalid signature was accepted!");
    return false;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      console.log(`✅ Correctly rejected invalid signature`);
      console.log(`   Response: ${err.response.data.error}`);
      return true;
    } else {
      console.error("❌ Unexpected error:", err.message);
      return false;
    }
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("🧪 END-TO-END TEST SUITE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`API URL: ${API_URL}`);
  console.log(`Secret: ${CLIQ_SECRET.substring(0, 20)}...`);

  const results = [];

  // Test 1: Health check
  results.push({
    name: "Health Check",
    passed: await testHealth(),
  });

  // Test 2: Invalid signature
  results.push({
    name: "Invalid Signature Rejection",
    passed: await testInvalidSignature(),
  });

  // Test 3: Async queue
  results.push({
    name: "Async Job Queue (Full Extraction)",
    passed: await testAsyncQueue(),
  });

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("📊 TEST SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  results.forEach((result) => {
    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon} ${result.name}`);
  });

  console.log(
    `\n${passed}/${total} tests passed ${passed === total ? "🎉" : "⚠️"}`
  );

  process.exit(passed === total ? 0 : 1);
}

// Run tests
runAllTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
