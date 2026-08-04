const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

const HF_KEY = process.env.HF_KEY;
const HF_SECRET = process.env.HF_SECRET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

const ffmpegPath = require('ffmpeg-static');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const TMP = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);

// ── STATIC ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const f = path.join(__dirname, 'sports_content_scanner_v4.html');
  fs.existsSync(f) ? res.sendFile(f) : res.status(404).send('Not found. Files: ' + fs.readdirSync(__dirname).join(', '));
});

app.get('/sports_content_scanner_v4.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'sports_content_scanner_v4.html'));
});

app.get('/health', (req, res) => {
  let ffmpeg = 'not found';
  try { ffmpeg = execSync(`"${ffmpegPath}" -version 2>&1`).toString().split('\n')[0]; } catch(e) { ffmpeg = ffmpegPath || 'error'; }
  res.json({ status: 'ok', ffmpeg, keys: { hf: !!HF_KEY, anthropic: !!ANTHROPIC_KEY } });
});

// ── CLAUDE PROXY ─────────────────────────────────────────────────────────────
app.post('/claude', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not set' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
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

// ── HIGGSFIELD: TEXT → IMAGE (Soul Cinema) ───────────────────────────────────
app.post('/generate-image', async (req, res) => {
  const { prompt, aspect_ratio } = req.body;
  if (!HF_KEY || !HF_SECRET) return res.status(500).json({ error: 'HF keys not set' });
  const auth = `Key ${HF_KEY}:${HF_SECRET}`;
  try {
    const submitRes = await fetch('https://platform.higgsfield.ai/higgsfield-ai/soul/cinema', {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ prompt, aspect_ratio: aspect_ratio || '9:16', resolution: '720p' })
    });
    const submitData = await submitRes.json();
    if (!submitRes.ok) return res.status(submitRes.status).json(submitData);
    const requestId = submitData.request_id;
    if (!requestId) return res.status(500).json({ error: 'No request_id', raw: submitData });

    // Poll until done (max 3 min)
    const start = Date.now();
    while (Date.now() - start < 180000) {
      await new Promise(r => setTimeout(r, 4000));
      const pollRes = await fetch(`https://platform.higgsfield.ai/requests/${requestId}/status`, { headers: { 'Authorization': auth } });
      const d = await pollRes.json();
      if (d.status === 'completed') {
        const url = (d.images && d.images[0] && d.images[0].url) || (d.output && d.output.url) || d.url || null;
        if (url) return res.json({ url, request_id: requestId });
        return res.status(500).json({ error: 'No image URL', raw: d });
      }
      if (d.status === 'failed' || d.status === 'nsfw' || d.status === 'cancelled') {
        return res.status(500).json({ error: 'Image ' + d.status, raw: d });
      }
    }
    return res.status(500).json({ error: 'Image generation timed out' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HIGGSFIELD: IMAGE → VIDEO (DoP Standard) ─────────────────────────────────
app.post('/generate-video', async (req, res) => {
  const { image_url, prompt, aspect_ratio } = req.body;
  if (!HF_KEY || !HF_SECRET) return res.status(500).json({ error: 'HF keys not set' });
  if (!image_url) return res.status(400).json({ error: 'image_url required' });
  try {
    const response = await fetch('https://platform.higgsfield.ai/higgsfield-ai/dop/standard', {
      method: 'POST',
      headers: { 'Authorization': `Key ${HF_KEY}:${HF_SECRET}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ image_url, prompt: prompt || '', duration: 5, aspect_ratio: aspect_ratio || '9:16' })
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POLL VIDEO STATUS ─────────────────────────────────────────────────────────
app.get('/status/:requestId', async (req, res) => {
  try {
    const response = await fetch(`https://platform.higgsfield.ai/requests/${req.params.requestId}/status`, {
      headers: { 'Authorization': `Key ${HF_KEY}:${HF_SECRET}` }
    });
    const data = await response.json();
    const videoUrl = (data.video && data.video.url) || (data.output && data.output.url) || data.url || null;
    if (videoUrl) data._video_url = videoUrl;
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MERGE ─────────────────────────────────────────────────────────────────────
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

app.post('/merge', async (req, res) => {
  const { video_urls, content_id } = req.body;
  if (!video_urls || !Array.isArray(video_urls) || video_urls.length === 0) {
    return res.status(400).json({ error: 'video_urls array required' });
  }
  const jobId = content_id || ('merge_' + Date.now());
  const jobDir = path.join(TMP, jobId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });
  try {
    const clipPaths = [];
    for (let i = 0; i < video_urls.length; i++) {
      const clipPath = path.join(jobDir, `scene_${i+1}.mp4`);
      await downloadFile(video_urls[i], clipPath);
      clipPaths.push(clipPath);
    }
    const listPath = path.join(jobDir, 'list.txt');
    fs.writeFileSync(listPath, clipPaths.map(p => `file '${p}'`).join('\n'));
    const outPath = path.join(jobDir, 'final.mp4');
    execSync(`"${ffmpegPath}" -f concat -safe 0 -i "${listPath}" -c copy "${outPath}" -y`, { timeout: 120000 });
    const stat = fs.statSync(outPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${jobId}.mp4"`);
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', () => setTimeout(() => { try { fs.rmSync(jobDir, { recursive: true }); } catch(e) {} }, 5000));
  } catch (err) {
    try { fs.rmSync(jobDir, { recursive: true }); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('Proxy v4 running on port ' + PORT);
  console.log('Files:', fs.readdirSync(__dirname));
});
