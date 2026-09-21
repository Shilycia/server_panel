const fs = require('fs');
const loginStr = fs.readFileSync('public/login.html', 'utf8');
const maintStr = fs.readFileSync('public/maintenance.html', 'utf8');

function extractBlock(str, startMarker, endMarker) {
    const start = str.indexOf(startMarker);
    if (start === -1) return null;
    const end = endMarker ? str.indexOf(endMarker, start) : str.length;
    if (end === -1) return null;
    return str.substring(start, end);
}

// 1. Get the Login Card
const loginCardStartStr = '<!-- Login Card -->';
const loginCardEndStr = '  </div>\n\n  <script>';
const loginCardHtml = extractBlock(loginStr, loginCardStartStr, loginCardEndStr) + '  </div>\n';

// 2. Get Login Script (HandleLogin etc)
const loginScriptStartStr = 'function togglePasswordVisibility() {';
const loginScriptEndStr = '</script>\n</body>';
const loginScript = extractBlock(loginStr, loginScriptStartStr, loginScriptEndStr);

// 3. Assemble new head
const newHead = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Masuk • shilycia's DEV Control Panel</title>

  <!-- Fonts & Google Icons -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet" />

  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', 'sans-serif'],
            mono: ['"JetBrains Mono"', 'monospace'],
          },
          colors: {
            brand: {
              cyan: '#06b6d4',
              sky: '#38bdf8',
              navy: '#030712',
            }
          }
        }
      }
    }
  </script>

`;

const maintStyleBlock = extractBlock(maintStr, '  <style>', '</head>');

// 4. Body open + Background/Cursor from maintenance
const maintBodyStart = extractBlock(maintStr, '<body ', '  <!-- =========================================\n       TOP HEADER BAR'); 

// 5. Build Main Stage
const mainStageStart = `
  <!-- =========================================
       MAIN LOGIN STAGE
       ========================================= -->
  <main id="mainStage" class="relative z-20 w-full max-w-md mx-auto p-6 flex flex-col items-center justify-center my-auto transition-transform duration-300 ease-out h-full min-h-screen">
`;
const mainStageEnd = `  </main>\n`;

// 6. Audio / Cursor Scripts
const newScript = `
  <!-- Background Music Element -->
  <audio id="bgmAudio" autoplay loop src="/saba-saba.mp3"></audio>

  <!-- BGM Toggle Button -->
  <button 
    id="bgmToggle" 
    onclick="toggleBGM(event)"
    class="fixed bottom-6 right-6 z-50 bg-slate-900/80 backdrop-blur-md border border-cyan-500/40 text-cyan-400 p-3 rounded-full shadow-lg shadow-cyan-900/50 hover:bg-cyan-950 hover:text-cyan-300 transition-all flex items-center justify-center cursor-pointer"
    title="Toggle Background Music"
  >
    <span id="bgmIcon" class="material-symbols-outlined text-xl">music_off</span>
  </button>

  <script>
    // =========================================
    // CUSTOM SABA NAUTICAL CURSOR & PARALLAX LERP
    // =========================================
    const isFinePointer = window.matchMedia("(pointer: fine)").matches;
    if (isFinePointer) {
      document.body.classList.add("saba-cursor-active");

      const cursor = document.getElementById("sabaCursor");
      const cursorBody = document.getElementById("cursorBody");
      const cursorSparkle = document.getElementById("cursorSparkle");
      const trailContainer = document.getElementById("cursorTrailContainer");
      const rippleContainer = document.getElementById("rippleContainer");

      // Parallax layers
      const bgCanvas = document.getElementById("bgCanvas");
      const waveLayer = document.getElementById("waveLayer");
      const mainStage = document.getElementById("mainStage");
      const floatBoatLeft = document.getElementById("floatBoatLeft");
      const floatFishLeft = document.getElementById("floatFishLeft");
      const floatBoatRight = document.getElementById("floatBoatRight");
      const floatCrabRight = document.getElementById("floatCrabRight");

      let mouseX = -200, mouseY = -200;
      let targetPx = 0, targetPy = 0;
      let currPx = 0, currPy = 0;
      let lastTrail = 0;

      window.addEventListener("mousemove", (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        if(cursor) {
          cursor.style.left = \`\${mouseX}px\`;
          cursor.style.top = \`\${mouseY}px\`;
          cursor.style.opacity = "1";
        }

        targetPx = (e.clientX / window.innerWidth - 0.5) * 2;
        targetPy = (e.clientY / window.innerHeight - 0.5) * 2;

        // Hover effect detection
        const target = e.target;
        const isHover = target && target.closest("a, button, [onclick], input, .group");
        if (isHover && cursorBody && cursorSparkle) {
          cursorBody.style.transform = "scale(1.35) rotate(12deg)";
          cursorSparkle.classList.remove("hidden");
        } else if(cursorBody && cursorSparkle) {
          cursorBody.style.transform = "scale(1) rotate(0deg)";
          cursorSparkle.classList.add("hidden");
        }

        // Water bubble trail
        const now = performance.now();
        if (now - lastTrail > 55 && trailContainer) {
          lastTrail = now;
          const bubble = document.createElement("div");
          const size = Math.random() * 8 + 5;
          bubble.className = "fixed pointer-events-none rounded-full bg-cyan-200/40 border border-cyan-100/60 z-[9998] transition-all duration-500 ease-out";
          bubble.style.left = \`\${e.clientX + (Math.random() * 10 - 5)}px\`;
          bubble.style.top = \`\${e.clientY + 10 + (Math.random() * 8 - 4)}px\`;
          bubble.style.width = \`\${size}px\`;
          bubble.style.height = \`\${size}px\`;
          bubble.style.transform = "translate(-50%, -50%) scale(0.7)";
          bubble.style.opacity = "0.65";
          bubble.style.boxShadow = "0 0 6px rgba(56, 189, 248, 0.4)";
          trailContainer.appendChild(bubble);

          requestAnimationFrame(() => {
            bubble.style.transform = "translate(-50%, -80%) scale(1.2)";
            bubble.style.opacity = "0";
          });
          setTimeout(() => bubble.remove(), 550);
        }
      });

      window.addEventListener("mousedown", (e) => {
        if(cursorBody) cursorBody.style.transform = "scale(0.85) rotate(-8deg)";

        // Water Click Ripple
        if(rippleContainer) {
          const ripple = document.createElement("div");
          ripple.className = "fixed pointer-events-none rounded-full border-2 border-cyan-300/80 z-[9998] transition-all duration-700 ease-out";
          ripple.style.left = \`\${e.clientX}px\`;
          ripple.style.top = \`\${e.clientY}px\`;
          ripple.style.width = "10px";
          ripple.style.height = "10px";
          ripple.style.marginLeft = "-5px";
          ripple.style.marginTop = "-5px";
          ripple.style.opacity = "0.9";
          ripple.style.boxShadow = "0 0 20px rgba(56, 189, 248, 0.7)";
          rippleContainer.appendChild(ripple);

          requestAnimationFrame(() => {
            ripple.style.width = "70px";
            ripple.style.height = "70px";
            ripple.style.marginLeft = "-35px";
            ripple.style.marginTop = "-35px";
            ripple.style.opacity = "0";
          });
          setTimeout(() => ripple.remove(), 700);
        }
      });

      window.addEventListener("mouseup", () => {
        if(cursorBody) cursorBody.style.transform = "scale(1) rotate(0deg)";
      });

      document.addEventListener("mouseleave", () => {
        if(cursor) cursor.style.opacity = "0";
      });

      // Smooth Lerp loop for parallax
      function animLoop() {
        currPx += (targetPx - currPx) * 0.08;
        currPy += (targetPy - currPy) * 0.08;

        if (bgCanvas) bgCanvas.style.transform = \`translate3d(\${currPx * -16}px, \${currPy * -12}px, 0) scale(1.08)\`;
        if (waveLayer) waveLayer.style.transform = \`translate3d(\${currPx * -24}px, \${currPy * -16}px, 0)\`;
        if (mainStage) mainStage.style.transform = \`translate3d(\${currPx * 12}px, \${currPy * 8}px, 0)\`;
        if (floatBoatLeft) floatBoatLeft.style.transform = \`translate3d(\${currPx * 36}px, \${currPy * 24}px, 0)\`;
        if (floatFishLeft) floatFishLeft.style.transform = \`translate3d(\${currPx * -42}px, \${currPy * -26}px, 0)\`;
        if (floatBoatRight) floatBoatRight.style.transform = \`translate3d(\${currPx * 44}px, \${currPy * 30}px, 0)\`;
        if (floatCrabRight) floatCrabRight.style.transform = \`translate3d(\${currPx * -36}px, \${currPy * -20}px, 0)\`;

        requestAnimationFrame(animLoop);
      }
      animLoop();
    }

    // Generate rising ocean bubbles
    const bubbleContainer = document.getElementById("oceanBubblesContainer");
    if (bubbleContainer) {
      for (let i = 0; i < 16; i++) {
        const b = document.createElement("div");
        const size = 10 + (i % 5) * 8;
        const dur = 7 + (i % 6) * 3;
        const delay = i * 0.7;
        const left = (i * 6.5 + 3) % 96;
        b.className = "absolute rounded-full bg-cyan-200/30 border border-cyan-100/50 pointer-events-none backdrop-blur-xs";
        b.style.width = \`\${size}px\`;
        b.style.height = \`\${size}px\`;
        b.style.left = \`\${left}%\`;
        b.style.bottom = "-40px";
        b.style.animation = \`bubbleFloatUp \${dur}s linear infinite\`;
        b.style.animationDelay = \`\${delay}s\`;
        bubbleContainer.appendChild(b);
      }
    }

    // Audio Player Logic
    const bgm = document.getElementById('bgmAudio');
    const bgmToggle = document.getElementById('bgmToggle');
    const bgmIcon = document.getElementById('bgmIcon');
    let isPlaying = false;

    if (bgm) {
      bgm.addEventListener('play', () => {
        isPlaying = true;
        if(bgmIcon) bgmIcon.innerText = 'music_note';
      });
      
      bgm.addEventListener('pause', () => {
        isPlaying = false;
        if(bgmIcon) bgmIcon.innerText = 'music_off';
      });
    }

    function toggleBGM(e) {
      if(e) e.stopPropagation();
      if (!bgm) return;
      if (isPlaying) {
        bgm.pause();
      } else {
        bgm.play().catch(e => console.log('Audio play failed:', e));
      }
    }

    document.body.addEventListener('click', function playOnInteract() {
      if (!isPlaying && bgm) {
        bgm.play().catch(e => console.log('Autoplay on interact failed:', e));
      }
      document.body.removeEventListener('click', playOnInteract);
    }, { once: true });
    
    // Original Login Logic
    ${loginScript}
  </script>
</body>
</html>
`;

const finalHtml = newHead + maintStyleBlock + '</head>\n' + maintBodyStart + mainStageStart + loginCardHtml + mainStageEnd + newScript;

fs.writeFileSync('public/login.html', finalHtml);
console.log('Successfully updated login.html with animated beach background');
