const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;
const CONFIG_PATH = path.join(__dirname, 'config', 'status.json');
const WORKSPACE_DIR = path.resolve(__dirname, '..', 'portofolio_diyul');

// Active build processes & SSE listeners
let activeBuild = null;
const sseClients = new Set();

// Load / Save persistent config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('[CONFIG] Error reading status.json:', e);
  }
  return {
    maintenance: true,
    published: false,
    targetWeb: 'http://127.0.0.1:3000',
    targetApi: 'http://127.0.0.1:3001',
    remoteHost: 'http://43.173.33.116',
    lastBuild: null,
    history: []
  };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('[CONFIG] Error saving status.json:', e);
  }
}

app.use(cors());
app.use(express.json());

// Broadcast message to all active SSE subscribers
function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch (err) {
      sseClients.delete(res);
    }
  }
}

// ==========================================
// 1. STATIC ASSETS & DIRECT MAINTENANCE FILES
// ==========================================
// Serve public assets (stickers, saba background, gifs, styles)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Admin Panel route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Dedicated Maintenance Preview route
app.get('/preview/maintenance', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});

// ==========================================
// 2. API CONTROLLERS
// ==========================================

// GET /api/status - Get current system status
app.get('/api/status', (req, res) => {
  const cfg = loadConfig();
  res.json(cfg);
});

// POST /api/maintenance/toggle - Toggle Maintenance ON / OFF
app.post('/api/maintenance/toggle', (req, res) => {
  const cfg = loadConfig();
  cfg.maintenance = !cfg.maintenance;
  cfg.history = cfg.history || [];
  cfg.history.push({
    action: 'TOGGLE_MAINTENANCE',
    value: cfg.maintenance,
    timestamp: new Date().toISOString()
  });
  saveConfig(cfg);
  console.log(`[GATEWAY] Maintenance status changed to: ${cfg.maintenance ? 'ACTIVE (Sameko Saba)' : 'INACTIVE (Live)'}`);
  res.json(cfg);
});

// POST /api/publish/toggle - Toggle Publish Status
app.post('/api/publish/toggle', (req, res) => {
  const cfg = loadConfig();
  cfg.published = !cfg.published;
  cfg.history = cfg.history || [];
  cfg.history.push({
    action: 'TOGGLE_PUBLISH',
    value: cfg.published,
    timestamp: new Date().toISOString()
  });
  saveConfig(cfg);
  console.log(`[GATEWAY] Publish status changed to: ${cfg.published ? 'PUBLISHED' : 'DRAFT'}`);
  res.json(cfg);
});

// GET /api/health - Ping service endpoints
app.get('/api/health', async (req, res) => {
  const cfg = loadConfig();

  const pingUrl = (targetUrl) => {
    return new Promise((resolve) => {
      const start = Date.now();
      try {
        const u = new URL(targetUrl);
        const client = http.get({
          hostname: u.hostname,
          port: u.port || 80,
          path: '/',
          timeout: 2500
        }, (response) => {
          resolve({
            online: true,
            statusCode: response.statusCode,
            latencyMs: Date.now() - start
          });
        });
        client.on('error', () => resolve({ online: false, latencyMs: 0 }));
        client.on('timeout', () => {
          client.destroy();
          resolve({ online: false, latencyMs: 2500 });
        });
      } catch (err) {
        resolve({ online: false, latencyMs: 0 });
      }
    });
  };

  const [web, api] = await Promise.all([
    pingUrl(cfg.targetWeb || 'http://127.0.0.1:3000'),
    pingUrl(cfg.targetApi || 'http://127.0.0.1:3001')
  ]);

  res.json({ web, api });
});

// GET /api/build/logs - Server-Sent Events (SSE) Stream for real-time build output
app.get('/api/build/logs', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// POST /api/build - Trigger build for portfolio-web or portfolio-api
app.post('/api/build', (req, res) => {
  const { target } = req.body;
  const targetDirName = target === 'portfolio-api' ? 'portfolio-api' : 'portfolio-web';
  const targetPath = path.join(WORKSPACE_DIR, targetDirName);

  if (activeBuild) {
    return res.status(409).json({ error: 'Proses build lain sedang berlangsung.' });
  }

  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: `Direktori target tidak ditemukan: ${targetPath}` });
  }

  const startTime = Date.now();
  console.log(`[BUILD] Starting build in ${targetPath}...`);
  broadcastSSE({ type: 'log', stream: 'stdout', text: `[START] Menjalankan npm run build di ${targetDirName}...\n` });

  const isWin = process.platform === 'win32';
  const npmCmd = isWin ? 'npm.cmd' : 'npm';

  const child = spawn(npmCmd, ['run', 'build'], {
    cwd: targetPath,
    shell: true,
    env: { ...process.env, CI: 'false' }
  });

  activeBuild = child;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`[BUILD:STDOUT] ${text}`);
    broadcastSSE({ type: 'log', stream: 'stdout', text });
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    process.stderr.write(`[BUILD:STDERR] ${text}`);
    broadcastSSE({ type: 'log', stream: 'stderr', text });
  });

  child.on('close', (code) => {
    const durationMs = Date.now() - startTime;
    console.log(`[BUILD] Finished with code ${code} in ${(durationMs / 1000).toFixed(1)}s`);
    activeBuild = null;

    const cfg = loadConfig();
    cfg.lastBuild = {
      target: targetDirName,
      timestamp: new Date().toISOString(),
      success: code === 0,
      durationMs,
      exitCode: code
    };
    saveConfig(cfg);

    broadcastSSE({
      type: 'done',
      exitCode: code,
      durationMs
    });
  });

  res.json({ message: `Proses build ${targetDirName} dimulai`, pid: child.pid });
});

// ==========================================
// 3. REVERSE PROXY & GATEWAY ROUTER
// ==========================================
const webProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:3000',
  changeOrigin: true,
  ws: true, // forward WebSockets for Next.js HMR
  onError: (err, req, res) => {
    console.error('[PROXY ERROR]', err.message);
    if (!res.headersSent) {
      res.status(502).send(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
          <meta charset="UTF-8">
          <title>502 Bad Gateway • shilyciaDEV Gateway</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen font-mono p-6">
          <div class="max-w-md bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-2xl text-center">
            <div class="text-3xl text-amber-400 mb-2">⚠️</div>
            <h1 class="text-lg font-bold text-white mb-2">502 • Portfolio Web Belum Aktif</h1>
            <p class="text-xs text-slate-400 mb-6 leading-relaxed">
              Gateway mendeteksi <strong>portfolio-web</strong> belum berjalan pada <code>http://127.0.0.1:3000</code>.
            </p>
            <div class="flex flex-col gap-2">
              <a href="/admin" class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs rounded-xl transition">
                Buka shilyciaDEV Admin Panel &rarr;
              </a>
              <a href="/preview/maintenance" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl transition">
                Lihat Tampilan Sameko Saba Maintenance
              </a>
            </div>
          </div>
        </body>
        </html>
      `);
    }
  }
});

// Central Traffic Router:
// Determines whether to serve Sameko Saba Maintenance or forward to Portfolio Web
app.use((req, res, next) => {
  const cfg = loadConfig();

  // Allow bypass via query param: ?bypass=true or ?preview=true
  const isBypass = req.query.bypass === 'true' || req.query.preview === 'true';

  // If maintenance is enabled and user has not bypassed, serve Sameko Saba Maintenance
  if (cfg.maintenance && !isBypass) {
    return res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
  }

  // Otherwise, route traffic transparently to Portfolio Web
  return webProxy(req, res, next);
});

// Start Server
app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 shilycia's DEV Admin Gateway is running!`);
  console.log(`📡 Public Gateway Route : http://localhost:${PORT}`);
  console.log(`⚙️ Admin Control Panel  : http://localhost:${PORT}/admin`);
  console.log(`🏖️ Maintenance Preview : http://localhost:${PORT}/preview/maintenance`);
  console.log('====================================================');
});
