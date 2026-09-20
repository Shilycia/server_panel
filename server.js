const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec } = require('child_process');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// CONFIG PATHS
// ==========================================
const CONFIG_DIR = path.join(__dirname, 'config');
const STATUS_PATH = path.join(CONFIG_DIR, 'status.json');
const AUTH_PATH = path.join(CONFIG_DIR, 'auth.json');
const PROJECTS_PATH = path.join(CONFIG_DIR, 'projects.json');
const COMMANDS_PATH = path.join(CONFIG_DIR, 'commands.json');

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || (
  fs.existsSync(path.resolve(__dirname, '..', 'prototype_porto'))
    ? path.resolve(__dirname, '..', 'prototype_porto')
    : path.resolve(__dirname, '..', 'portofolio_diyul')
);

// In-Memory Active Sessions & Real-time Command SSE streams
const activeSessions = new Set();
let activeCommandProcess = null;
const commandSseClients = new Set();

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

// ==========================================
// HELPERS
// ==========================================
function readJsonFile(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error(`[CONFIG] Error reading ${filePath}:`, err.message);
  }
  return defaultValue;
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[CONFIG] Error writing ${filePath}:`, err.message);
  }
}

// Valid deploy statuses
const VALID_STATUSES = ['production', 'maintenance', 'build'];

// Proxy cache: port → proxy middleware
const proxyCache = {};
function getOrCreateProxy(port) {
  if (!proxyCache[port]) {
    proxyCache[port] = createProxyMiddleware({
      target: `http://127.0.0.1:${port}`,
      changeOrigin: true,
      ws: true,
      onError: (err, req, res) => {
        if (!res.headersSent) {
          res.status(502).sendFile(path.join(__dirname, 'public', '502.html'), () => {
            // fallback inline if file doesn't exist
            if (!res.headersSent) {
              res.status(502).send(`<h1>502 — Port ${port} Offline</h1>`);
            }
          });
        }
      }
    });
  }
  return proxyCache[port];
}

// ==========================================
// GLOBAL MIDDLEWARES
// ==========================================
app.use(cors());
app.use(express.json());
app.use(cookieParser('shilycia_session_secret_signature'));

// ==========================================
// AUTHENTICATION SYSTEM
// ==========================================
function requireAuth(req, res, next) {
  const token = req.cookies.shilycia_session || req.headers.authorization?.replace('Bearer ', '');
  if (token && activeSessions.has(token)) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Sesi login tidak valid atau telah berakhir. Silakan login kembali.' });
  }
  return res.redirect('/login');
}

// Login Page
app.get('/login', (req, res) => {
  const token = req.cookies.shilycia_session;
  if (token && activeSessions.has(token)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const authConfig = readJsonFile(AUTH_PATH, { username: 'admin', password: 'shilyciaDEV2026!' });

  if (username === authConfig.username && password === authConfig.password) {
    const sessionToken = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    activeSessions.add(sessionToken);

    res.cookie('shilycia_session', sessionToken, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });

    return res.json({ success: true, message: 'Login berhasil', username });
  }

  return res.status(401).json({ success: false, error: 'Username atau password salah.' });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.shilycia_session;
  if (token) activeSessions.delete(token);
  res.clearCookie('shilycia_session');
  res.json({ success: true, message: 'Logout berhasil' });
});

// GET /api/auth/check
app.get('/api/auth/check', (req, res) => {
  const token = req.cookies.shilycia_session;
  const isLoggedIn = !!(token && activeSessions.has(token));
  res.json({ isLoggedIn });
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body;
  const authConfig = readJsonFile(AUTH_PATH, { username: 'admin', password: 'shilyciaDEV2026!' });

  if (currentPassword !== authConfig.password) {
    return res.status(400).json({ error: 'Password saat ini salah.' });
  }

  if (newUsername && newUsername.trim()) authConfig.username = newUsername.trim();
  if (newPassword && newPassword.length >= 6) authConfig.password = newPassword;

  writeJsonFile(AUTH_PATH, authConfig);
  res.json({ success: true, message: 'Kredensial login berhasil diperbarui.' });
});

// ==========================================
// STATIC ASSETS & PUBLIC PREVIEWS
// ==========================================
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Admin Control Panel (Protected)
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Preview endpoints (public, no auth)
app.get('/preview/maintenance', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});
app.get('/preview/building', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'building.html'));
});

// ==========================================
// 1. MULTI-PROJECT MANAGEMENT APIS
// ==========================================

function pingPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const start = Date.now();
    const client = http.get({ hostname: host, port, path: '/', timeout: 1500 }, (r) => {
      resolve({ online: true, statusCode: r.statusCode, latencyMs: Date.now() - start });
    });
    client.on('error', () => resolve({ online: false, latencyMs: 0 }));
    client.on('timeout', () => { client.destroy(); resolve({ online: false, latencyMs: 1500 }); });
  });
}

function getDirectorySize(dirPath, maxDepth = 2, currentDepth = 0) {
  let totalBytes = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return stats.size;
    if (currentDepth > maxDepth) return 0;
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      if (item === '.git' || item === 'node_modules') continue;
      const fullPath = path.join(dirPath, item);
      try {
        const itemStat = fs.statSync(fullPath);
        if (itemStat.isDirectory()) {
          totalBytes += getDirectorySize(fullPath, maxDepth, currentDepth + 1);
        } else {
          totalBytes += itemStat.size;
        }
      } catch {}
    }
  } catch {}
  return totalBytes;
}

// GET /api/projects - List all projects with live status
app.get('/api/projects', requireAuth, async (req, res) => {
  const projects = readJsonFile(PROJECTS_PATH, []);

  const results = await Promise.all(projects.map(async (p) => {
    const projectPath = path.isAbsolute(p.dir) ? p.dir : path.join(WORKSPACE_DIR, p.dir);
    const exists = fs.existsSync(projectPath);
    const sizeBytes = exists ? getDirectorySize(projectPath) : 0;
    const ping = p.port ? await pingPort(p.port) : { online: false, latencyMs: 0 };

    return {
      ...p,
      deployStatus: p.deployStatus || 'production',
      exists,
      sizeBytes,
      sizeMB: (sizeBytes / (1024 * 1024)).toFixed(1),
      online: ping.online,
      latencyMs: ping.latencyMs,
      fullPath: projectPath
    };
  }));

  res.json(results);
});

// POST /api/projects - Add a new project
app.post('/api/projects', requireAuth, (req, res) => {
  const { name, dir, port, type, startCommand, buildCommand, description, deployStatus, domain } = req.body;
  if (!name || !dir) {
    return res.status(400).json({ error: 'Nama dan direktori proyek wajib diisi.' });
  }

  const projects = readJsonFile(PROJECTS_PATH, []);
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.floor(Math.random() * 1000);

  const newProject = {
    id,
    name,
    type: type || 'Custom Project',
    dir,
    port: port ? parseInt(port) : null,
    pm2Name: id,
    buildCommand: buildCommand || 'npm run build',
    startCommand: startCommand || 'npm start',
    deployStatus: VALID_STATUSES.includes(deployStatus) ? deployStatus : 'production',
    description: description || 'Proyek yang dikelola di VPS.',
    domain: domain || '',
    isDefault: false
  };

  projects.push(newProject);
  writeJsonFile(PROJECTS_PATH, projects);
  res.json({ success: true, project: newProject });
});

// PUT /api/projects/:id - Update project metadata
app.put('/api/projects/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const projects = readJsonFile(PROJECTS_PATH, []);
  const idx = projects.findIndex(p => p.id === id);

  if (idx === -1) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });

  // Preserve id and validate deployStatus if provided
  const update = { ...req.body, id };
  if (update.deployStatus && !VALID_STATUSES.includes(update.deployStatus)) {
    delete update.deployStatus;
  }

  projects[idx] = { ...projects[idx], ...update };
  writeJsonFile(PROJECTS_PATH, projects);
  res.json({ success: true, project: projects[idx] });
});

// DELETE /api/projects/:id - Remove project from list
app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  let projects = readJsonFile(PROJECTS_PATH, []);
  projects = projects.filter(p => p.id !== id);
  writeJsonFile(PROJECTS_PATH, projects);
  res.json({ success: true, message: 'Proyek berhasil dihapus dari daftar.' });
});

// POST /api/projects/:id/status - Change deployStatus (production | maintenance | build)
app.post('/api/projects/:id/status', requireAuth, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `Status tidak valid. Gunakan salah satu: ${VALID_STATUSES.join(', ')}`
    });
  }

  const projects = readJsonFile(PROJECTS_PATH, []);
  const project = projects.find(p => p.id === id);

  if (!project) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });

  const previousStatus = project.deployStatus;
  project.deployStatus = status;
  writeJsonFile(PROJECTS_PATH, projects);

  console.log(`[GATEWAY] Project "${project.name}" status changed: ${previousStatus} → ${status}`);

  res.json({
    success: true,
    project: project.id,
    name: project.name,
    previousStatus,
    deployStatus: status,
    message: `Status proyek "${project.name}" diubah ke "${status}".`
  });
});

// POST /api/projects/:id/set-default - Set a project as the default gateway target
app.post('/api/projects/:id/set-default', requireAuth, (req, res) => {
  const { id } = req.params;
  const projects = readJsonFile(PROJECTS_PATH, []);
  const project = projects.find(p => p.id === id);

  if (!project) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });

  projects.forEach(p => { p.isDefault = (p.id === id); });
  writeJsonFile(PROJECTS_PATH, projects);

  res.json({ success: true, message: `Proyek "${project.name}" ditetapkan sebagai default gateway.` });
});

// ==========================================
// 2. VPS SPACE PARTITIONING & RESOURCE MONITOR
// ==========================================

app.get('/api/vps/resources', requireAuth, (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePercent = Math.round((usedMem / totalMem) * 100);

  const cpus = os.cpus();
  const cpuCount = cpus.length;
  const cpuModel = cpus[0]?.model || 'Generic CPU';
  const loadAvg = os.loadavg();

  const projects = readJsonFile(PROJECTS_PATH, []);
  const projectSpaces = projects.map(p => {
    const pPath = path.isAbsolute(p.dir) ? p.dir : path.join(WORKSPACE_DIR, p.dir);
    const exists = fs.existsSync(pPath);
    const sizeBytes = exists ? getDirectorySize(pPath) : 0;
    return {
      id: p.id,
      name: p.name,
      dir: p.dir,
      sizeBytes,
      sizeMB: (sizeBytes / (1024 * 1024)).toFixed(1)
    };
  });

  const panelSizeBytes = getDirectorySize(__dirname);

  exec('df -m / 2>/dev/null || wmic logicaldisk get size,freespace,caption', (err, stdout) => {
    let diskStats = { totalMB: 50000, usedMB: 22000, freeMB: 28000, usedPercent: 44 };

    if (stdout && stdout.includes('/')) {
      const lines = stdout.trim().split('\n');
      if (lines.length > 1) {
        const parts = lines[1].replace(/\s+/g, ' ').split(' ');
        const total = parseInt(parts[1]) || 50000;
        const used = parseInt(parts[2]) || 22000;
        const free = parseInt(parts[3]) || 28000;
        diskStats = { totalMB: total, usedMB: used, freeMB: free, usedPercent: Math.round((used / total) * 100) };
      }
    }

    res.json({
      system: {
        platform: os.platform(),
        hostname: os.hostname(),
        uptimeSeconds: Math.floor(os.uptime()),
        cpuCount,
        cpuModel,
        cpuLoad: loadAvg[0].toFixed(2)
      },
      memory: {
        totalMB: Math.round(totalMem / (1024 * 1024)),
        usedMB: Math.round(usedMem / (1024 * 1024)),
        freeMB: Math.round(freeMem / (1024 * 1024)),
        usedPercent: memUsagePercent
      },
      disk: diskStats,
      projectSpaces: [
        ...projectSpaces,
        {
          id: 'server_panel',
          name: "shilycia's DEV Gateway & Panel",
          dir: 'server_panel',
          sizeBytes: panelSizeBytes,
          sizeMB: (panelSizeBytes / (1024 * 1024)).toFixed(1)
        }
      ]
    });
  });
});

app.post('/api/vps/cleanup', requireAuth, (req, res) => {
  const isWin = process.platform === 'win32';
  const cleanCmd = isWin
    ? 'echo "Pembersihan lokal selesai"'
    : 'rm -rf /tmp/* ~/.npm/_cacache 2>/dev/null || echo "Done"';

  exec(cleanCmd, () => {
    res.json({ success: true, message: 'Pembersihan cache dan file sementara VPS selesai.' });
  });
});

// ==========================================
// 3. COMMAND CENTER & SCRIPT IMPORTER
// ==========================================

function broadcastCommandLog(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of commandSseClients) {
    try {
      client.write(msg);
    } catch {
      commandSseClients.delete(client);
    }
  }
}

app.get('/api/commands', requireAuth, (req, res) => {
  res.json(readJsonFile(COMMANDS_PATH, []));
});

app.post('/api/commands/save', requireAuth, (req, res) => {
  const { name, description, command, targetDir, category } = req.body;
  if (!name || !command) {
    return res.status(400).json({ error: 'Nama dan perintah shell wajib diisi.' });
  }

  const commands = readJsonFile(COMMANDS_PATH, []);
  const id = 'cmd-' + Math.random().toString(36).substring(2, 8);

  const newCmd = {
    id,
    name,
    description: description || 'Perintah shell kustom',
    command,
    targetDir: targetDir || '.',
    category: category || 'custom',
    createdAt: new Date().toISOString()
  };

  commands.push(newCmd);
  writeJsonFile(COMMANDS_PATH, commands);
  res.json({ success: true, command: newCmd });
});

app.delete('/api/commands/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  let commands = readJsonFile(COMMANDS_PATH, []);
  commands = commands.filter(c => c.id !== id);
  writeJsonFile(COMMANDS_PATH, commands);
  res.json({ success: true, message: 'Perintah berhasil dihapus dari perpustakaan.' });
});

app.get('/api/terminal/stream', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');
  commandSseClients.add(res);
  req.on('close', () => commandSseClients.delete(res));
});

app.post('/api/commands/run', requireAuth, (req, res) => {
  const { command, cwd: customCwd } = req.body;
  if (!command || !command.trim()) {
    return res.status(400).json({ error: 'Perintah tidak boleh kosong.' });
  }

  if (activeCommandProcess) {
    return res.status(409).json({ error: 'Sebuah perintah lain masih berjalan di terminal.' });
  }

  const execCwd = customCwd && fs.existsSync(customCwd) ? customCwd : WORKSPACE_DIR;
  const startTime = Date.now();

  broadcastCommandLog({ type: 'start', command, cwd: execCwd, timestamp: new Date().toLocaleTimeString() });

  const child = spawn(command, [], {
    cwd: execCwd,
    shell: true,
    env: { ...process.env, CI: 'false' }
  });

  activeCommandProcess = child;

  child.stdout.on('data', (chunk) => broadcastCommandLog({ type: 'stdout', text: chunk.toString() }));
  child.stderr.on('data', (chunk) => broadcastCommandLog({ type: 'stderr', text: chunk.toString() }));
  child.on('close', (code) => {
    activeCommandProcess = null;
    broadcastCommandLog({ type: 'done', exitCode: code, durationMs: Date.now() - startTime });
  });

  res.json({ message: 'Perintah berhasil dijalankan', pid: child.pid });
});

// ==========================================
// 4. GATEWAY ROUTER — Per-Project Status Routing
// ==========================================

// Proxy & Static Caches
const staticCache = {};
function getOrCreateStatic(dir) {
  if (!staticCache[dir]) {
    staticCache[dir] = express.static(dir);
  }
  return staticCache[dir];
}

app.use((req, res, next) => {
  // Skip internal panel routes
  const panelRoutes = ['/admin', '/login', '/api/', '/preview/', '/_next/', '/stickers/', '/favicon'];
  if (panelRoutes.some(r => req.path.startsWith(r))) return next();

  // Admin bypass
  const isBypass = req.query.bypass === 'admin';
  if (isBypass) return next();

  const projects = readJsonFile(PROJECTS_PATH, []);

  // 1. Find target project by Domain (Host header)
  const host = (req.hostname || '').replace(/^www\./, '');
  let targetProject = projects.find(p => {
    if (!p.domain) return false;
    const cleanDomain = p.domain.replace(/^www\./, '');
    return cleanDomain === host;
  });

  // 2. Fallback to default project if no domain matches
  if (!targetProject) {
    targetProject = projects.find(p => p.isDefault) || projects.find(p => p.port) || null;
  }

  if (!targetProject) {
    return res.status(503).send(`
      <!DOCTYPE html>
      <html lang="id">
      <head><meta charset="UTF-8"><title>Tidak Ada Proyek Aktif</title>
      <script src="https://cdn.tailwindcss.com"></script></head>
      <body class="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen font-mono">
        <div class="text-center max-w-sm">
          <span class="material-symbols-rounded text-5xl text-amber-400 block mb-4">lan</span>
          <h1 class="text-xl font-bold mb-2">Belum Ada Proyek Terdaftar</h1>
          <p class="text-slate-400 text-sm mb-6">Tambahkan proyek melalui panel untuk memulai routing.</p>
          <a href="/admin" class="px-4 py-2 bg-cyan-500 text-slate-950 font-bold rounded-xl text-sm">Buka Panel →</a>
        </div>
      </body></html>
    `);
  }

  const deployStatus = targetProject.deployStatus || 'production';

  if (deployStatus === 'maintenance') {
    console.log(`[GATEWAY] [${host}] → Project "${targetProject.name}" → MAINTENANCE`);
    return res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
  }

  if (deployStatus === 'build') {
    console.log(`[GATEWAY] [${host}] → Project "${targetProject.name}" → BUILD`);
    return res.sendFile(path.join(__dirname, 'public', 'building.html'));
  }

  // production → proxy to port OR serve static HTML
  if (targetProject.type === 'Static HTML' || targetProject.port === 80 || !targetProject.port) {
    const pPath = path.isAbsolute(targetProject.dir) ? targetProject.dir : path.join(WORKSPACE_DIR, targetProject.dir);
    console.log(`[GATEWAY] [${host}] → Project "${targetProject.name}" → STATIC (${pPath})`);
    return getOrCreateStatic(pPath)(req, res, () => {
      // If static file not found, fallback to index.html (SPA)
      res.sendFile(path.join(pPath, 'index.html'));
    });
  }

  if (targetProject.port) {
    console.log(`[GATEWAY] [${host}] → Project "${targetProject.name}" → PROXY :${targetProject.port}`);
    return getOrCreateProxy(targetProject.port)(req, res, next);
  }

  next();
});

// 502 inline fallback (if 502.html doesn't exist yet)
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 shilycia's DEV Multi-Project VPS Panel`);
  console.log(`📡 Gateway Route       : http://localhost:${PORT}`);
  console.log(`⚙️  Admin Control Panel : http://localhost:${PORT}/admin`);
  console.log(`🔑 Login Page          : http://localhost:${PORT}/login`);
  console.log(`🏖️  Maintenance Preview : http://localhost:${PORT}/preview/maintenance`);
  console.log(`🔨 Building Preview    : http://localhost:${PORT}/preview/building`);
  console.log('====================================================');
});
