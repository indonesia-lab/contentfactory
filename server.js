const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const HF_KEY = process.env.HF_KEY;
const HF_SECRET = process.env.HF_SECRET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/sports_content_scanner_v3.html');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Content Factory Proxy' });
});

// Claude API proxy — POST /claude
app.post('/claude', async (req, res) => {
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY env var not set' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Higgsfield generate — POST /generate
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

// Higgsfield status — GET /status/:requestId
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
  console.log(`Content Factory Proxy running on port ${PORT}`);
});
