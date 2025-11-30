import axios from 'axios';

const API = process.env.API_URL || 'http://localhost:3000';
const body = { url: 'https://www.notion.com/desktop/' };

(async () => {
  try {
    console.log('Posting JSON to /analyze for Notion URL...');
    const resp = await axios.post(`${API}/analyze`, body, { headers: { 'Content-Type': 'application/json' }, timeout: 120000 });
    console.log('Response:', resp.data);
    if (resp.data && resp.data.jobId) {
      const jobId = resp.data.jobId;
      console.log('Polling once for job status...');
      await new Promise(r => setTimeout(r, 2000));
      const poll = await axios.get(`${API}/result/${jobId}`, { timeout: 60000 });
      console.log('Poll response:', poll.data);
    }
  } catch (err) {
    if (err.response) {
      console.error('Error status:', err.response.status);
      console.error('Error data:', err.response.data);
    } else {
      console.error('Request error:', err.message);
    }
    process.exit(1);
  }
})();
