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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', files: fs.readdirSync(__dirname) });
});

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

// STEP 1: Text-to-Image — submits Soul Cinema and polls until image ready
app.post('/generate-image', async (req, res) => {
  const { prompt, aspect_ratio } = req.body;
  if (!HF_KEY || !HF_SECRET) return res.status(500).json({ error: 'HF_KEY and HF_SECRET env vars not set' });
  const auth = `Key ${HF_KEY}:${HF_SECRET}`;
  try {
    // Submit
    const submitRes = await fetch('https://platform.higgsfield.ai/higgsfield-ai/soul/cinema', {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ prompt, aspect_ratio: aspect_ratio || '9:16', resolution: '720p' })
    });
    const submitData = await submitRes.json();
    if (!submitRes.ok) return res.status(submitRes.status).json(submitData);
    const requestId = submitData.request_id;
    if (!requestId) return res.status(500).json({ error: 'No request_id', raw: submitData });

    // Poll until done (max 72 seconds)
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://platform.higgsfield.ai/request/${requestId}`, {
        headers: { 'Authorization': auth }
      });
      const pollData = await pollRes.json();
      const status = pollData.status || pollData.state || '';
      if (status === 'completed') {
        const imageUrl =
          (pollData.output && pollData.output.images && pollData.output.images[0] && pollData.output.images[0].url) ||
          (pollData.output && pollData.output.url) ||
          (pollData.images && pollData.images[0] && pollData.images[0].url) ||
          pollData.url || null;
        if (imageUrl) return res.json({ url: imageUrl, request_id: requestId });
        return res.status(500).json({ error: 'Completed but no image URL', raw: pollData });
      }
      if (status === 'failed' || status === 'cancelled') {
        return res.status(500).json({ error: 'Image generation ' + status, raw: pollData });
      }
    }
    return res.status(500).json({ error: 'Timed out after 72s' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// STEP 2: Image-to-Video (DoP Turbo)
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
  console.log('Proxy running on port ' + PORT);
  console.log('Files:', fs.readdirSync(__dirname));
});
