import axios from "axios";

const API_URL = "http://localhost:3000";
const SECRET = "testsecret";
const TEST_URL = "https://www.zoho.com/cliq/login.html";

async function testAsyncQueue() {
  try {
    console.log("🚀 Testing Async Job Queue System\n");

    // Step 1: Queue a job
    console.log(`📤 1. Queuing extraction job for: ${TEST_URL}`);
    const queueResponse = await axios.post(
      `${API_URL}/analyze`,
      { url: TEST_URL },
      {
        headers: {
          "x-cliq-signature": SECRET,
          "Content-Type": "application/json",
        },
      }
    );

    const jobId = queueResponse.data.jobId;
    console.log(`✅ Job queued with ID: ${jobId}`);
    console.log(`📋 Poll URL: ${queueResponse.data.pollUrl}\n`);

    // Step 2: Poll for results with exponential backoff
    console.log("⏳ Polling for results...\n");
    let isComplete = false;
    let pollCount = 0;
    const maxPolls = 30;
    let pollDelay = 1000; // Start with 1 second

    while (!isComplete && pollCount < maxPolls) {
      pollCount++;
      await new Promise((resolve) => setTimeout(resolve, pollDelay));

      try {
        const resultResponse = await axios.get(`${API_URL}/result/${jobId}`, {
          headers: {
            "x-cliq-signature": SECRET,
          },
        });

        const result = resultResponse.data;
        console.log(
          `📊 Poll #${pollCount} - Status: ${result.status.toUpperCase()}`
        );

        if (result.status === "queued" || result.status === "processing") {
          console.log(`   Queue position: ${result.queuePosition || "processing"}`);
          // Exponential backoff: increase delay up to 5 seconds
          pollDelay = Math.min(pollDelay * 1.2, 5000);
        } else if (result.status === "done") {
          console.log(`✨ Job Complete!\n`);
          console.log(`📦 Components extracted: ${result.summary.componentCount}`);
          console.log(`⏱️  Completed at: ${result.summary.completedAt}`);
          console.log(`\n📄 Sample component (first one):`);
          if (result.summary.components.length > 0) {
            const comp = result.summary.components[0];
            console.log(`   Kind: ${comp.kind}`);
            console.log(`   HTML: ${comp.cleanedHtml}`);
            console.log(`   Class: ${comp.className}`);
          }
          isComplete = true;
        } else if (result.status === "failed") {
          console.log(`❌ Job failed: ${result.error}`);
          isComplete = true;
        }
      } catch (err) {
        console.log(`   ⚠️  Poll error (job may still be processing): ${err.message}`);
      }
    }

    if (!isComplete) {
      console.log(`\n⏱️  Timeout: Job did not complete within ${pollCount} polls`);
      console.log(`   You can continue polling with: curl http://localhost:3000/result/${jobId}`);
    }

    console.log(
      `\n✅ Test complete! Total time: ${(pollCount * pollDelay) / 1000}s`
    );
  } catch (err) {
    console.error("❌ Test failed:", err.message);
    if (err.response) {
      console.error("   Response:", err.response.data);
    }
  }
}

// Run test
testAsyncQueue();
