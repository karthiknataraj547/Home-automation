// cctv.js - LUKAS Surveillance CCTV Cameras Simulator
// Draws futuristic vector-tracking canvas feeds with static and alert modes.

class LukasCCTVManager {
  constructor() {
    this.canvases = {};
    this.contexts = {};
    this.animationId = null;
    this.isAlertMode = false;
    
    // Tracking simulation objects
    this.targets = {
      1: { x: 50, y: 50, dx: 0.8, dy: 0.5, label: "HUMAN (VERIFIED)", color: "#10b981" },
      2: { x: 150, y: 80, dx: -0.6, dy: 0.8, label: "LUKAS CORE NORMAL", color: "#00f0ff" },
      3: { x: 200, y: 150, dx: 0.5, dy: -0.4, label: "SECTOR CLEAR", color: "#94a3b8" },
      4: { x: 80, y: 120, dx: -0.4, dy: -0.7, label: "THERMAL READING", color: "#10b981" }
    };
    
    this.lastFrameTime = 0;
  }

  // Initialize camera feeds on canvases
  initCameras(canvasIds) {
    canvasIds.forEach((id, index) => {
      const camNum = index + 1;
      const canvas = document.getElementById(id);
      if (!canvas) return;
      
      this.canvases[camNum] = canvas;
      this.contexts[camNum] = canvas.getContext('2d');
      
      // Handle resizing context sizes
      this.resizeCanvas(camNum);
      
      // Adjust resize window event listener
      window.addEventListener('resize', () => this.resizeCanvas(camNum));
    });

    this.startFeeds();
  }

  resizeCanvas(camNum) {
    const canvas = this.canvases[camNum];
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
  }

  setAlertMode(state) {
    this.isAlertMode = state;
    // Update vector colors for lockdown mode
    Object.keys(this.targets).forEach(key => {
      if (state) {
        this.targets[key].label = "SECURITY BREACH DETECTED";
        this.targets[key].color = "#ef4444";
      } else {
        // Reset defaults
        if (key == 1) { this.targets[key].label = "HUMAN (VERIFIED)"; this.targets[key].color = "#10b981"; }
        if (key == 2) { this.targets[key].label = "LUKAS CORE NORMAL"; this.targets[key].color = "#00f0ff"; }
        if (key == 3) { this.targets[key].label = "SECTOR CLEAR"; this.targets[key].color = "#94a3b8"; }
        if (key == 4) { this.targets[key].label = "THERMAL READING"; this.targets[key].color = "#10b981"; }
      }
    });
  }

  startFeeds() {
    const render = (timestamp) => {
      Object.keys(this.canvases).forEach(camNum => {
        this.drawFeed(parseInt(camNum), timestamp);
      });
      
      this.animationId = requestAnimationFrame(render);
    };
    this.animationId = requestAnimationFrame(render);
  }

  stopFeeds() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
  }

  drawFeed(camNum, timestamp) {
    const canvas = this.canvases[camNum];
    const ctx = this.contexts[camNum];
    if (!canvas || !ctx) return;
    
    const w = canvas.width;
    const h = canvas.height;
    
    // Clear and draw background
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, w, h);
    
    // Draw vector guidelines
    ctx.strokeStyle = this.isAlertMode ? 'rgba(239, 68, 68, 0.05)' : 'rgba(0, 240, 255, 0.03)';
    ctx.lineWidth = 1;
    
    // Draw horizontal grid lines
    for (let y = 20; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Draw vertical grid lines
    for (let x = 20; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Update targeting vector coordinates
    const target = this.targets[camNum];
    if (target) {
      // Map DX/DY boundaries (using raw logical coordinates 0-300 scale)
      target.x += target.dx;
      target.y += target.dy;
      
      if (target.x < 20 || target.x > 280) target.dx *= -1;
      if (target.y < 20 || target.y > 180) target.dy *= -1;

      // Scale targets relative to canvas size
      const scaledX = (target.x / 300) * w;
      const scaledY = (target.y / 200) * h;
      const boxSize = Math.max(30, w * 0.1);

      // Draw bounding box targeting reticle
      ctx.strokeStyle = target.color;
      ctx.lineWidth = 1.5;
      
      // Draw corner brackets
      // Top-Left
      ctx.beginPath();
      ctx.moveTo(scaledX - boxSize/2, scaledY - boxSize/2 + 8);
      ctx.lineTo(scaledX - boxSize/2, scaledY - boxSize/2);
      ctx.lineTo(scaledX - boxSize/2 + 8, scaledY - boxSize/2);
      ctx.stroke();

      // Top-Right
      ctx.beginPath();
      ctx.moveTo(scaledX + boxSize/2 - 8, scaledY - boxSize/2);
      ctx.lineTo(scaledX + boxSize/2, scaledY - boxSize/2);
      ctx.lineTo(scaledX + boxSize/2, scaledY - boxSize/2 + 8);
      ctx.stroke();

      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(scaledX - boxSize/2, scaledY + boxSize/2 - 8);
      ctx.lineTo(scaledX - boxSize/2, scaledY + boxSize/2);
      ctx.lineTo(scaledX - boxSize/2 + 8, scaledY + boxSize/2);
      ctx.stroke();

      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(scaledX + boxSize/2 - 8, scaledY + boxSize/2);
      ctx.lineTo(scaledX + boxSize/2, scaledY + boxSize/2);
      ctx.lineTo(scaledX + boxSize/2, scaledY + boxSize/2 - 8);
      ctx.stroke();

      // Draw vector text labels
      ctx.fillStyle = target.color;
      ctx.font = `${Math.max(8, w * 0.035)}px Share Tech Mono`;
      ctx.fillText(target.label, scaledX - boxSize/2, scaledY - boxSize/2 - 6);
      
      // Bounding box tracking coordinates ticker
      const coordinateText = `X: ${Math.round(target.x)} Y: ${Math.round(target.y)}`;
      ctx.fillText(coordinateText, scaledX - boxSize/2, scaledY + boxSize/2 + 12);
      
      // Draw small target pointer in center
      ctx.beginPath();
      ctx.arc(scaledX, scaledY, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Visual camera scanner line
    const scanY = (timestamp % 4000) / 4000 * h;
    ctx.strokeStyle = this.isAlertMode ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0, 240, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, scanY);
    ctx.lineTo(w, scanY);
    ctx.stroke();

    // Random visual screen glitch transition (draw horizontal static strip)
    if (Math.random() > 0.985) {
      const glitchY = Math.random() * h;
      const glitchH = Math.random() * 20 + 5;
      ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
      ctx.fillRect(0, glitchY, w, glitchH);
      
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, glitchY + glitchH/2);
      ctx.lineTo(w, glitchY + glitchH/2);
      ctx.stroke();
    }

    // Add digital noise/static grain
    this.drawNoise(ctx, w, h);

    // Alert crimson overlay flashing if in Lockdown mode
    if (this.isAlertMode) {
      const alarmFlash = Math.sin(timestamp / 200) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(239, 68, 68, ${alarmFlash * 0.06})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Draw lightweight digital static noise overlay
  drawNoise(ctx, w, h) {
    const grainDensity = 15; // lower is lighter, faster
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    for (let i = 0; i < grainDensity; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const size = Math.random() * 1.5 + 0.5;
      ctx.fillRect(x, y, size, size);
    }
  }
}

export default LukasCCTVManager;
