const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(/\r\n/g, '\n');

code = code.replace(
  "const cookieParser = require('cookie-parser');",
  () => "const cookieParser = require('cookie-parser');\nconst helmet = require('helmet');\nconst rateLimit = require('express-rate-limit');\nconst bcrypt = require('bcrypt');\nconst crypto = require('crypto');"
);

code = code.replace(
  "const { spawn, exec } = require('child_process');",
  () => "const { execFile, exec } = require('child_process');"
);

code = code.replace(
  /app\.use\(cors\(\)\);\napp\.use\(express\.json\(\)\);\napp\.use\(cookieParser\('shilycia_session_secret_signature'\)\);/g,
  () => `app.set('trust proxy', 1);

const allowedOrigins = ['http://nadyakhiarapurnomo.my.id', 'https://nadyakhiarapurnomo.my.id', 'http://localhost:8080', 'http://127.0.0.1:8080'];
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.json());
app.use(cookieParser('shilycia_session_secret_signature'));

// CSRF Protection Middleware
function csrfProtection(req, res, next) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (!origin && !referer) {
      if (req.path === '/api/auth/login') return next();
      return res.status(403).json({error: 'CSRF validation failed: No origin/referer'});
    }
    const validOrigin = allowedOrigins.some(o => (origin && origin.startsWith(o)) || (referer && referer.startsWith(o)));
    if (!validOrigin) return res.status(403).json({error: 'CSRF validation failed: Invalid origin/referer'});
  }
  next();
}
app.use(csrfProtection);

const AUDIT_LOG_PATH = path.join(CONFIG_DIR, 'audit.log');
function logAudit(user, action, details, ip) {
  const timestamp = new Date().toISOString();
  const logLine = \`[\${timestamp}] USER:\${user} IP:\${ip} ACTION:\${action} DETAILS:\${details}\\n\`;
  fs.appendFileSync(AUDIT_LOG_PATH, logLine);
}
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const user = (req.cookies && req.cookies.shilycia_session) ? 'admin' : 'guest';
    logAudit(user, req.method, req.originalUrl, req.ip);
  }
  next();
});`
);

code = code.replace(
  "app.post('/api/auth/login', (req, res) => {",
  () => `const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Terlalu banyak percobaan login, coba lagi setelah 15 menit.' }
});
app.post('/api/auth/login', loginLimiter, (req, res) => {`
);

code = code.replace(
  "  if (username === authConfig.username && password === authConfig.password) {\n    const sessionToken = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);",
  () => `  if (!authConfig.password.startsWith('$2b$')) {
    authConfig.password = bcrypt.hashSync(authConfig.password, 10);
    writeJsonFile(AUTH_PATH, authConfig);
  }
  const isMatch = bcrypt.compareSync(password, authConfig.password);
  if (username === authConfig.username && isMatch) {
    const sessionToken = crypto.randomBytes(32).toString('hex');`
);

code = code.replace(
  "    res.cookie('shilycia_session', sessionToken, {\n      httpOnly: true,\n      maxAge: 7 * 24 * 60 * 60 * 1000,\n      sameSite: 'lax'\n    });",
  () => `    res.cookie('shilycia_session', sessionToken, {
      httpOnly: true,
      secure: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'strict'
    });`
);

code = code.replace(
  "  if (currentPassword !== authConfig.password) {\n    return res.status(400).json({ error: 'Password saat ini salah.' });\n  }\n\n  if (newUsername && newUsername.trim()) authConfig.username = newUsername.trim();\n  if (newPassword && newPassword.length >= 6) authConfig.password = newPassword;",
  () => `  const isMatch = bcrypt.compareSync(currentPassword, authConfig.password);
  if (!isMatch) {
    return res.status(400).json({ error: 'Password saat ini salah.' });
  }
  if (newUsername && newUsername.trim()) authConfig.username = newUsername.trim();
  if (newPassword && newPassword.length >= 6) authConfig.password = bcrypt.hashSync(newPassword, 10);`
);

code = code.replace(
  "  const child = spawn(command, [], {\n    cwd: execCwd,\n    shell: true,\n    env: { ...process.env, CI: 'false' }\n  });",
  () => `  const projects = readJsonFile(PROJECTS_PATH, []);
  const allowedDirs = projects.map(p => path.isAbsolute(p.dir) ? path.resolve(p.dir) : path.resolve(WORKSPACE_DIR, p.dir));
  allowedDirs.push(path.resolve(WORKSPACE_DIR));
  allowedDirs.push(path.resolve(__dirname));
  
  const resolvedCwd = path.resolve(execCwd);
  if (!allowedDirs.some(dir => resolvedCwd.startsWith(dir))) {
    return res.status(403).json({ error: 'Direktori kerja tidak diizinkan.' });
  }

  const args = command.match(/(?:[^\\s"]+|"[^"]*")+/g).map(s => s.replace(/^"|"$/g, ''));
  const executable = args.shift();

  const child = execFile(executable, args, {
    cwd: execCwd,
    shell: false,
    env: { ...process.env, CI: 'false' }
  });
  child.on('error', (err) => broadcastCommandLog({ type: 'stderr', text: 'Error executing file: ' + err.message }));`
);

code = code.replace("app.listen(PORT, () => {", () => "app.listen(PORT, '127.0.0.1', () => {");

fs.writeFileSync('server.js', code);
console.log('patched successfully');
