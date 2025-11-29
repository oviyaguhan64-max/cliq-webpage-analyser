import axios from "axios";

(async () => {
  try {
    console.log("Sending request to http://localhost:3000/analyze...");
    const res = await axios.post("http://localhost:3000/analyze", { url: "https://google.com" }, {
      headers: { "x-cliq-signature": "testsecret" },
      timeout: 10000
    });
    console.log("Response:", res.status, res.data);
  } catch (e) {
    console.error("Error type:", e.constructor.name);
    console.error("Error message:", e.message);
    console.error("Error code:", e.code);
    if (e.response) console.error("Status:", e.response.status, e.response.data);
    if (e.request) console.error("Request made but no response");
  }
  process.exit(0);
})();
