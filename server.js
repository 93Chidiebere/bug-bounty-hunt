import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { runQAEngine } from './crawler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory registry for active scan sessions
const scans = new Map();

// Generate a random ID
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

// POST endpoint to initiate scanning
app.post('/api/start-scan', (req, res) => {
  const { url, apiKey, maxPages = 5 } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Target URL is required.' });
  }

  // Resolve API Key: check payload first, fallback to .env
  const geminiApiKey = apiKey || process.env.GEMINI_API_KEY;

  if (!geminiApiKey) {
    return res.status(400).json({ 
      error: 'Gemini API Key is missing. Provide it in the UI or set it in the backend environment.' 
    });
  }

  const scanId = generateId();
  
  // Initialize scan structure
  scans.set(scanId, {
    url,
    status: 'running',
    logs: [],
    bugs: [],
    clients: []
  });

  res.json({ scanId });

  // Run crawler asynchronously in the background
  const scanSession = scans.get(scanId);

  const broadcast = (type, data) => {
    scanSession.clients.forEach(client => {
      client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    });
  };

  const addLog = (message) => {
    const logLine = { timestamp: new Date().toISOString(), message };
    scanSession.logs.push(logLine);
    broadcast('log', logLine);
  };

  const addBug = (bug) => {
    scanSession.bugs.push(bug);
    broadcast('bug', bug);
  };

  runQAEngine({
    startUrl: url,
    geminiApiKey,
    maxPages: parseInt(maxPages) || 5,
    onLog: addLog,
    onBugFound: addBug
  }).then(() => {
    scanSession.status = 'completed';
    broadcast('status', { status: 'completed' });
    // Clean up SSE clients
    scanSession.clients.forEach(c => c.res.end());
    scanSession.clients = [];
  }).catch((err) => {
    scanSession.status = 'failed';
    const errMsg = `Scan failed: ${err.message}`;
    addLog(`[CRITICAL] ${errMsg}`);
    broadcast('status', { status: 'failed', error: err.message });
    scanSession.clients.forEach(c => c.res.end());
    scanSession.clients = [];
  });
});

// GET endpoint to subscribe to live updates via Server-Sent Events (SSE)
app.get('/api/scan-status', (req, res) => {
  const { scanId } = req.query;

  if (!scanId || !scans.has(scanId)) {
    return res.status(404).json({ error: 'Scan session not found.' });
  }

  const scanSession = scans.get(scanId);

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  // Stream current historic logs/bugs immediately
  scanSession.logs.forEach(log => {
    res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
  });

  scanSession.bugs.forEach(bug => {
    res.write(`event: bug\ndata: ${JSON.stringify(bug)}\n\n`);
  });

  // If scan is already done, end connection
  if (scanSession.status !== 'running') {
    res.write(`event: status\ndata: ${JSON.stringify({ status: scanSession.status })}\n\n`);
    clearInterval(heartbeat);
    res.end();
    return;
  }

  // Register client for real-time broadcasts
  const clientObj = { id: generateId(), res };
  scanSession.clients.push(clientObj);

  req.on('close', () => {
    clearInterval(heartbeat);
    scanSession.clients = scanSession.clients.filter(c => c.id !== clientObj.id);
  });
});

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
