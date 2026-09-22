const fs = require('fs');

const PM2_TAB = `
    <!-- ============================================================== -->
    <!-- TAB 4.5: PM2 & LOGS MANAGER -->
    <!-- ============================================================== -->
    <div id="tabContent-pm2" class="tab-pane hidden space-y-6">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/70 backdrop-blur-md p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <span class="material-symbols-outlined text-cyan-400">memory</span>
            <span>PM2 Process & Log Manager</span>
          </h2>
          <p class="text-xs text-slate-400 mt-1">Pantau dan kelola proses *background* server Anda serta baca *live logs*.</p>
        </div>
        <button 
          onclick="loadPM2Data()" 
          class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-mono font-bold transition flex items-center gap-1.5 border border-cyan-500/40 cursor-pointer"
        >
          <span class="material-symbols-outlined text-base">refresh</span>
          <span>Refresh Daftar Proses</span>
        </button>
      </div>

      <div id="pm2Container" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Injected via JavaScript -->
        <div class="text-center py-10 text-slate-500 font-mono text-sm col-span-2">Memuat daftar proses PM2...</div>
      </div>
    </div>

    <!-- ============================================================== -->
    <!-- TAB 5: SETTINGS & SECURITY -->`;

let html = fs.readFileSync('public/admin.html', 'utf8');
const anchor = "<!-- ============================================================== -->\r\n    <!-- TAB 5: SETTINGS & SECURITY -->";
const anchor2 = "<!-- ============================================================== -->\n    <!-- TAB 5: SETTINGS & SECURITY -->";

if (html.includes(anchor)) {
  html = html.replace(anchor, PM2_TAB);
} else if (html.includes(anchor2)) {
  html = html.replace(anchor2, PM2_TAB);
} else {
  // Regex fallback
  html = html.replace(/<!-- ============================================================== -->\s*<!-- TAB 5: SETTINGS & SECURITY -->/, PM2_TAB);
}

// Add Log Modal at the bottom before </body>
const LOG_MODAL = `
  <!-- MODAL: LOG VIEWER -->
  <div id="logViewerModal" class="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 hidden">
    <div class="bg-slate-900 border border-slate-800 w-full max-w-5xl rounded-3xl shadow-2xl flex flex-col h-[85vh]">
      <div class="flex items-center justify-between p-4 border-b border-slate-800">
        <h3 class="font-bold text-lg text-white flex items-center gap-2 font-mono">
          <span class="material-symbols-outlined text-cyan-400">terminal</span>
          <span id="logViewerTitle">Terminal Log Viewer</span>
        </h3>
        <div class="flex items-center gap-2">
          <button onclick="refreshCurrentLog()" class="px-3 py-1.5 rounded-lg bg-slate-800 text-cyan-300 hover:bg-slate-700 text-xs font-mono transition flex items-center gap-1">
            <span class="material-symbols-outlined text-sm">refresh</span> Refresh
          </button>
          <button onclick="closeLogViewerModal()" class="text-slate-400 hover:text-white p-1">
            <span class="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
      </div>
      <div class="flex-grow p-4 overflow-hidden flex">
        <pre id="logViewerContent" class="w-full h-full bg-black/95 rounded-xl p-4 font-mono text-xs text-slate-300 overflow-y-auto custom-scrollbar border border-slate-800 shadow-inner whitespace-pre-wrap leading-relaxed">Memuat log...</pre>
      </div>
    </div>
  </div>
</body>`;

html = html.replace("</body>", LOG_MODAL);

fs.writeFileSync('public/admin.html', html);
console.log("HTML patched.");
