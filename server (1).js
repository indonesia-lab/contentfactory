const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const HF_KEY = process.env.HF_KEY;
const HF_SECRET = process.env.HF_SECRET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve Scanner HTML
app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'sports_content_scanner_v3.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Scanner not found. Files: ' + fs.readdirSync(__dirname).join(', '));
  }
});

app.get('/sports_content_scanner_v3.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'sports_content_scanner_v3.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', files: fs.readdirSync(__dirname) });
});

// Claude API proxy
app.post('/claude', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not set' });
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

// STEP 1: Text-to-Image (Soul)
app.post('/generate-image', async (req, res) => {
  const { prompt, aspect_ratio } = req.body;
  if (!HF_KEY || !HF_SECRET) return res.status(500).json({ error: 'HF_KEY and HF_SECRET env vars not set' });
  try {
    const response = await fetch('https://platform.higgsfield.ai/higgsfield-ai/soul/cinema', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${HF_KEY}:${HF_SECRET}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt,
        aspect_ratio: aspect_ratio || '9:16',
        resolution: '720p'
      })
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// STEP 2: Image-to-Video (DoP)
app.post('/generate-video', async (req, res) => {
  const { image_url, prompt, duration, aspect_ratio } = req.body;
  if (!HF_KEY || !HF_SECRET) return res.status(500).json({ error: 'HF_KEY and HF_SECRET env vars not set' });
  if (!image_url) return res.status(400).json({ error: 'image_url required' });
  try {
    const response = await fetch('https://platform.higgsfield.ai/higgsfield-ai/dop/turbo', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${HF_KEY}:${HF_SECRET}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        image_url: image_url,
        prompt: prompt || '',
        duration: duration || 5,
        aspect_ratio: aspect_ratio || '9:16'
      })
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll job status
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
  console.log(`Proxy running on port ${PORT}`);
  console.log('Files:', fs.readdirSync(__dirname));
});
