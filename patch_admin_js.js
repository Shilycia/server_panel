const fs = require('fs');

const PM2_JS = `
    // ==========================================
    // PM2 & LOGS LOGIC (Phase 7)
    // ==========================================
    let currentLogPath = '';
    
    async function loadPM2Data() {
      const container = document.getElementById('pm2Container');
      if (!container) return;
      
      try {
        container.innerHTML = '<div class="text-center py-10 text-slate-500 font-mono text-sm col-span-2">Memuat data proses PM2...</div>';
        const res = await fetch('/api/pm2/list');
        const processes = await res.json();
        
        if (processes.length === 0) {
          container.innerHTML = '<div class="text-center py-10 text-slate-500 font-mono text-sm col-span-2">Tidak ada proses PM2 yang berjalan.</div>';
          return;
        }

        let html = '';
        processes.forEach(proc => {
          const isOnline = proc.status === 'online';
          const statusColor = isOnline ? 'emerald' : (proc.status === 'stopped' ? 'amber' : 'rose');
          const statusPulse = isOnline ? 'animate-pulse' : '';
          
          html += \`
            <div class="bg-slate-900/70 backdrop-blur-md rounded-2xl border border-slate-800 p-5 shadow-xl flex flex-col justify-between">
              <div class="flex items-start justify-between mb-4">
                <div>
                  <h3 class="text-lg font-bold text-white font-mono">\${proc.name}</h3>
                  <div class="text-xs text-slate-400 font-mono mt-1">PID: \${proc.pid || '-'} | ID: \${proc.id}</div>
                </div>
                <span class="px-2.5 py-1 rounded-full text-[10px] uppercase font-mono font-bold bg-\${statusColor}-950 text-\${statusColor}-400 border border-\${statusColor}-500/40 flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-\${statusColor}-400 \${statusPulse}"></span>
                  \${proc.status}
                </span>
              </div>
              
              <div class="grid grid-cols-2 gap-2 mb-4 font-mono text-xs">
                <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex flex-col gap-1">
                  <span class="text-slate-500">Memori (RAM)</span>
                  <span class="text-cyan-300 font-bold">\${proc.memory} MB</span>
                </div>
                <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex flex-col gap-1">
                  <span class="text-slate-500">CPU Usage</span>
                  <span class="text-sky-300 font-bold">\${proc.cpu}%</span>
                </div>
                <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex flex-col gap-1">
                  <span class="text-slate-500">Uptime</span>
                  <span class="text-slate-300">\${Math.round(proc.uptime / 1000 / 60)} mnt</span>
                </div>
                <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex flex-col gap-1">
                  <span class="text-slate-500">Restart</span>
                  <span class="text-amber-300">\${proc.restarts}x</span>
                </div>
              </div>

              <div class="flex flex-wrap gap-2 font-mono text-[11px]">
                <button onclick="actionPM2('restart', '\${proc.id}')" class="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex justify-center items-center gap-1 transition">
                  <span class="material-symbols-outlined text-sm">restart_alt</span> Restart
                </button>
                \${isOnline ? 
                  \`<button onclick="actionPM2('stop', '\${proc.id}')" class="flex-1 py-2 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-900 flex justify-center items-center gap-1 transition">
                    <span class="material-symbols-outlined text-sm">stop_circle</span> Stop
                  </button>\` : 
                  \`<button onclick="actionPM2('start', '\${proc.id}')" class="flex-1 py-2 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-900 flex justify-center items-center gap-1 transition">
                    <span class="material-symbols-outlined text-sm">play_arrow</span> Start
                  </button>\`
                }
              </div>
              <div class="flex gap-2 mt-2 font-mono text-[11px]">
                <button onclick="openLogViewer('\${proc.logOut}', '\${proc.name} (Output)')" class="flex-1 py-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-cyan-400 border border-slate-800 flex justify-center items-center gap-1 transition">
                  <span class="material-symbols-outlined text-sm">receipt_long</span> Log Output
                </button>
                <button onclick="openLogViewer('\${proc.logErr}', '\${proc.name} (Error)')" class="flex-1 py-2 rounded-lg bg-slate-950 hover:bg-rose-950 text-rose-400 border border-slate-800 flex justify-center items-center gap-1 transition">
                  <span class="material-symbols-outlined text-sm">error</span> Log Error
                </button>
              </div>
            </div>
          \`;
        });
        container.innerHTML = html;
      } catch (err) {
        container.innerHTML = '<div class="text-center py-10 text-rose-500 font-mono text-sm col-span-2">Gagal memuat data PM2.</div>';
      }
    }

    async function actionPM2(action, id) {
      if (!confirm(\`Apakah Anda yakin ingin \${action} proses PM2 ini?\`)) return;
      try {
        const res = await fetch('/api/pm2/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, id })
        });
        const data = await res.json();
        if (data.success) {
          alert(data.message);
          loadPM2Data();
        } else {
          alert(data.error || 'Terjadi kesalahan');
        }
      } catch (err) {
        alert('Gagal menghubungi server.');
      }
    }

    function openLogViewer(logPath, title) {
      currentLogPath = logPath;
      document.getElementById('logViewerTitle').innerText = title;
      document.getElementById('logViewerModal').classList.remove('hidden');
      refreshCurrentLog();
    }

    function closeLogViewerModal() {
      document.getElementById('logViewerModal').classList.add('hidden');
      currentLogPath = '';
    }

    async function refreshCurrentLog() {
      if (!currentLogPath) return;
      const contentEl = document.getElementById('logViewerContent');
      contentEl.innerText = 'Memuat log...';
      try {
        const res = await fetch(\`/api/logs/view?path=\${encodeURIComponent(currentLogPath)}&lines=100\`);
        if (!res.ok) {
          const err = await res.json();
          contentEl.innerText = err.error || 'Gagal memuat log.';
          return;
        }
        const text = await res.text();
        contentEl.innerText = text || '(Log kosong)';
        contentEl.scrollTop = contentEl.scrollHeight;
      } catch (err) {
        contentEl.innerText = 'Gagal menghubungi server.';
      }
    }

    // Auto refresh hook
    const originalSwitchTab = switchTab;
    switchTab = function(tabId) {
      originalSwitchTab(tabId);
      if (tabId === 'pm2') loadPM2Data();
    };
</script>`;

let html = fs.readFileSync('public/admin.html', 'utf8');
html = html.replace('</script>', PM2_JS);
fs.writeFileSync('public/admin.html', html);
console.log("JS injected.");
