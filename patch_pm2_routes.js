const fs = require('fs');

const PM2_ROUTES = `
// ==========================================
// 3.5. PM2 & LOGS MANAGER (Phase 7)
// ==========================================
app.get('/api/pm2/list', requireAuth, (req, res) => {
  execFile('pm2', ['jlist'], (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch PM2 processes', details: stderr });
    }
    try {
      const pm2Data = JSON.parse(stdout);
      const processes = pm2Data.map(proc => ({
        id: proc.pm_id,
        name: proc.name,
        pid: proc.pid,
        status: proc.pm2_env.status,
        memory: proc.monit ? Math.round(proc.monit.memory / 1024 / 1024) : 0, // MB
        cpu: proc.monit ? proc.monit.cpu : 0,
        uptime: proc.pm2_env.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
        instances: proc.pm2_env.instances,
        restarts: proc.pm2_env.restart_time,
        logOut: proc.pm2_env.pm_out_log_path,
        logErr: proc.pm2_env.pm_err_log_path,
      }));
      res.json(processes);
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse PM2 jlist output' });
    }
  });
});

app.post('/api/pm2/action', requireAuth, (req, res) => {
  const { action, id } = req.body;
  
  if (!['start', 'stop', 'restart', 'reload'].includes(action)) {
    return res.status(400).json({ error: 'Invalid PM2 action' });
  }

  // Validate ID format (number or alphanumeric for name)
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid PM2 process ID or Name' });
  }

  execFile('pm2', [action, id], (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: \`PM2 \${action} failed\`, details: stderr });
    }
    res.json({ success: true, message: \`Berhasil melakukan \${action} pada \${id}\` });
  });
});

app.get('/api/logs/view', requireAuth, (req, res) => {
  const { path: logPath, lines = 100 } = req.query;

  // Basic security constraint to ensure we only read log files
  if (!logPath || !logPath.endsWith('.log')) {
    return res.status(400).json({ error: 'Path log tidak valid. Harus berekstensi .log' });
  }

  // Double check path traversal
  if (logPath.includes('..') || logPath.includes('\\0')) {
    return res.status(403).json({ error: 'Path traversal tidak diizinkan' });
  }

  if (!fs.existsSync(logPath)) {
    return res.status(404).json({ error: 'File log tidak ditemukan' });
  }

  execFile('tail', ['-n', parseInt(lines) || 100, logPath], (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Gagal membaca log', details: stderr });
    }
    res.send(stdout);
  });
});

// ==========================================
// 4. GATEWAY ROUTER - Per-Project Status Routing`;

let code = fs.readFileSync('server.js', 'utf8');

// Ensure normalization
code = code.replace(/\r\n/g, '\n');
const targetRegex = /\/\/\s*==========================================\n\/\/\s*4\.\s*GATEWAY ROUTER \-\s*Per\-Project Status Routing/;
if (targetRegex.test(code)) {
  code = code.replace(targetRegex, () => PM2_ROUTES);
  fs.writeFileSync('server.js', code);
  console.log("PM2 API Routes added successfully.");
} else {
  console.log("Target anchor not found!");
}
