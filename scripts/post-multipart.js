import axios from "axios";
import FormData from "form-data";

const API = process.env.API_URL || "http://localhost:3000";

async function run() {
  try {
    const form = new FormData();
    form.append("url", "https://www.example.com");

    const headers = form.getHeaders();

    console.log("Posting multipart/form-data to /analyze...");
    const resp = await axios.post(`${API}/analyze`, form, { headers, maxBodyLength: Infinity });
    console.log("--- RESPONSE ---");
    console.log(resp.data);

    if (resp.data && resp.data.jobId) {
      const jobId = resp.data.jobId;
      console.log(`Polling /result/${jobId} once...`);
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await axios.get(`${API}/result/${jobId}`);
      console.log("--- POLL ---");
      console.log(poll.data);
    }
  } catch (err) {
    if (err.response) {
      console.error("Error status:", err.response.status);
      console.error(err.response.data);
    } else {
      console.error(err.message);
    }
    process.exit(1);
  }
}

run();
