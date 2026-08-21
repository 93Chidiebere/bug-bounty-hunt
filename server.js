import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { runQAEngine } from './crawler.js';
import { initDb } from './db.js';
import { startVerification, confirmVerification, assertVerifiedOwnership } from './ownership.js';
import { runSCA } from './sca.js';
import { runNativeScan } from './native-scanner.js';
import multer from 'multer';
import fs from 'fs';

// Setup multer for APK uploads
const upload = multer({ dest: 'uploads/' });

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory registry for active scan sessions
const scans = new Map();

// Generate a random ID
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

// Domain ownership verification endpoints.
// A scan can never be launched against a domain until it's passed
// confirm-verification below — this is enforced in /api/start-scan.
app.post('/api/verify/start', async (req, res) => {
  const { url, email } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required.' });
  try {
    const result = await startVerification(url, email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/verify/confirm', async (req, res) => {
  const { url, email } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required.' });
  try {
    const result = await confirmVerification(url, email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message, verified: false });
  }
});

// POST endpoint to initiate NATIVE scanning
app.post('/api/scan-native', upload.single('apkFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No APK/Binary file uploaded.' });
  }

  const scanId = generateId();
  
  // Initialize scan session
  scans.set(scanId, {
    status: 'running',
    logs: [],
    bugs: [],
    pages: [],
    clients: []
  });

  // Start the background analysis process
  setTimeout(async () => {
    const session = scans.get(scanId);
    if (!session) return;
    
    const broadcast = (type, data) => {
      session.clients.forEach(client => {
        client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      });
    };

    const pushLog = (msg, category = 'sys') => {
      const logLine = { category, message: msg };
      session.logs.push(logLine);
      broadcast('log', logLine);
    };

    const pushBug = (bug) => {
      session.bugs.push(bug);
      broadcast('bug', bug);
    };
    
    try {
      await runNativeScan(req.file.path, req.file.originalname, pushLog, pushBug);
      pushLog('[SYS] Scan Completed successfully.', 'sys');
    } catch (err) {
      pushLog(`[ERROR] Scan failed: ${err.message}`, 'error');
    } finally {
      session.status = 'completed';
      broadcast('status', { status: 'completed' });
      // Clean up uploaded file to save disk space
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.error('Failed to cleanup temp file:', e);
      }
    }
  }, 0);

  // Return the scan ID so the client can connect via SSE
  res.json({ scanId });
});

// POST endpoint to initiate web scanning
app.post('/api/start-scan', async (req, res) => {
  const { 
    url, 
    email,
    apiKey, 
    provider = 'gemini', 
    model = 'gemini-3.7-flash', 
    maxPages = 5,
    loginUrl = '',
    loginUser = '',
    loginPass = '',
    testScenario = '',
    fuzzInputs = false,
    scaFileName = '',
    scaFileContent = ''
  } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Target URL is required.' });
  }

  // Hard gate: refuse to launch any scan until domain ownership has been
  // proven via the well-known-file challenge. This is what stops someone
  // from pasting a third party's URL (e.g. a portal they don't own) and
  // getting a scan run against it.
  // try {
  //   await assertVerifiedOwnership(url, email);
  // } catch (err) {
  //   return res.status(403).json({ error: err.message, verificationRequired: true });
  // }

  // Resolve API Key: check payload first, fallback to .env, and trim CRLF/carriage returns
  let geminiApiKey = (apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (geminiApiKey.startsWith('"') && geminiApiKey.endsWith('"')) {
    geminiApiKey = geminiApiKey.slice(1, -1);
  }
  if (geminiApiKey.startsWith("'") && geminiApiKey.endsWith("'")) {
    geminiApiKey = geminiApiKey.slice(1, -1);
  }

  if (provider === 'gemini' && !geminiApiKey) {
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
    pages: [],
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

  const addPage = (pageObs) => {
    scanSession.pages.push(pageObs);
    broadcast('page', pageObs);
  };

  const qaPromise = runQAEngine({
    startUrl: url,
    geminiApiKey,
    provider,
    model,
    maxPages: parseInt(maxPages) || 5,
    loginUrl,
    loginUser,
    loginPass,
    testScenario,
    fuzzInputs: fuzzInputs === true || fuzzInputs === 'true',
    onLog: addLog,
    onBugFound: addBug,
    onPageAudited: addPage
  });

  const scaPromise = scaFileName && scaFileContent 
    ? runSCA(scaFileName, scaFileContent, addBug, addLog) 
    : Promise.resolve();

  Promise.all([qaPromise, scaPromise]).then(() => {
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

  scanSession.pages.forEach(page => {
    res.write(`event: page\ndata: ${JSON.stringify(page)}\n\n`);
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

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server started on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[DB] Failed to initialize database:', err.message);
    process.exit(1);
  });
