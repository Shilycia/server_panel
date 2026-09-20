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

// Configurations & Workspace Directories
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

// Ensure config files exist
if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

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

// Global Middlewares
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

  // If request is for an API endpoint, return 401 JSON
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Sesi login tidak valid atau telah berakhir. Silakan login kembali.' });
  }

  // Otherwise redirect to /login
  return res.redirect('/login');
}

// Login Page
app.get('/login', (req, res) => {
  const token = req.cookies.shilycia_session;
  if (token && activeSessions.has(token)) {
    return res.redirect('/admin');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const authConfig = readJsonFile(AUTH_PATH, {
    username: 'admin',
    password: 'shilyciaDEV2026!'
  });

  if (username === authConfig.username && password === authConfig.password) {
    const sessionToken = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    activeSessions.add(sessionToken);

    res.cookie('shilycia_session', sessionToken, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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

// Dedicated Sameko Saba Maintenance Preview
app.get('/preview/maintenance', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});

// ==========================================
// 1. MULTI-PROJECT MANAGEMENT APIS
// ==========================================

// Helper to ping HTTP port
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

// Helper to calculate folder size
function getDirectorySize(dirPath, maxDepth = 2, currentDepth = 0) {
  let totalBytes = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return stats.size;
    if (currentDepth > maxDepth) return 0;

    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      if (item === '.git') continue;
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

// GET /api/projects - List all projects with live status and storage footprint
app.get('/api/projects', requireAuth, async (req, res) => {
  const projects = readJsonFile(PROJECTS_PATH, []);

  const results = await Promise.all(projects.map(async (p) => {
    const projectPath = path.isAbsolute(p.dir) ? p.dir : path.join(WORKSPACE_DIR, p.dir);
    const exists = fs.existsSync(projectPath);
    const sizeBytes = exists ? getDirectorySize(projectPath) : 0;
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);

    const ping = p.port ? await pingPort(p.port) : { online: false, latencyMs: 0 };

    return {
      ...p,
      exists,
      sizeBytes,
      sizeMB,
      online: ping.online,
      latencyMs: ping.latencyMs,
      fullPath: projectPath
    };
  }));

  res.json(results);
});

// POST /api/projects - Add a new project
app.post('/api/projects', requireAuth, (req, res) => {
  const { name, dir, port, type, startCommand, buildCommand, description } = req.body;
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
    maintenance: false,
    description: description || 'Proyek yang dikelola di VPS.',
    status: 'idle'
  };

  projects.push(newProject);
  writeJsonFile(PROJECTS_PATH, projects);
  res.json({ success: true, project: newProject });
});

// PUT /api/projects/:id - Update project
app.put('/api/projects/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const projects = readJsonFile(PROJECTS_PATH, []);
  const idx = projects.findIndex(p => p.id === id);

  if (idx === -1) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });

  projects[idx] = { ...projects[idx], ...req.body, id };
  writeJsonFile(PROJECTS_PATH, projects);
  res.json({ success: true, project: projects[idx] });
});

// DELETE /api/projects/:id - Remove project
app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  let projects = readJsonFile(PROJECTS_PATH, []);
  projects = projects.filter(p => p.id !== id);
  writeJsonFile(PROJECTS_PATH, projects);
  res.json({ success: true, message: 'Proyek berhasil dihapus dari daftar.' });
});

// POST /api/projects/:id/maintenance - Toggle maintenance for specific project
app.post('/api/projects/:id/maintenance', requireAuth, (req, res) => {
  const { id } = req.params;
  const projects = readJsonFile(PROJECTS_PATH, []);
  const project = projects.find(p => p.id === id);

  if (!project) return res.status(404).json({ error: 'Proyek tidak ditemukan.' });

  project.maintenance = !project.maintenance;
  writeJsonFile(PROJECTS_PATH, projects);

  // If this project is portfolio-web, also sync with global status.json
  if (project.id === 'portfolio-web') {
    const statusCfg = readJsonFile(STATUS_PATH, { maintenance: true });
    statusCfg.maintenance = project.maintenance;
    writeJsonFile(STATUS_PATH, statusCfg);
  }

  res.json({ success: true, maintenance: project.maintenance });
});

// ==========================================
// 2. VPS SPACE PARTITIONING & RESOURCE MONITOR
// ==========================================

// GET /api/vps/resources - System RAM, CPU, Storage Allocation
app.get('/api/vps/resources', requireAuth, (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePercent = Math.round((usedMem / totalMem) * 100);

  const cpus = os.cpus();
  const cpuCount = cpus.length;
  const cpuModel = cpus[0]?.model || 'Generic CPU';
  const loadAvg = os.loadavg();

  // Project Folder Sizes
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

  // Calculate panel size
  const panelSizeBytes = getDirectorySize(__dirname);

  // Linux df -h fallback
  exec('df -m / 2>/dev/null || wmic logicaldisk get size,freespace,caption', (err, stdout) => {
    let diskStats = { totalMB: 50000, usedMB: 22000, freeMB: 28000, usedPercent: 44 };

    if (stdout && stdout.includes('/')) {
      const lines = stdout.trim().split('\n');
      if (lines.length > 1) {
        const parts = lines[1].replace(/\s+/g, ' ').split(' ');
        const total = parseInt(parts[1]) || 50000;
        const used = parseInt(parts[2]) || 22000;
        const free = parseInt(parts[3]) || 28000;
        diskStats = {
          totalMB: total,
          usedMB: used,
          freeMB: free,
          usedPercent: Math.round((used / total) * 100)
        };
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
          name: 'shilyciaDEV Gateway & Panel',
          dir: 'server_panel',
          sizeBytes: panelSizeBytes,
          sizeMB: (panelSizeBytes / (1024 * 1024)).toFixed(1)
        }
      ]
    });
  });
});

// POST /api/vps/cleanup - Clean temp files & build cache
app.post('/api/vps/cleanup', requireAuth, (req, res) => {
  const isWin = process.platform === 'win32';
  const cleanCmd = isWin ? 'echo "Pembersihan lokal selesai"' : 'rm -rf /tmp/* ~/.npm/_cacache 2>/dev/null || echo "Done"';

  exec(cleanCmd, (err, stdout) => {
    res.json({ success: true, message: 'Pembersihan cache dan file sementara VPS selesai.' });
  });
});

// ==========================================
// 3. COMMAND CENTER & SCRIPT IMPORTER
// ==========================================

// Broadcast real-time terminal output via SSE
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

// GET /api/commands - Get saved & imported commands
app.get('/api/commands', requireAuth, (req, res) => {
  const commands = readJsonFile(COMMANDS_PATH, []);
  res.json(commands);
});

// POST /api/commands/save - Save / Import a new command or script
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

// DELETE /api/commands/:id - Delete a saved command
app.delete('/api/commands/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  let commands = readJsonFile(COMMANDS_PATH, []);
  commands = commands.filter(c => c.id !== id);
  writeJsonFile(COMMANDS_PATH, commands);
  res.json({ success: true, message: 'Perintah berhasil dihapus dari perpustakaan.' });
});

// GET /api/terminal/stream - SSE connection for live terminal stdout/stderr
app.get('/api/terminal/stream', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');
  commandSseClients.add(res);

  req.on('close', () => {
    commandSseClients.delete(res);
  });
});

// POST /api/commands/run - Run arbitrary shell command or imported script
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

  broadcastCommandLog({
    type: 'start',
    command,
    cwd: execCwd,
    timestamp: new Date().toLocaleTimeString()
  });

  const isWin = process.platform === 'win32';
  const shell = isWin ? 'powershell.exe' : '/bin/bash';

  const child = spawn(command, [], {
    cwd: execCwd,
    shell: true,
    env: { ...process.env, CI: 'false' }
  });

  activeCommandProcess = child;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    broadcastCommandLog({ type: 'stdout', text });
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    broadcastCommandLog({ type: 'stderr', text });
  });

  child.on('close', (code) => {
    const durationMs = Date.now() - startTime;
    activeCommandProcess = null;

    broadcastCommandLog({
      type: 'done',
      exitCode: code,
      durationMs
    });
  });

  res.json({ message: 'Perintah berhasil dijalankan', pid: child.pid });
});

// ==========================================
// 4. GATEWAY ROUTER & REVERSE PROXY
// ==========================================
const webProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:3000',
  changeOrigin: true,
  ws: true,
  onError: (err, req, res) => {
    if (!res.headersSent) {
      res.status(502).send(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
          <meta charset="UTF-8">
          <title>502 • Portfolio Web Offline</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen font-mono p-6">
          <div class="max-w-md bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-2xl text-center">
            <div class="text-3xl text-amber-400 mb-2">⚠️</div>
            <h1 class="text-lg font-bold text-white mb-2">502 • Layanan Port 3000 Offline</h1>
            <p class="text-xs text-slate-400 mb-6 leading-relaxed">
              Gateway mendeteksi <strong>portfolio-web</strong> belum aktif pada port 3000.
            </p>
            <div class="flex flex-col gap-2">
              <a href="/admin" class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs rounded-xl transition">
                Buka Control Panel &rarr;
              </a>
              <a href="/preview/maintenance" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl transition">
                Lihat Sameko Saba Maintenance
              </a>
            </div>
          </div>
        </body>
        </html>
      `);
    }
  }
});

// Traffic Director
app.use((req, res, next) => {
  const statusCfg = readJsonFile(STATUS_PATH, { maintenance: true });
  const isBypass = req.query.bypass === 'true' || req.query.preview === 'true';

  // If maintenance is ON and not bypassed, serve Sameko Saba Maintenance
  if (statusCfg.maintenance && !isBypass) {
    return res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
  }

  // Otherwise, route traffic transparently to Portfolio Web (Port 3000)
  return webProxy(req, res, next);
});

// Start Server
app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 shilycia's DEV Multi-Project VPS Panel is live!`);
  console.log(`📡 Public Route        : http://localhost:${PORT}`);
  console.log(`⚙️ Admin Control Panel : http://localhost:${PORT}/admin`);
  console.log(`🔑 Login Page          : http://localhost:${PORT}/login`);
  console.log(`🏖️ Maintenance Preview : http://localhost:${PORT}/preview/maintenance`);
  console.log('====================================================');
});
