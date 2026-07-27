const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Your Higgsfield credentials — set these as environment variables in Railway
const HF_KEY = process.env.HF_KEY;
const HF_SECRET = process.env.HF_SECRET;

app.use(cors()); // Allow all origins — Scanner can call this proxy freely
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Higgsfield Proxy' });
});

// Generate video — POST /generate
// Body: { model, prompt, duration, aspect_ratio }
app.post('/generate', async (req, res) => {
  const { model, prompt, duration, aspect_ratio } = req.body;

  if (!model || !prompt) {
    return res.status(400).json({ error: 'model and prompt are required' });
  }

  if (!HF_KEY || !HF_SECRET) {
    return res.status(500).json({ error: 'HF_KEY and HF_SECRET env vars not set' });
  }

  try {
    const response = await fetch(`https://platform.higgsfield.ai/${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${HF_KEY}:${HF_SECRET}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ prompt, duration: duration || 5, aspect_ratio: aspect_ratio || '9:16' })
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check job status — GET /status/:requestId
app.get('/status/:requestId', async (req, res) => {
  const { requestId } = req.params;

  try {
    const response = await fetch(`https://platform.higgsfield.ai/request/${requestId}`, {
      headers: { 'Authorization': `Key ${HF_KEY}:${HF_SECRET}` }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Higgsfield Proxy running on port ${PORT}`);
});
