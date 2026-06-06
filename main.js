// main.js - LUKAS AI Operating System Orchestrator
import './src/style.css';
import LukasVoiceController from './src/voice.js';
import LukasAutomationHub, { DEVICES, ROUTINES } from './src/automation.js';
import LukasCCTVManager from './src/cctv.js';
import LukasDiagnosticsHub from './src/diagnostics.js';
import { fingerprintDevice, fingerprintBLE } from './src/deviceKnowledgeBase.js';
import { loginUser, registerUser, isAuthenticated, logoutUser } from './src/auth.js';

// ═══════ LUKAS Intelligence Layer ═══════
import LukasMemory from './src/ai/memory.js';
import LukasOrchestrator, { INTENT } from './src/ai/orchestrator.js';
import LukasResearchAgent from './src/ai/research.js';
import LukasReasoningEngine from './src/ai/reasoning.js';
import { generateConversationalResponse, parseHomeCommand, scoreResponse } from './src/ai/core.js';

// Instantiate core hubs
const voice = new LukasVoiceController();
const home = new LukasAutomationHub();
const cctv = new LukasCCTVManager();
const diag = new LukasDiagnosticsHub();

// ═══════ LUKAS Intelligence System ═══════
const lukasMemory = new LukasMemory();
const lukasOrchestrator = new LukasOrchestrator(lukasMemory);
const lukasResearch = new LukasResearchAgent();
const lukasReasoning = new LukasReasoningEngine();

// Local Media Tracks Playlist with copyright-free MP3 streams
const playlist = [
  { title: "Viper (Synthwave)", artist: "MDN Synth Beats", icon: "fa-compact-disc", url: "https://raw.githubusercontent.com/mdn/webaudio-examples/main/audio-analyser/viper.mp3" },
  { title: "Bollywood Hits (Vividh Bharati)", artist: "Akamai Live HLS", icon: "fa-radio", url: "https://vividhbharati-lh.akamaihd.net/i/vividhbharati_1@507811/index_1_a-p.m3u8" },
  { title: "Ghazal Radio (Mirchi Mehfil)", artist: "Akamai Live HLS", icon: "fa-music", url: "https://mirchimahfil-lh.akamaihd.net/i/MirchiMehfl_1@120798/index_1_a-b.m3u8" },
  { title: "Kannada Hits (AIR Kannada)", artist: "Akamai Live HLS", icon: "fa-satellite-dish", url: "https://airkannada-lh.akamaihd.net/i/airkannada_1@507819/master.m3u8" },
  { title: "Outfoxing (Cyberpunk)", artist: "MDN Audio Lab", icon: "fa-atom", url: "https://raw.githubusercontent.com/mdn/webaudio-examples/main/output-timestamp/outfoxing.mp3" },
  { title: "Ambient Horizon", artist: "Lukas Synth Engine", icon: "fa-music", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
  { title: "Cybernetic Pulse", artist: "Jarvis Wave Generator", icon: "fa-wave-square", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" }
];
let currentTrackIndex = 0;
let isPlaying = false;
let isPassiveListenEnabled = true;
let isWakingUp = false;
let currentWeatherCity = "";
let activeFollowUp = null;
let conversationActive = false;   // TRUE while we keep mic hot after a voice exchange
let conversationTimer = null;     // Timer to revert to passive after conversation window
let activePlatform = "Spotify";
let tuyaConfigured = false;
let lastCommandSource = 'user';

// ═══════════════════ REMINDER & TASK ENGINE ═══════════════════
let lukasReminders = JSON.parse(localStorage.getItem('lukas_reminders') || '[]');
let reminderTimers = new Map();

function saveReminders() {
  localStorage.setItem('lukas_reminders', JSON.stringify(lukasReminders));
  renderReminders();
}

function renderReminders() {
  const list = document.getElementById('reminderList');
  const countEl = document.getElementById('reminderCount');
  const emptyEl = document.getElementById('reminderEmpty');
  if (!list) return;

  // Clear existing items (keep empty placeholder)
  list.querySelectorAll('.reminder-item').forEach(el => el.remove());

  const active = lukasReminders.filter(r => !r.fired);
  if (countEl) countEl.textContent = `${active.length} ACTIVE`;
  if (emptyEl) emptyEl.style.display = lukasReminders.length === 0 ? 'flex' : 'none';

  lukasReminders.forEach((rem, idx) => {
    const div = document.createElement('div');
    div.className = 'reminder-item' + (rem.fired ? ' firing' : '');
    const fireDate = new Date(rem.fireAt);
    const timeStr = fireDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = fireDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
    div.innerHTML = `
      <i class="fa-solid ${rem.fired ? 'fa-bell' : 'fa-clock'} ri-icon"></i>
      <div class="ri-text">
        <span class="ri-label">${rem.text}</span>
        <span class="ri-time">${rem.fired ? '✓ FIRED' : `⏰ ${timeStr} · ${dateStr}`}</span>
      </div>
      <button class="ri-delete" data-idx="${idx}" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
    `;
    div.querySelector('.ri-delete').addEventListener('click', () => {
      deleteReminder(idx);
    });
    list.appendChild(div);
  });
}

function scheduleReminder(idx) {
  const rem = lukasReminders[idx];
  if (!rem || rem.fired) return;
  const ms = new Date(rem.fireAt).getTime() - Date.now();
  if (ms <= 0) {
    fireReminder(idx);
    return;
  }
  const timer = setTimeout(() => fireReminder(idx), ms);
  reminderTimers.set(idx, timer);
}

function fireReminder(idx) {
  const rem = lukasReminders[idx];
  if (!rem || rem.fired) return;
  rem.fired = true;
  saveReminders();
  reminderTimers.delete(idx);

  // Show toast
  showReminderToast(rem.text);

  // Voice alert
  if (typeof voice !== 'undefined') {
    voice.speak(`Commander, reminder: ${rem.text}`);
  }

  // Log to terminal
  if (typeof diag !== 'undefined') {
    diag.logToTerminal(`[REMINDER] ⏰ FIRED: "${rem.text}"`, 'warn');
  }
}

function showReminderToast(text) {
  const toast = document.getElementById('reminderToast');
  const toastText = document.getElementById('reminderToastText');
  if (!toast || !toastText) return;
  toastText.textContent = text;
  toast.style.display = 'flex';
  requestAnimationFrame(() => toast.classList.add('visible'));
  // Auto-dismiss after 10 seconds
  setTimeout(() => dismissReminderToast(), 10000);
}

function dismissReminderToast() {
  const toast = document.getElementById('reminderToast');
  if (!toast) return;
  toast.classList.remove('visible');
  setTimeout(() => { toast.style.display = 'none'; }, 500);
}

function deleteReminder(idx) {
  if (reminderTimers.has(idx)) {
    clearTimeout(reminderTimers.get(idx));
    reminderTimers.delete(idx);
  }
  lukasReminders.splice(idx, 1);
  saveReminders();
  // Re-schedule all since indices shifted
  reminderTimers.forEach((t) => clearTimeout(t));
  reminderTimers.clear();
  lukasReminders.forEach((r, i) => { if (!r.fired) scheduleReminder(i); });
}

function addReminder(text, fireAt) {
  const rem = { text, fireAt: fireAt.toISOString(), fired: false, createdAt: new Date().toISOString() };
  lukasReminders.push(rem);
  const idx = lukasReminders.length - 1;
  saveReminders();
  scheduleReminder(idx);
  return rem;
}

function parseReminderTime(cmd) {
  const now = new Date();
  
  // "in X minutes/hours/seconds" (optional "in" or "after")
  const inMatch = cmd.match(/(?:in|after)?\s*(\d+)\s*(second|sec|minute|min|hour|hr)s?/i);
  if (inMatch) {
    const val = parseInt(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    const ms = unit.startsWith('sec') ? val * 1000 : unit.startsWith('min') ? val * 60000 : val * 3600000;
    return new Date(now.getTime() + ms);
  }
  
  // "at HH:MM" or "at H AM/PM"
  const atMatch = cmd.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (atMatch) {
    let h = parseInt(atMatch[1]);
    const m = atMatch[2] ? parseInt(atMatch[2]) : 0;
    const ampm = atMatch[3];
    if (ampm) {
      if (ampm.toLowerCase() === 'pm' && h < 12) h += 12;
      if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
    }
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1); // Next day
    return target;
  }
  
  return null;
}

function extractReminderText(cmd) {
  // Remove time phrases and trigger phrases to get the reminder label
  let text = cmd
    .replace(/(?:set|create|add|make|schedule)\s*(?:a|an)?\s*(?:reminder|task|alarm|timer)/i, '')
    .replace(/(?:in|after)\s+\d+\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)/i, '')
    .replace(/at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i, '')
    .replace(/(?:to|for|that|about)\s*/i, '')
    .replace(/remind\s*me\s*(?:to|that|about)?/i, '')
    .trim();
  
  // Capitalize first letter
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text || 'Reminder';
}

// Initialize reminders on load
function initReminders() {
  renderReminders();
  lukasReminders.forEach((r, i) => { if (!r.fired) scheduleReminder(i); });
  
  // Toast close button
  const closeBtn = document.getElementById('reminderToastClose');
  if (closeBtn) closeBtn.addEventListener('click', dismissReminderToast);
  
  // Quick-add input
  const addBtn = document.getElementById('reminderAddBtn');
  const addInput = document.getElementById('reminderTextInput');
  if (addBtn && addInput) {
    const quickAdd = () => {
      const val = addInput.value.trim();
      if (!val) return;
      const time = parseReminderTime(val);
      const label = extractReminderText(val);
      const fireAt = time || new Date(Date.now() + 5 * 60000); // Default 5 min
      addReminder(label, fireAt);
      addInput.value = '';
      const timeStr = fireAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (typeof diag !== 'undefined') {
        diag.logToTerminal(`[REMINDER] Set: "${label}" at ${timeStr}`, 'info');
      }
    };
    addBtn.addEventListener('click', quickAdd);
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickAdd(); });
  }
}
// ═══════════════════ END REMINDER ENGINE ═══════════════════

// Global map to store physical BluetoothDevice references and connection handlers
const activeBleDevices = new Map();

function onBleDisconnected(event) {
  const device = event.target;
  diag.logToTerminal(`[BLE] GATT server disconnected automatically from device: ${device.name || 'Unnamed Device'}`, 'warn');
  
  // Find the corresponding device in home.dynamicDevices and update it
  const registered = home.dynamicDevices.find(d => d.id === 'ble_' + device.id || d.name === device.name);
  if (registered) {
    home.setDeviceState(registered.id, { connected: false, status: 'STANDBY' });
  }
}

// HTML5 audio stream player
const audioPlayer = new Audio();
audioPlayer.volume = 0.35;
audioPlayer.preload = "auto";

audioPlayer.addEventListener('ended', () => {
  currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
  updateMediaWidget();
  playTrack();
});

let audioHlsInstance = null; // Global HLS instance for audio media player

function playTrack() {
  const url = playlist[currentTrackIndex].url;
  
  // Clean up any existing Hls instance
  if (audioHlsInstance) {
    audioHlsInstance.destroy();
    audioHlsInstance = null;
  }
  
  if (url.includes('.m3u8')) {
    diag.logToTerminal(`[MEDIA PLAYER] Connecting to live HLS stream...`, 'info');
    if (audioPlayer.canPlayType && audioPlayer.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari / iOS)
      audioPlayer.src = url;
      audioPlayer.play().catch(e => {
        console.warn("Native HLS playback delayed:", e);
      });
    } else {
      // Chrome/Firefox HLS support via Hls.js library
      if (typeof Hls === 'undefined') {
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/hls.js@latest";
        script.onload = () => {
          setupHlsPlayer(url);
        };
        document.head.appendChild(script);
      } else {
        setupHlsPlayer(url);
      }
    }
  } else {
    // Standard MP3/AAC playback
    audioPlayer.src = url;
    audioPlayer.play().catch(e => {
      console.warn("Audio playback delayed or blocked by browser gesture permissions:", e);
      diag.logToTerminal(`Audio playback delayed: interact with UI`, "warn");
    });
  }
}

function setupHlsPlayer(url) {
  if (Hls.isSupported()) {
    audioHlsInstance = new Hls();
    audioHlsInstance.loadSource(url);
    audioHlsInstance.attachMedia(audioPlayer);
    audioHlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      audioPlayer.play().catch(e => {
        console.warn("Hls.js audio playback delayed:", e);
      });
    });
    audioHlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.warn("HLS audio fatal error:", data);
        diag.logToTerminal(`[MEDIA PLAYER] HLS stream error: ${data.type}`, 'error');
      }
    });
  } else {
    diag.logToTerminal(`[MEDIA PLAYER] ❌ HLS streaming not supported in this browser.`, 'error');
  }
}

// DOM Cache
const clockNode = document.getElementById('systemClock');
const voiceStatusText = document.getElementById('voiceStatusText');
const coreCenterNode = document.getElementById('coreCenterNode');
const audioWaveform = document.getElementById('audioWaveform');
const chatHistory = document.getElementById('chatHistory');
const chatInputField = document.getElementById('chatInputField');
const micBtn = document.getElementById('micBtn');
const audioToggleBtn = document.getElementById('audioToggleBtn');

const targetTempText = document.getElementById('targetTempText');
const tempDialArc = document.getElementById('tempDialArc');
const thermostatModeLabel = document.getElementById('thermostatModeLabel');
const indoorTempText = document.getElementById('indoorTempText');
const airQualityText = document.getElementById('airQualityText');

const activeLightsCount = document.getElementById('activeLightsCount');
const lockStatusText = document.getElementById('lockStatusText');

// Media DOMs
const mediaTitleText = document.getElementById('mediaTitleText');
const mediaArtistText = document.getElementById('mediaArtistText');
const mediaArtNode = document.getElementById('mediaArtNode');
const mediaPlayIcon = document.getElementById('mediaPlayIcon');

// Initialize dashboard core components (invoked upon verified clearance)
function initializeDashboard() {
  const appContainer = document.getElementById('appContainer');
  if (appContainer) appContainer.style.display = 'block';

  initClock();
  diag.initGauges();
  diag.initChartTooltip();
  initReminders();

  // Validate Speech Recognition availability and HTTPS protocol (Secure Context requirements)
  const isSecure = window.location.protocol === 'https:' || 
                   window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1';
  const speechSupportMsg = document.getElementById('speechSupportMsg');
  if (speechSupportMsg) {
    if (!voice.recognition) {
      speechSupportMsg.textContent = isSecure ? '❌ Speech API Unsupported' : '⚠️ HTTP Insecure (Speech Blocked)';
      speechSupportMsg.style.color = 'var(--rose-neon)';
      
      const helpText = isSecure 
        ? "[SYSTEM WARNING] Web Speech API is unsupported in this browser or blocked. Ensure microphone permissions are enabled."
        : "[SECURITY ALERT] Voice commands disabled. Browsers block speech recognition on insecure HTTP deployments. Configure HTTPS (SSL) or run on localhost.";
      setTimeout(() => diag.logToTerminal(helpText, "error"), 3000);
    } else {
      speechSupportMsg.textContent = `WebSpeech Active (${voice.speechLang || 'en-IN'})`;
      speechSupportMsg.style.color = 'var(--emerald-neon)';
    }
  }
  
  // Render energy chart on interval
  diag.drawEnergyChart();
  setInterval(() => {
    diag.drawEnergyChart();
  }, 4000);

  // Bind CCTV cameras
  cctv.initCameras(['cctvCam1', 'cctvCam2', 'cctvCam3', 'cctvCam4']);

  // Connect automation event hooks
  setupAutomationHooks();

  // Initial draw of registered nodes
  renderDynamicDevices();

  // Auto-register EseeCloud Camera if missing so live feed plays instantly
  const hasEseeCam = home.dynamicDevices.some(d => 
    d.category === 'camera' && 
    (d.protocol === 'P2P' || d.protocol === 'Cloud' || d.name.toLowerCase().includes('esee'))
  );
  if (!hasEseeCam) {
    home.addDevice("EseeCloud Cloud Camera", "Outdoor", "camera", "P2P", "192.168.1.3");
    diag.logToTerminal("[SYSTEM] Auto-registered EseeCloud Cloud Camera to registry for live feed integration.", "info");
    renderDynamicDevices();
  }

  // Auto-register Wipro Smart Light if missing to make it easy to configure
  const hasWiproLight = home.dynamicDevices.some(d =>
    d.category === 'light' &&
    (d.integration === 'tuya-cloud' || d.name.toLowerCase().includes('wipro'))
  );
  if (!hasWiproLight) {
    home.addDevice("Wipro Smart Light", "Bedroom", "light", "WiFi", "0.0.0.0", "tuya-cloud", "enter_wipro_device_id_here");
    diag.logToTerminal("[SYSTEM] Auto-registered Wipro Smart Light. Please configure its Device ID on the card.", "info");
    renderDynamicDevices();
  }

  // Auto-register Garden Sprinkler if missing
  const hasSprinkler = home.dynamicDevices.some(d =>
    d.category === 'garden' || d.id === 'gardenSprinkler'
  );
  if (!hasSprinkler) {
    const sprinklerDev = home.addDevice("Garden Sprinkler", "Backyard", "garden", "WiFi", "192.168.1.15", "demo");
    sprinklerDev.id = 'gardenSprinkler';
    home.saveDynamicDevices();
    diag.logToTerminal("[SYSTEM] Auto-registered Garden Smart Sprinkler to registry.", "info");
    renderDynamicDevices();
  }

  // Wire User Interface events
  bindUIEvents();

  // Load initial weather data using browser geolocation
  requestLocalWeatherUpdate();

  // Connect to local live camera stream (falls back to simulation if offline)
  connectLiveCamera();
  wireProbeButton();

  // Run cinematic boot sequence then initial greeting
  bootSequenceAnimation();
}

// Initialize modules on DOM load
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Jarvis particle canvas background
  initParticleCanvas();

  // Initialize light/dark theme rules
  initTheme();

  // Initialize terminal security authentication
  initAuth();
});

// Cinematic Boot Sequence
function bootSequenceAnimation() {
  const lines = [
    { text: "[BOOT] LUKAS Core Runtime v4.8.2 initializing...", delay: 300 },
    { text: "[INIT] Neural command parser: ONLINE", delay: 700 },
    { text: "[INIT] Quantum encryption mesh: ACTIVE", delay: 1100 },
    { text: "[INIT] Home automation hub: ARMED", delay: 1500 },
    { text: "[INIT] Voice recognition engine: LISTENING", delay: 1900 },
    { text: "[READY] All subsystems nominal. Standing by, Commander.", delay: 2400 }
  ];
  const diag = window.__lukasDiag;
  lines.forEach(({ text, delay }) => {
    setTimeout(() => {
      const termEl = document.getElementById('terminalLogContainer');
      if (termEl) {
        const line = document.createElement('div');
        line.className = 'terminal-line info';
        line.style.animation = 'bootScan 0.3s ease-out';
        line.innerHTML = `<span class="terminal-prompt">&gt;</span> ${text}`;
        termEl.appendChild(line);
        termEl.scrollTop = termEl.scrollHeight;
      }
    }, delay);
  });
  // Initial assistant greeting after boot completes
  setTimeout(() => {
    const termEl = document.getElementById('terminalLogContainer');
    if (termEl) {
      const line = document.createElement('div');
      line.className = 'terminal-line warn';
      line.innerHTML = `<span class="terminal-prompt">&gt;</span> [SYSTEM] Tap anywhere to engage secure voice interface.`;
      termEl.appendChild(line);
      termEl.scrollTop = termEl.scrollHeight;
    }

    let voiceStarted = false;
    const startVoiceSystem = () => {
      if (voiceStarted) return;
      voiceStarted = true;
      
      voice.warmUpMic();
      isWakingUp = true;
      lastCommandSource = 'voice';
      handleAssistantResponse("Lukas Core initialized. Systems are secure and operational on port 3000. How can I assist you, Commander?");
      
      document.removeEventListener('click', startVoiceSystem);
      document.removeEventListener('touchstart', startVoiceSystem);
    };

    // Try starting automatically since microphone was warmed up during click gesture
    try {
      startVoiceSystem();
    } catch (e) {
      console.log("Speech initialization delayed until dashboard click:", e);
    }

    if (!voiceStarted) {
      document.addEventListener('click', startVoiceSystem);
      document.addEventListener('touchstart', startVoiceSystem);
    }
  }, 2900);
}

// Particle Canvas Background System
function initParticleCanvas() {
  const canvas = document.getElementById('jarvisParticleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const particles = Array.from({ length: 70 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.2 + 0.3,
    dx: (Math.random() - 0.5) * 0.25,
    dy: (Math.random() - 0.5) * 0.25,
    alpha: Math.random() * 0.5 + 0.1,
    hue: Math.random() > 0.6 ? 180 : 270 // cyan or purple
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${p.alpha})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  draw();
}

// 1. Digital System Clock
function initClock() {
  const updateClock = () => {
    const now = new Date();
    const timeString = now.toTimeString().split(' ')[0];
    if (clockNode) clockNode.textContent = timeString;
  };
  updateClock();
  setInterval(updateClock, 1000);
}

// 2. Wire UI event listeners
function bindUIEvents() {
  // Chat typing directive
  chatInputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const command = chatInputField.value.trim();
      if (command) {
        processCommand(command, 'user');
        chatInputField.value = '';
      }
    }
  });

  // Mute Vocal toggle
  audioToggleBtn.addEventListener('click', () => {
    const isMuted = voice.toggleMute();
    updateMuteUI(isMuted);
    diag.logToTerminal(`System vocalization: ${isMuted ? 'DISABLED' : 'ENABLED'}`, 'info');
  });
  updateMuteUI(voice.isMuted);

  // Mic Activation (Single-turn voice command listening)
  micBtn.addEventListener('click', () => {
    voice.warmUpMic(); // Warm up mic stream on user gesture
    const isAlexa = localStorage.getItem('lukas_assistant_persona') === 'alexa';
    const coreBtn = document.getElementById('lukasCoreBtn');
    
    if (voice.isListening) {
      isPassiveListenEnabled = false;
      endConversation();
      voice.stopListeningForCommand();
      if (isAlexa) {
        playAlexaErrorChime();
      } else {
        playShutdownBeep();
      }
      diag.logToTerminal("[AI CORE] Voice activation closed.", "info");
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
      }
    } else {
      isPassiveListenEnabled = true;
      voice.startListeningForCommand();
      if (isAlexa) {
        playAlexaWakeChime();
      } else {
        playFuturisticBeep();
      }
      diag.logToTerminal(isAlexa ? "[AI CORE] Alexa listening..." : "[AI CORE] Lukas listening...", "info");
      if (coreBtn) {
        coreBtn.classList.add('listening');
        coreBtn.classList.remove('processing');
      }
    }
  });

  // Voice controller event hooks
  voice.onRecognitionStateChange = (state, error) => {
    const coreBtn = document.getElementById('lukasCoreBtn');
    const isAlexa = localStorage.getItem('lukas_assistant_persona') === 'alexa';
    const activeLang = voice.speechLang || 'en-IN';
    
    if (state === 'command') {
      micBtn.classList.add('active');
      voiceStatusText.textContent = (isAlexa ? 'ALEXA ACTIVE' : 'LUKAS ACTIVE') + ` (${activeLang})`;
      voiceStatusText.style.color = isAlexa ? 'var(--cyan-neon)' : 'var(--purple-neon)';
      diag.logToTerminal(isAlexa ? `Alexa voice link active (${activeLang})...` : `Lukas voice link active (${activeLang})...`, "info");
      audioPlayer.volume = 0.08; // Duck music during mic capture
      if (coreBtn) {
        coreBtn.classList.add('listening');
        coreBtn.classList.remove('processing');
      }
    } else if (state === 'wakeword') {
      micBtn.classList.remove('active');
      voiceStatusText.textContent = `PASSIVE LISTEN (${activeLang})`;
      voiceStatusText.style.color = 'var(--purple-neon)';
      if (!window.speechSynthesis.speaking) audioPlayer.volume = 0.35; // Restore volume
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
      }
    } else if (state === 'off') {
      micBtn.classList.remove('active');
      
      if (coreBtn && !window.speechSynthesis.speaking && !voice.isLongConversation && !voice.isListeningForWakeWord) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
        coreBtn.classList.remove('waking');
      }

      if (voice.isListeningForWakeWord) {
        voiceStatusText.textContent = `PASSIVE LISTEN (${activeLang})`;
        voiceStatusText.style.color = 'var(--purple-neon)';
        if (!window.speechSynthesis.speaking) audioPlayer.volume = 0.35; // Restore volume
      } else {
        if (!isPassiveListenEnabled) {
          voiceStatusText.textContent = 'STANDBY';
          voiceStatusText.style.color = 'var(--rose-neon)';
          if (!window.speechSynthesis.speaking) audioPlayer.volume = 0.35; // Restore volume
        } else {
          voiceStatusText.textContent = 'IDLE';
          voiceStatusText.style.color = 'var(--cyan-neon)';
          if (!window.speechSynthesis.speaking) audioPlayer.volume = 0.35; // Restore volume
        }
      }

      if (error) {
        if (error !== 'no-speech') {
          diag.logToTerminal(`Voice link suspended: ${error}`, "warn");
        }
      } else {
        diag.logToTerminal("Voice link closed.", "info");
      }
    }
  };

  let noCommandTimeout = null;
  let proceedTimeout = null;
  let accumulatedTranscript = "";

  function clearSilenceTimeout() {
    if (noCommandTimeout) {
      clearTimeout(noCommandTimeout);
      noCommandTimeout = null;
    }
  }

  // Keep mic active for follow-up commands after a voice exchange (15 second window)
  function keepConversationAlive(durationMs = 15000) {
    conversationActive = true;
    if (conversationTimer) clearTimeout(conversationTimer);
    conversationTimer = setTimeout(() => {
      conversationActive = false;
      conversationTimer = null;
      // Only drop to passive if we're not already in an active state
      if (!voice.isCommandListeningActive && !voice.isLongConversation && !voice.isListeningForWakeWord) {
        if (isPassiveListenEnabled) {
          diag.logToTerminal("[AI CORE] Conversation window closed. Returning to passive wake-word mode.", "info");
          voice.startWakeWordListener();
        }
      }
    }, durationMs);
  }

  function endConversation() {
    conversationActive = false;
    if (conversationTimer) { clearTimeout(conversationTimer); conversationTimer = null; }
  }

  function startSilenceTimeout() {
    clearSilenceTimeout();
    if (proceedTimeout) clearTimeout(proceedTimeout);
    accumulatedTranscript = "";

    noCommandTimeout = setTimeout(() => {
      diag.logToTerminal("[AI CORE] 15 seconds of silence. No command detected.", "warn");
      voice.stopListeningForCommand();
      endConversation();
      
      const isAlexa = localStorage.getItem('lukas_assistant_persona') === 'alexa';
      if (isAlexa) {
        playAlexaErrorChime();
      } else {
        playShutdownBeep();
      }
      
      if (isPassiveListenEnabled) {
        setTimeout(() => voice.startWakeWordListener(), 500);
      }
      
      const coreBtn = document.getElementById('lukasCoreBtn');
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
      }
    }, 15000);
  }

  function handleVoiceInput(transcript, isFinal = false) {
    clearSilenceTimeout();
    if (proceedTimeout) clearTimeout(proceedTimeout);
    
    accumulatedTranscript = transcript;

    // Update live transcript overlay in real-time
    const liveEl = document.getElementById('liveTranscript');
    if (liveEl && transcript.trim()) {
      liveEl.textContent = transcript;
      liveEl.classList.add('visible');
    }
    
    if (isFinal) {
      if (accumulatedTranscript.trim()) {
        diag.logToTerminal(`[AI CORE] Speech finalized. Proceeding with command immediately: "${accumulatedTranscript}"`, "info");
        voice.stopListeningForCommand();
        // Mark conversation as active so the mic stays open for follow-up after the AI responds
        keepConversationAlive(10000);
        processCommand(accumulatedTranscript, 'voice');
        accumulatedTranscript = "";
        // Hide live transcript
        if (liveEl) liveEl.classList.remove('visible');
      }
    } else {
      // Process command quickly after 1.5s of silence (minimal gap for speech finalizer fallback)
      proceedTimeout = setTimeout(() => {
        if (accumulatedTranscript.trim()) {
          diag.logToTerminal(`[AI CORE] Speech timeout. Proceeding with command: "${accumulatedTranscript}"`, "info");
          voice.stopListeningForCommand();
          // Mark conversation as active so the mic stays open for follow-up after the AI responds
          keepConversationAlive(10000);
          processCommand(accumulatedTranscript, 'voice');
          accumulatedTranscript = "";
          // Hide live transcript
          if (liveEl) liveEl.classList.remove('visible');
        }
      }, 1500);
    }
  }

  voice.onSpeechDetected = (transcript) => {
    handleVoiceInput(transcript, false);
  };

  voice.onCommandRecognized = (transcript) => {
    handleVoiceInput(transcript, true);
  };

  // Handle blocked microphone permissions
  voice.onMicPermissionBlocked = () => {
    const banner = document.getElementById('micBlockedBanner');
    if (banner) {
      banner.style.display = 'flex';
    }
    diag.logToTerminal("[SECURITY ALERT] Microphone access is blocked. Please allow mic permissions to speak.", "error");
  };

  const reTriggerBtn = document.getElementById('requestMicPermBtn');
  if (reTriggerBtn) {
    reTriggerBtn.addEventListener('click', () => {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          // Hide banner
          const banner = document.getElementById('micBlockedBanner');
          if (banner) banner.style.display = 'none';
          stream.getTracks().forEach(track => track.stop()); // close temp stream
          diag.logToTerminal("[SYSTEM] Microphone access granted. Reloading system interface...", "info");
          setTimeout(() => location.reload(), 1000);
        })
        .catch(err => {
          console.error("Microphone permission denied again:", err);
          diag.logToTerminal("[SECURITY] Permission request denied again. Set site permissions manually.", "error");
          alert("Microphone permission was denied. Please click the lock or settings icon in your browser address bar next to the URL and set Microphone to 'Allow'.");
        });
    });
  }

  voice.onWakeWordDetected = () => {
    const isAlexa = localStorage.getItem('lukas_assistant_persona') === 'alexa';
    if (isAlexa) {
      playAlexaWakeChime();
    } else {
      playFuturisticBeep();
    }
    
    diag.logToTerminal("[AI CORE] Wake word 'LUKAS' recognized. Waking up core...", "info");
    
    const coreBtn = document.getElementById('lukasCoreBtn');
    if (coreBtn) {
      coreBtn.classList.add('waking');
      coreBtn.classList.remove('listening');
      coreBtn.classList.remove('processing');
    }

    voiceStatusText.textContent = isAlexa ? 'ALEXA AWAKE' : 'LUKAS AWAKE';
    voiceStatusText.style.color = 'var(--cyan-neon)';

    isWakingUp = true;
    const greeting = isAlexa ? "Yes?" : "Yes, Commander?";
    
    // Display greeting bubble
    appendChatBubble(greeting, 'assistant');
    
    // Speak the greeting vocally
    voice.speak(greeting);
  };

  voice.onSpeechStart = () => {
    coreCenterNode.classList.add('speaking');
    audioWaveform.classList.add('speaking');
    audioPlayer.volume = 0.08; // Duck music while speaking
  };

  voice.onSpeechEnd = () => {
    coreCenterNode.classList.remove('speaking');
    audioWaveform.classList.remove('speaking');
    audioPlayer.volume = 0.35; // Restore music volume
    
    const coreBtn = document.getElementById('lukasCoreBtn');

    if (isWakingUp) {
      isWakingUp = false;
      diag.logToTerminal("[AI CORE] Voice greeting finished. Listening for command...", "info");
      
      if (coreBtn) {
        coreBtn.classList.remove('waking');
        coreBtn.classList.add('listening');
        coreBtn.classList.remove('processing');
      }
      
      voice.startListeningForCommand();
      startSilenceTimeout();
      return;
    }

    if (voice.isLongConversation) return; // Long convo manages itself

    // Dynamic voice command flow: if the directive came via voice, keep the mic active for natural follow-ups
    if (lastCommandSource === 'voice') {
      diag.logToTerminal("[AI CORE] Staying active for follow-up commands (15s conversation window)...", "info");
      
      if (coreBtn) {
        coreBtn.classList.remove('waking');
        coreBtn.classList.add('listening');
        coreBtn.classList.remove('processing');
      }
      
      voice.startListeningForCommand();
      startSilenceTimeout();
      return;
    }

    if (coreBtn) {
      coreBtn.classList.remove('listening');
      coreBtn.classList.remove('processing');
      coreBtn.classList.remove('waking');
    }

    // Return to passive wake-word listening
    if (isPassiveListenEnabled) {
      diag.logToTerminal("[AI CORE] Returning to passive wake-word mode.", "info");
      setTimeout(() => voice.startWakeWordListener(), 300);
    } else {
      diag.logToTerminal("Lukas core offline. Standing standby.", "warn");
    }
  };

  // Click core for voice trigger shortcut (Single-turn voice command listening)
  document.getElementById('lukasCoreBtn').addEventListener('click', () => {
    voice.warmUpMic(); // Warm up mic stream on user gesture
    const isAlexa = localStorage.getItem('lukas_assistant_persona') === 'alexa';
    const coreBtn = document.getElementById('lukasCoreBtn');
    
    if (voice.isListening || isWakingUp) {
      isWakingUp = false;
      isPassiveListenEnabled = false;
      voice.stopListeningForCommand();
      clearSilenceTimeout();
      if (proceedTimeout) clearTimeout(proceedTimeout);
      accumulatedTranscript = "";
      
      if (isAlexa) {
        playAlexaErrorChime();
      } else {
        playShutdownBeep();
      }
      diag.logToTerminal("[AI CORE] Voice activation closed.", "info");
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
        coreBtn.classList.remove('waking');
      }
    } else {
      isPassiveListenEnabled = true;
      voice.startListeningForCommand();
      startSilenceTimeout();
      
      if (isAlexa) {
        playAlexaWakeChime();
      } else {
        playFuturisticBeep();
      }
      diag.logToTerminal(isAlexa ? "[AI CORE] Alexa listening..." : "[AI CORE] Lukas listening...", "info");
      if (coreBtn) {
        coreBtn.classList.add('listening');
        coreBtn.classList.remove('processing');
        coreBtn.classList.remove('waking');
      }
    }
  });

  // Climate thermostat controls
  document.getElementById('tempDownBtn').addEventListener('click', () => {
    home.setTargetTemperature(home.state.climate.targetTemp - 1);
  });
  document.getElementById('tempUpBtn').addEventListener('click', () => {
    home.setTargetTemperature(home.state.climate.targetTemp + 1);
  });

  document.querySelectorAll('.btn-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      home.setClimateMode(mode);
    });
  });

  // Light switches & Dimmer Sliders
  setupZoneControlListeners('Living', DEVICES.LIVING_ROOM);
  setupZoneControlListeners('Bedroom', DEVICES.BEDROOM);
  setupZoneControlListeners('Kitchen', DEVICES.KITCHEN);

  // Outdoor Security Lock controls
  const doorLockOutdoor = document.getElementById('doorLockOutdoor');
  doorLockOutdoor.addEventListener('change', (e) => {
    home.setDeviceState(DEVICES.OUTDOOR, { locked: e.target.checked });
  });

  const floodlightsOutdoor = document.getElementById('floodlightsOutdoor');
  floodlightsOutdoor.addEventListener('change', (e) => {
    home.setDeviceState(DEVICES.OUTDOOR, { floodlights: e.target.checked });
  });

  // Routines buttons
  document.querySelectorAll('.btn-routine').forEach(btn => {
    btn.addEventListener('click', () => {
      const routine = btn.dataset.routine;
      triggerRoutineEffect(routine);
    });
  });

  // CCTV Camera Maximize Event
  document.querySelectorAll('.cctv-camera-feed').forEach(feed => {
    feed.addEventListener('click', () => {
      // Toggle zoom maximize
      const isMaxed = feed.classList.contains('maximized');
      document.querySelectorAll('.cctv-camera-feed').forEach(f => f.classList.remove('maximized'));
      
      if (!isMaxed) {
        feed.classList.add('maximized');
        diag.logToTerminal(`Maximizing surveillance stream CAM 0${feed.dataset.camera}`, 'info');
      } else {
        diag.logToTerminal(`Reset surveillance streams layout`, 'info');
      }
      
      // Let CCTV redraw resize contexts
      setTimeout(() => {
        cctv.resizeCanvas(parseInt(feed.dataset.camera));
      }, 310);
    });
  });

  // Media Player Controls
  const mediaPlayBtn = document.getElementById('mediaPlayBtn');
  mediaPlayBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;
    updateMediaPlayButton(isPlaying);
    if (isPlaying) {
      playTrack();
      diag.logToTerminal(`Media Stream: PLAYING "${playlist[currentTrackIndex].title}"`, 'info');
    } else {
      audioPlayer.pause();
      diag.logToTerminal(`Media Stream: PAUSED`, 'info');
    }
  });

  document.getElementById('mediaNextBtn').addEventListener('click', () => {
    currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
    updateMediaWidget();
    if (isPlaying) {
      playTrack();
    }
    diag.logToTerminal(`Media loaded next stream: "${playlist[currentTrackIndex].title}"`, 'info');
  });

  document.getElementById('mediaPrevBtn').addEventListener('click', () => {
    currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
    updateMediaWidget();
    if (isPlaying) {
      playTrack();
    }
    diag.logToTerminal(`Media loaded previous stream: "${playlist[currentTrackIndex].title}"`, 'info');
  });

  // Media Platform Router click listeners
  const platformButtons = document.querySelectorAll('.platform-btn');
  platformButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      platformButtons.forEach(b => {
        b.classList.remove('active');
        b.style.opacity = '0.4';
      });
      btn.classList.add('active');
      btn.style.opacity = '1';
      
      const platformKey = btn.dataset.platform;
      activePlatform = platformKey === 'spotify' ? 'Spotify' :
                       platformKey === 'apple' ? 'Apple Play' :
                       platformKey === 'amazon' ? 'Amazon Music' : 'YouTube Music';
                       
      document.getElementById('mediaSourceText').textContent = activePlatform.toUpperCase();
      diag.logToTerminal(`[MEDIA ROUTER] Stream scheduled to play using ${activePlatform} gateway.`, 'info');
      voice.speak(`Routing playback through ${activePlatform}.`);
    });
  });

  // Custom Stream URL input logic
  const customAudioUrlInput = document.getElementById('customAudioUrlInput');
  const loadCustomAudioBtn = document.getElementById('loadCustomAudioBtn');

  if (loadCustomAudioBtn && customAudioUrlInput) {
    const playCustomStream = () => {
      const url = customAudioUrlInput.value.trim();
      if (!url) {
        diag.logToTerminal(`[MEDIA PLAYER] ⚠ Please paste a valid audio stream URL.`, 'warn');
        return;
      }
      
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        diag.logToTerminal(`[MEDIA PLAYER] ⚠ Stream URL must start with http:// or https://`, 'warn');
        return;
      }

      let title = "Custom Stream";
      try {
        const parsedUrl = new URL(url);
        const pathname = parsedUrl.pathname;
        const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
        if (filename && filename.includes('.')) {
          title = decodeURIComponent(filename);
        } else {
          title = `Stream from ${parsedUrl.hostname}`;
        }
      } catch(e) {}

      const customTrack = {
        title: title,
        artist: "Direct Audio Source",
        icon: "fa-satellite-dish",
        url: url
      };
      
      playlist.push(customTrack);
      currentTrackIndex = playlist.length - 1;
      
      isPlaying = true;
      updateMediaWidget();
      playTrack();
      
      diag.logToTerminal(`[MEDIA ROUTER] Loaded custom audio stream: "${title}"`, 'info');
      customAudioUrlInput.value = "";
    };

    loadCustomAudioBtn.addEventListener('click', playCustomStream);
    customAudioUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        playCustomStream();
      }
    });
  }

  // Weather card click handler to refresh weather
  const weatherCard = document.getElementById('weatherDisplayCard');
  if (weatherCard) {
    weatherCard.addEventListener('click', () => {
      requestLocalWeatherUpdate();
    });
  }

  // Node Registry modal UI events
  const modal = document.getElementById('nodeManagerModal');
  const openBtn = document.getElementById('openNodeManagerBtn');
  const closeBtn = document.getElementById('closeNodeManagerBtn');
  
  // Load initial configurations on load
  loadTuyaConfig();
  loadCameraConfig();

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
      loadTuyaConfig();
      loadCameraConfig();
      renderDynamicDevices();
      diag.logToTerminal('[NODE REGISTRY] Displaying advanced node manager panel.', 'info');
    });
  }
  
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      diag.logToTerminal('[NODE REGISTRY] Closing node manager panel.', 'info');
    });
  }
  
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
        diag.logToTerminal('[NODE REGISTRY] Closing node manager panel.', 'info');
      }
    });
  }

  // ── Accent Color Themes & Cockpit Controller ────────────────────────
  const themeAccentBtns = document.querySelectorAll('.theme-accent-btn');
  const registrySearch  = document.getElementById('registrySearchInput');
  const sysLatency      = document.getElementById('sysLatencyVal');
  const sysUptime       = document.getElementById('sysUptimeVal');
  const sysWebRtc       = document.getElementById('sysWebRtcVal');

  // Define Neon Accent Colors & Values
  const accentColors = {
    cyan: {
      neon: '#00f0ff',
      glow: 'rgba(0, 240, 255, 0.4)',
      border: 'rgba(0, 240, 255, 0.12)',
      borderFocus: 'rgba(0, 240, 255, 0.35)',
      shadow: '0 0 15px rgba(0, 240, 255, 0.4)',
      grid: 'rgba(0, 240, 255, 0.03)'
    },
    purple: {
      neon: '#a855f7',
      glow: 'rgba(168, 85, 247, 0.4)',
      border: 'rgba(168, 85, 247, 0.12)',
      borderFocus: 'rgba(168, 85, 247, 0.35)',
      shadow: '0 0 15px rgba(168, 85, 247, 0.4)',
      grid: 'rgba(168, 85, 247, 0.03)'
    },
    rose: {
      neon: '#f43f5e',
      glow: 'rgba(244, 63, 94, 0.4)',
      border: 'rgba(244, 63, 94, 0.12)',
      borderFocus: 'rgba(244, 63, 94, 0.35)',
      shadow: '0 0 15px rgba(244, 63, 94, 0.4)',
      grid: 'rgba(244, 63, 94, 0.03)'
    },
    emerald: {
      neon: '#10b981',
      glow: 'rgba(16, 185, 129, 0.4)',
      border: 'rgba(16, 185, 129, 0.12)',
      borderFocus: 'rgba(16, 185, 129, 0.35)',
      shadow: '0 0 15px rgba(16, 185, 129, 0.4)',
      grid: 'rgba(16, 185, 129, 0.03)'
    },
    amber: {
      neon: '#f59e0b',
      glow: 'rgba(245, 158, 11, 0.4)',
      border: 'rgba(245, 158, 11, 0.12)',
      borderFocus: 'rgba(245, 158, 11, 0.35)',
      shadow: '0 0 15px rgba(245, 158, 11, 0.4)',
      grid: 'rgba(245, 158, 11, 0.03)'
    }
  };

  function applyAccentTheme(themeName) {
    const theme = accentColors[themeName] || accentColors.cyan;
    document.documentElement.style.setProperty('--cyan-neon', theme.neon);
    document.documentElement.style.setProperty('--cyan-neon-glow', theme.glow);
    document.documentElement.style.setProperty('--glass-border', theme.border);
    document.documentElement.style.setProperty('--glass-border-focus', theme.borderFocus);
    document.documentElement.style.setProperty('--shadow-neon', theme.shadow);
    document.documentElement.style.setProperty('--color-grid', theme.grid);

    // Update active class on buttons
    themeAccentBtns.forEach(btn => {
      const isSelected = btn.dataset.theme === themeName;
      if (isSelected) {
        btn.classList.add('active');
        btn.style.border = `1px solid ${theme.neon}`;
        btn.style.background = theme.glow.replace('0.4', '0.12');
        btn.style.color = theme.neon;
      } else {
        btn.classList.remove('active');
        btn.style.border = '1px solid rgba(255, 255, 255, 0.08)';
        btn.style.background = 'rgba(255, 255, 255, 0.02)';
        btn.style.color = '#94a3b8';
      }
    });

    diag.logToTerminal(`[SETTINGS] System accent theme color shifted to ${themeName.toUpperCase()}.`, 'info');
  }

  // Bind theme button events
  themeAccentBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      applyAccentTheme(theme);
      localStorage.setItem('lukas_accent_theme', theme);
    });
  });

  // Load theme preference on load
  const savedTheme = localStorage.getItem('lukas_accent_theme') || 'cyan';
  applyAccentTheme(savedTheme);

  // Search Filter functionality for Active Devices
  if (registrySearch) {
    registrySearch.addEventListener('input', () => {
      renderDynamicDevices();
    });
  }

  // Cockpit Diagnostics Monitoring
  let uptimeSec = 0;
  function updateCockpitStats() {
    // Latency probe (simulate dynamic response to local server)
    const startTime = Date.now();
    fetch('/api/hls-status')
      .then(res => res.json())
      .then(data => {
        const latency = Date.now() - startTime;
        if (sysLatency) {
          sysLatency.textContent = `${latency} ms`;
          sysLatency.style.color = latency < 100 ? 'var(--emerald-neon)' : 'var(--amber-neon)';
        }
        if (sysWebRtc) {
          sysWebRtc.textContent = data.live ? 'ONLINE' : 'STANDBY';
          sysWebRtc.style.color = data.live ? 'var(--emerald-neon)' : 'var(--amber-neon)';
        }
      })
      .catch(() => {
        if (sysLatency) sysLatency.textContent = 'timeout';
        if (sysWebRtc) {
          sysWebRtc.textContent = 'OFFLINE';
          sysWebRtc.style.color = 'var(--rose-neon)';
        }
      });

    // Uptime formatter
    uptimeSec += 5;
    const hrs = String(Math.floor(uptimeSec / 3600)).padStart(2, '0');
    const mins = String(Math.floor((uptimeSec % 3600) / 60)).padStart(2, '0');
    const secs = String(uptimeSec % 60).padStart(2, '0');
    if (sysUptime) sysUptime.textContent = `${hrs}h ${mins}m ${secs}s`;
  }

  // Update diagnostics every 5 seconds
  setInterval(updateCockpitStats, 5000);
  updateCockpitStats();

  // ── Device Pairing Wizard Controller ────────────────────────────────
  const startWizardBtn      = document.getElementById('startPairingWizardBtn');
  const cancelWizardBtn     = document.getElementById('cancelWizardBtn');
  const registryView        = document.getElementById('settingsRegistryView');
  const wizardView          = document.getElementById('settingsWizardView');
  
  const registryTitleText   = document.getElementById('registryTitleText');
  const registryHeaderControls = document.getElementById('registryHeaderControls');
  
  const brandCards          = document.querySelectorAll('.brand-select-card');
  const activeBrandLabel    = document.getElementById('wizardActiveBrandLabel');
  const wizardPairForm      = document.getElementById('wizardPairForm');
  const wizardDynamicFields = document.getElementById('wizardDynamicFields');
  const wizardDeviceName    = document.getElementById('wizardDeviceName');
  const wizardPairingLog    = document.getElementById('wizardPairingLog');
  const wizardPairingStatus = document.getElementById('wizardPairingStatusText');
  const wizardMicroProgress = document.getElementById('wizardPairingMicroProgress');
  
  const wizardZoneSelect    = document.getElementById('wizardZoneSelect');
  const wizardPreviewName   = document.getElementById('wizardPreviewName');
  const wizardPreviewMeta   = document.getElementById('wizardPreviewMeta');
  const wizardPreviewIcon   = document.getElementById('wizardPreviewIcon');
  const wizardCompleteBtn   = document.getElementById('wizardCompleteBtn');

  let activeWizardBrand = 'wipro';
  let wizardTempData = null;

  function playSuccessChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc1.type = 'sine';
      osc2.type = 'sine';
      
      const now = ctx.currentTime;
      osc1.frequency.setValueAtTime(523.25, now); // C5
      osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.15); // E5
      osc1.frequency.exponentialRampToValueAtTime(987.77, now + 0.3); // B5
      
      osc2.frequency.setValueAtTime(392.00, now); // G4
      osc2.frequency.exponentialRampToValueAtTime(523.25, now + 0.15); // C5
      osc2.frequency.exponentialRampToValueAtTime(830.61, now + 0.3); // G#5
      
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.5);
      osc2.stop(now + 0.5);
    } catch (e) {
      console.warn("Web Audio chime failed to play:", e);
    }
  }

  function goToWizardStep(step) {
    for (let s = 1; s <= 4; s++) {
      const el = document.getElementById(`wizardStep${s}`);
      if (el) el.style.display = (s === step) ? 'flex' : 'none';
    }
    
    const indicator = document.getElementById('wizardStepIndicator');
    const progress = document.getElementById('wizardProgressBar');
    if (indicator) indicator.textContent = `STEP ${step} OF 4`;
    if (progress) progress.style.width = `${step * 25}%`;
  }

  // Toggle Wizard View
  if (startWizardBtn) {
    startWizardBtn.addEventListener('click', () => {
      if (registryView) registryView.style.display = 'none';
      if (wizardView) wizardView.style.display = 'flex';
      
      if (registryTitleText) {
        registryTitleText.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--cyan-neon);"></i> DEVICE INTEGRATION WIZARD`;
      }
      if (registryHeaderControls) registryHeaderControls.style.display = 'none';
      
      goToWizardStep(1);
    });
  }

  if (cancelWizardBtn) {
    cancelWizardBtn.addEventListener('click', () => {
      if (registryView) registryView.style.display = 'flex';
      if (wizardView) wizardView.style.display = 'none';
      
      if (registryTitleText) {
        registryTitleText.innerHTML = `<i class="fa-solid fa-cubes" style="color:var(--cyan-neon);"></i> ACTIVE REGISTERED NODES`;
      }
      if (registryHeaderControls) registryHeaderControls.style.display = 'flex';
    });
  }

  // Brand selection clicks
  brandCards.forEach(card => {
    card.addEventListener('click', () => {
      const brand = card.dataset.brand;
      activeWizardBrand = brand;
      
      if (activeBrandLabel) activeBrandLabel.textContent = brand.toUpperCase();
      
      // Generate dynamic input fields
      generateWizardFields(brand);
      
      // Advance to step 2
      goToWizardStep(2);
    });
  });

  function generateWizardFields(brand) {
    if (!wizardDynamicFields) return;
    
    wizardDynamicFields.innerHTML = '';
    const guide = document.getElementById('wizardPairingGuide');
    
    if (brand === 'wipro') {
      if (guide) guide.innerHTML = `<i class="fa-solid fa-lightbulb"></i> Pair your physical Wipro Bulb. Enter the Tuya Device ID. The hub links to Tuya Cloud APIs.`;
      wizardDeviceName.value = 'Wipro Smart Light';
      
      wizardDynamicFields.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Tuya Device ID</label>
          <input type="text" id="wizardFieldId" placeholder="Enter Tuya Device ID (e.g. 17098...)" required style="padding:0.35rem 0.5rem; font-size:0.68rem;" />
        </div>
      `;
    } else if (brand === 'eseecloud') {
      if (guide) guide.innerHTML = `<i class="fa-solid fa-video"></i> Setup your EseeCloud / IP Pro Camera. Enter the local IP Address and admin credentials.`;
      wizardDeviceName.value = 'EseeCloud Camera';
      
      wizardDynamicFields.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Camera IP Address</label>
          <input type="text" id="wizardFieldIp" value="192.168.1.3" placeholder="e.g. 192.168.1.3" required style="padding:0.35rem 0.5rem; font-size:0.68rem;" />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Username (or Cloud Email)</label>
          <input type="text" id="wizardFieldUser" value="admin" required style="padding:0.35rem 0.5rem; font-size:0.68rem;" />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Password (or Cloud Password)</label>
          <input type="password" id="wizardFieldPass" placeholder="Enter password (if any)" style="padding:0.35rem 0.5rem; font-size:0.68rem;" />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">RTSP Stream Path</label>
          <select id="wizardFieldPath" style="width:100%; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.08); color:#fff; border-radius:4px; padding:0.35rem 0.5rem; font-size:0.68rem; height:28px;">
            <option value="onvif2">EseeCloud Substream (onvif2)</option>
            <option value="ch0_0.264">EseeCloud Mainstream (ch0_0.264)</option>
            <option value="onvif1">EseeCloud Alternate (onvif1)</option>
          </select>
        </div>
      `;
    } else if (brand === 'jio') {
      if (guide) guide.innerHTML = `<i class="fa-solid fa-house-signal"></i> Pair Jio Home Smart devices. Select device category and input the network IP address.`;
      wizardDeviceName.value = 'Jio Smart Plug';
      
      wizardDynamicFields.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Device Type / Category</label>
          <select id="wizardFieldCategory" style="width:100%; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.08); color:#fff; border-radius:4px; padding:0.35rem 0.5rem; font-size:0.68rem; height:28px;">
            <option value="plug">Smart Plug (🔌)</option>
            <option value="switch">Smart Switch (🎛️)</option>
            <option value="hub">Jio Smart Hub (🎚️)</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Device IP Address</label>
          <input type="text" id="wizardFieldIp" placeholder="e.g. 192.168.1.150" required style="padding:0.35rem 0.5rem; font-size:0.68rem;" />
        </div>
      `;
    } else if (brand === 'nest') {
      if (guide) guide.innerHTML = `<i class="fa-brands fa-google"></i> Connect Google Nest assistant nodes. Select model and input IP address.`;
      wizardDeviceName.value = 'Nest Mini Speaker';
      
      wizardDynamicFields.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Nest Model</label>
          <select id="wizardFieldCategory" style="width:100%; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.08); color:#fff; border-radius:4px; padding:0.35rem 0.5rem; font-size:0.68rem; height:28px;">
            <option value="speaker">Google Nest Mini (🔊)</option>
            <option value="tv">Nest Hub Display (📺)</option>
            <option value="camera">Nest Cam (📷)</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Nest IP Address / ID</label>
          <input type="text" id="wizardFieldIp" placeholder="e.g. 192.168.1.18" required style="padding:0.35rem 0.5rem; font-size:0.68rem;" />
        </div>
      `;
    } else if (brand === 'tuya') {
      if (guide) guide.innerHTML = `<i class="fa-solid fa-plug"></i> Pair generic Smart Life / Tuya accessories. Provide device ID and select category.`;
      wizardDeviceName.value = 'Smart Life Plug';
      
      wizardDynamicFields.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Tuya Device Category</label>
          <select id="wizardFieldCategory" style="width:100%; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.08); color:#fff; border-radius:4px; padding:0.35rem 0.5rem; font-size:0.68rem; height:28px;">
            <option value="plug">Smart Plug (🔌)</option>
            <option value="sensor">Motion Sensor (📡)</option>
            <option value="siren">Alarm Siren (🚨)</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Tuya Device ID</label>
          <input type="text" id="wizardFieldId" placeholder="Enter Tuya Device ID" required style="padding:0.35rem 0.5rem; font-size:0.68rem;" />
        </div>
      `;
    } else if (brand === 'hue') {
      if (guide) guide.innerHTML = `<i class="fa-solid fa-circle-dot"></i> Connect Philips Hue Zigbee lights. Input Hue Bridge IP address and Bulb ID.`;
      wizardDeviceName.value = 'Hue Smart Bulb';
      
      wizardDynamicFields.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Hue Bridge IP Address</label>
          <input type="text" id="wizardFieldIp" placeholder="e.g. 192.168.1.45" required style="padding:0.35rem 0.5rem; font-size:0.68rem;" />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:0.55rem; color:#64748b;">Bulb Number ID</label>
          <input type="number" id="wizardFieldId" value="1" min="1" required style="padding:0.35rem 0.5rem; font-size:0.68rem;" />
        </div>
      `;
    }
  }

  // Handle Form pairing initiate
  if (wizardPairForm) {
    wizardPairForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const customName = wizardDeviceName.value.trim();
      if (!customName) return;
      
      // Gather dynamic fields data
      let idVal = '';
      let ipVal = '0.0.0.0';
      let category = 'light';
      let protocol = 'WiFi';
      let integration = 'demo';
      
      const fieldId   = document.getElementById('wizardFieldId');
      const fieldIp   = document.getElementById('wizardFieldIp');
      const fieldCat  = document.getElementById('wizardFieldCategory');
      
      if (fieldId) idVal = fieldId.value.trim();
      if (fieldIp) ipVal = fieldIp.value.trim();
      
      if (activeWizardBrand === 'wipro') {
        category = 'light';
        protocol = 'WiFi';
        integration = 'tuya-cloud';
      } else if (activeWizardBrand === 'eseecloud') {
        category = 'camera';
        protocol = 'P2P';
        integration = 'demo';
      } else if (activeWizardBrand === 'jio') {
        category = fieldCat ? fieldCat.value : 'plug';
        protocol = 'WiFi';
        integration = 'demo';
      } else if (activeWizardBrand === 'nest') {
        category = fieldCat ? fieldCat.value : 'speaker';
        protocol = 'WiFi';
        integration = 'demo';
      } else if (activeWizardBrand === 'tuya') {
        category = fieldCat ? fieldCat.value : 'plug';
        protocol = 'WiFi';
        integration = 'tuya-cloud';
      } else if (activeWizardBrand === 'hue') {
        category = 'light';
        protocol = 'Zigbee';
        integration = 'demo';
      }

      // Store temp data
      wizardTempData = {
        name: customName,
        category: category,
        protocol: protocol,
        ipAddress: ipVal,
        integration: integration,
        tuyaDeviceId: idVal,
        tuyaLocalKey: ''
      };
      
      // Auto-save EseeCloud camera credentials if paired via EseeCloud brand
      if (activeWizardBrand === 'eseecloud') {
        const fieldUser = document.getElementById('wizardFieldUser');
        const fieldPass = document.getElementById('wizardFieldPass');
        const fieldPath = document.getElementById('wizardFieldPath');
        
        const ip = ipVal;
        const user = fieldUser ? fieldUser.value.trim() : 'admin';
        const pass = fieldPass ? fieldPass.value.trim() : '';
        const path = fieldPath ? fieldPath.value : 'onvif2';
        
        // Save camera configs
        fetch('/api/camera-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ipAddress: ip, username: user, password: pass, rtspPath: path })
        }).then(res => res.json()).then(resData => {
          if (resData.success) {
            diag.logToTerminal(`[CCTV PAIRING] Registered camera parameters to WebRTC backend.`, 'info');
            setTimeout(async () => {
              await loadCameraConfig();
              connectLiveCamera();
            }, 2000);
          }
        }).catch(err => {
          console.warn("Camera pairing api failed:", err);
        });
      }

      // Start pairing loader
      startPairingHandshakeSequence();
    });
  }

  function startPairingHandshakeSequence() {
    goToWizardStep(3);
    
    let progress = 10;
    if (wizardMicroProgress) wizardMicroProgress.style.width = '10%';
    
    // Choose loading icon depending on category
    const icons = {
      light: '<i class="fa-solid fa-lightbulb fa-fade"></i>',
      camera: '<i class="fa-solid fa-video fa-fade"></i>',
      plug: '<i class="fa-solid fa-plug fa-fade"></i>',
      speaker: '<i class="fa-solid fa-volume-high fa-fade"></i>',
      tv: '<i class="fa-solid fa-tv fa-fade"></i>',
      sensor: '<i class="fa-solid fa-gauge fa-fade"></i>',
      hub: '<i class="fa-solid fa-circle-nodes fa-fade"></i>'
    };
    const iconEl = document.getElementById('wizardPairingIcon');
    if (iconEl) iconEl.innerHTML = icons[wizardTempData.category] || '<i class="fa-solid fa-network-wired fa-fade"></i>';

    const logs = [
      `[SYSTEM] Connecting to broadcast channels...`,
      `[NETWORK] Dispatching Matter pairing beacon...`,
      `[HANDSHAKE] Discovered node matching criteria. Protocol: ${wizardTempData.protocol.toUpperCase()}`,
      `[SECURITY] Exchanging ECDH public keys with Matter controller...`,
      `[INTEGRATION] Establishing secure tunnel. Key validated.`,
      `[REGISTRY] Registering hardware address: ${wizardTempData.ipAddress}`,
      `[SUCCESS] Node linked successfully to Lukas Hub!`
    ];

    if (wizardPairingLog) {
      wizardPairingLog.innerHTML = `<span style="color:var(--cyan-neon);">[INIT] Booting wizard pairing module...</span><br>`;
    }
    
    let logIdx = 0;
    const interval = setInterval(() => {
      logIdx++;
      progress += 15;
      
      if (wizardMicroProgress) wizardMicroProgress.style.width = `${progress}%`;
      
      if (wizardPairingLog && logs[logIdx]) {
        wizardPairingLog.innerHTML += `<span style="color:#a78bfa;">${logs[logIdx]}</span><br>`;
        wizardPairingLog.scrollTop = wizardPairingLog.scrollHeight;
      }
      
      if (wizardPairingStatus) {
        if (progress < 50) wizardPairingStatus.textContent = 'CONNECTING TO HARDWARE...';
        else if (progress < 80) wizardPairingStatus.textContent = 'EXCHANGING CRYPTO SECURE KEYS...';
        else wizardPairingStatus.textContent = 'RESOLVING DEVICE SERVICE METADATA...';
      }

      if (progress >= 100) {
        clearInterval(interval);
        
        // Show Step 4 (Success and room picker)
        setTimeout(() => {
          if (wizardPreviewName) wizardPreviewName.textContent = wizardTempData.name;
          if (wizardPreviewMeta) wizardPreviewMeta.textContent = `${wizardTempData.protocol} • ${wizardTempData.ipAddress}`;
          
          let previewIconHtml = '<i class="fa-solid fa-cube"></i>';
          if (wizardTempData.category === 'light') previewIconHtml = '<i class="fa-solid fa-lightbulb"></i>';
          else if (wizardTempData.category === 'camera') previewIconHtml = '<i class="fa-solid fa-video"></i>';
          else if (wizardTempData.category === 'plug') previewIconHtml = '<i class="fa-solid fa-plug"></i>';
          else if (wizardTempData.category === 'speaker') previewIconHtml = '<i class="fa-solid fa-volume-high"></i>';
          else if (wizardTempData.category === 'tv') previewIconHtml = '<i class="fa-solid fa-tv"></i>';
          
          if (wizardPreviewIcon) wizardPreviewIcon.innerHTML = previewIconHtml;
          
          goToWizardStep(4);
        }, 500);
      }
    }, 400);
  }

  // Complete integration button click
  if (wizardCompleteBtn) {
    wizardCompleteBtn.addEventListener('click', () => {
      if (!wizardTempData) return;
      
      const zone = wizardZoneSelect ? wizardZoneSelect.value : 'Living Room';
      
      // Add device dynamically
      const newDev = home.addDevice(
        wizardTempData.name,
        zone,
        wizardTempData.category,
        wizardTempData.protocol,
        wizardTempData.ipAddress,
        wizardTempData.integration,
        wizardTempData.tuyaDeviceId,
        wizardTempData.tuyaLocalKey
      );
      
      diag.logToTerminal(`[WIZARD] ✅ Successfully paired "${newDev.name}" (${newDev.ipAddress}) to ${newDev.zone} registry.`, 'info');
      
      // Play audio chime
      playSuccessChime();
      
      // Verbal feedback
      if (voice.synthesisActive) {
        handleAssistantResponse(`Pairing successful. Added ${newDev.name} to your ${newDev.zone}.`);
      }
      
      // Clear forms
      if (wizardPairForm) wizardPairForm.reset();
      wizardTempData = null;
      
      // Refresh registry view
      renderDynamicDevices();
      
      // Go back to registry view
      if (registryView) registryView.style.display = 'flex';
      if (wizardView) wizardView.style.display = 'none';
      if (registryTitleText) {
        registryTitleText.innerHTML = `<i class="fa-solid fa-cubes" style="color:var(--cyan-neon);"></i> ACTIVE REGISTERED NODES`;
      }
      if (registryHeaderControls) registryHeaderControls.style.display = 'flex';
    });
  }


  // ── Tuya Config Form (Settings Tab) ────────────────────────────────
  async function loadTuyaConfig() {
    try {
      const resp = await fetch('/api/tuya-config');
      const data = await resp.json();
      if (data) {
        tuyaConfigured = !!(data.clientId && data.clientSecret);
        const clientInput = document.getElementById('tuyaClientIdInput');
        const secretInput = document.getElementById('tuyaClientSecretInput');
        const regionSelect = document.getElementById('tuyaRegionSelect');
        if (clientInput) clientInput.value = data.clientId || '';
        if (secretInput) secretInput.value = data.clientSecret || '';
        if (regionSelect) regionSelect.value = data.region || 'openapi.tuyain.com';
        renderDynamicDevices();
      }
    } catch(e) {}
  }

  async function loadCameraConfig() {
    try {
      const resp = await fetch('/api/camera-config');
      const data = await resp.json();
      
      const cctvIpInput = document.getElementById('cctvIpInput');
      const cctvUserInput = document.getElementById('cctvUserInput');
      const cctvPassInput = document.getElementById('cctvPassInput');
      const cctvPathSelect = document.getElementById('cctvPathSelect');

      if (data.cloudEmail) {
        // Cloud mode is active
        if (cctvIpInput) cctvIpInput.value = '192.168.1.3';
        if (cctvUserInput) cctvUserInput.value = data.cloudEmail;
        if (cctvPassInput) cctvPassInput.value = data.cloudPassword;
        if (cctvPathSelect) cctvPathSelect.value = 'onvif2';
        
        showCloudCameraUI(data.cloudEmail);
      } else {
        if (data.config) {
          // Parse RTSP URL from yaml: e.g., rtsp://username:password@ipAddress:554/path
          const match = data.config.match(/rtsp:\/\/([^:]+):([^@]+)@([^:]+):554\/(.+)/);
          if (match) {
            if (cctvIpInput) cctvIpInput.value = match[3] || '192.168.1.3';
            if (cctvUserInput) cctvUserInput.value = decodeURIComponent(match[1]) || 'admin';
            if (cctvPassInput) cctvPassInput.value = decodeURIComponent(match[2]) || '';
            if (cctvPathSelect) cctvPathSelect.value = match[4].trim() || 'onvif2';
          }
        }
        showLocalCameraUI();
      }
      
      // Update camera status badge
      const statusResp = await fetch('/api/hls-status');
      const statusData = await statusResp.json();
      const cameraStatusBadge = document.getElementById('cameraStatusBadge');
      if (cameraStatusBadge) {
        if (data.cloudEmail) {
          cameraStatusBadge.textContent = 'ESEECLOUD';
          cameraStatusBadge.style.background = 'rgba(168,85,247,0.12)';
          cameraStatusBadge.style.borderColor = 'var(--purple-neon)';
          cameraStatusBadge.style.color = '#d8b4fe';
        } else if (statusData.live) {
          cameraStatusBadge.textContent = 'ONLINE';
          cameraStatusBadge.style.background = 'rgba(16,185,129,0.12)';
          cameraStatusBadge.style.borderColor = '#10b981';
          cameraStatusBadge.style.color = '#34d399';
        } else {
          cameraStatusBadge.textContent = 'OFFLINE';
          cameraStatusBadge.style.background = 'rgba(244,63,94,0.08)';
          cameraStatusBadge.style.borderColor = 'rgba(244,63,94,0.15)';
          cameraStatusBadge.style.color = 'var(--rose-neon)';
        }
      }
    } catch(e) {}
  }

  function showCloudCameraUI(email) {
    const video = document.getElementById('cctvLive1');
    const placeholder = document.getElementById('cam1Placeholder');
    const statusBadge = document.getElementById('cam1StatusBadge');
    
    if (statusBadge) {
      statusBadge.textContent = '● ESEECLOUD ACTIVE';
      statusBadge.style.color = '#d8b4fe';
    }
    
    if (video) video.style.display = 'none';
    
    if (placeholder) {
      placeholder.style.display = 'flex';
      placeholder.style.zIndex = '5';
      placeholder.style.background = 'linear-gradient(135deg, #0a061a 0%, #05030a 100%)';
      placeholder.innerHTML = `
        <div style="font-size:2rem; color:var(--purple-neon); margin-bottom:0.5rem; animation: pulse 2s infinite;"><i class="fa-solid fa-cloud"></i></div>
        <div style="font-family:var(--font-mono); font-size:0.6rem; color:#d8b4fe; text-align:center; max-width:90%; line-height:1.5; margin-bottom: 0.6rem;">
          ESEECLOUD CLOUD CONFIG ACTIVE<br>
          <span style="color:#64748b; font-size:0.52rem;">User: ${email}</span>
        </div>
        <button id="launchCloudBtn" style="background:rgba(168,85,247,0.12); border:1px solid var(--purple-neon); color:#d8b4fe; font-family:var(--font-mono); font-size:0.55rem; padding:0.35rem 0.85rem; border-radius:4px; cursor:pointer; letter-spacing:0.05em; font-weight:bold; transition:all 0.2s; display: flex; align-items: center; gap: 0.35rem;" onmouseover="this.style.background='var(--purple-neon)'; this.style.color='#000';" onmouseout="this.style.background='rgba(168,85,247,0.12)'; this.style.color='#d8b4fe';">
          <i class="fa-solid fa-up-right-from-square"></i> LAUNCH CLOUD VIEWER
        </button>
        <span style="font-size:0.5rem; color:#475569; margin-top:0.4rem; font-family:var(--font-mono); text-align:center;">Viewer login matches the saved email</span>
      `;
      
      const launchBtn = document.getElementById('launchCloudBtn');
      if (launchBtn) {
        launchBtn.addEventListener('click', () => {
          window.open('https://v.dvr163.com/#/', 'EseeCloud Web Viewer', 'width=1024,height=768');
        });
      }
    }
  }

  function showLocalCameraUI() {
    const video = document.getElementById('cctvLive1');
    const placeholder = document.getElementById('cam1Placeholder');
    const statusBadge = document.getElementById('cam1StatusBadge');
    
    if (statusBadge) {
      statusBadge.textContent = 'CONNECTING...';
      statusBadge.style.color = '#94a3b8';
    }
    
    if (video) video.style.display = 'block';
    
    if (placeholder) {
      placeholder.style.display = 'flex';
      placeholder.style.background = 'linear-gradient(135deg, #0a0a1a 0%, #0d1117 100%)';
      placeholder.innerHTML = `
        <div id="cam1PlaceholderIcon" style="font-size:2rem; color:#334155; margin-bottom:0.5rem;"><i class="fa-solid fa-video-slash"></i></div>
        <div id="cam1PlaceholderText" style="font-family:var(--font-mono); font-size:0.6rem; color:#475569; text-align:center; max-width:90%; line-height:1.5;">STREAM OFFLINE<br>Use Settings → CCTV Config to connect</div>
        <button id="cam1ProbeBtn" style="margin-top:0.75rem; background:rgba(0,240,255,0.08); border:1px solid rgba(0,240,255,0.2); color:var(--cyan-neon); font-family:var(--font-mono); font-size:0.55rem; padding:0.3rem 0.75rem; border-radius:4px; cursor:pointer; letter-spacing:0.05em;">
          <i class="fa-solid fa-satellite-dish"></i> AUTO-PROBE CAMERA
        </button>
        <a href="https://v.dvr163.com/#/" target="_blank" style="margin-top:0.5rem; font-family:var(--font-mono); font-size:0.52rem; color:#64748b; text-decoration:underline;">Open EseeCloud Web Portal (v.dvr163.com) ↗</a>
      `;
      wireProbeButton();
    }
  }


  const tuyaForm = document.getElementById('tuyaConfigForm');
  const tuyaStatusMsg = document.getElementById('tuyaStatusMsg');

  if (tuyaForm) {
    tuyaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const clientId = document.getElementById('tuyaClientIdInput').value.trim();
      const clientSecret = document.getElementById('tuyaClientSecretInput').value.trim();
      const region = document.getElementById('tuyaRegionSelect').value;

      if (!clientId || !clientSecret) {
        if (tuyaStatusMsg) {
          tuyaStatusMsg.style.display = 'block';
          tuyaStatusMsg.style.color = 'var(--rose-neon)';
          tuyaStatusMsg.textContent = '⚠ Access ID and Client Secret are required.';
        }
        return;
      }

      if (tuyaStatusMsg) {
        tuyaStatusMsg.style.display = 'block';
        tuyaStatusMsg.style.color = 'var(--cyan-neon)';
        tuyaStatusMsg.textContent = '⏳ Saving Tuya Developer credentials...';
      }

      try {
        const resp = await fetch('/api/tuya-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, clientSecret, region })
        });
        const resData = await resp.json();
        if (resData.success) {
          tuyaConfigured = true;
          if (tuyaStatusMsg) {
            tuyaStatusMsg.style.color = 'var(--emerald-neon)';
            tuyaStatusMsg.textContent = '✅ Credentials saved! You can now control integrated Wipro/Tuya devices.';
          }
          diag.logToTerminal('[TUYA CONFIG] ✅ Tuya API credentials saved successfully.', 'info');
          renderDynamicDevices();
        } else {
          if (tuyaStatusMsg) {
            tuyaStatusMsg.style.color = 'var(--rose-neon)';
            tuyaStatusMsg.textContent = `❌ Error: ${resData.error}`;
          }
          diag.logToTerminal(`[TUYA CONFIG] ❌ Failed: ${resData.error}`, 'error');
        }
      } catch (err) {
        if (tuyaStatusMsg) {
          tuyaStatusMsg.style.color = 'var(--rose-neon)';
          tuyaStatusMsg.textContent = '❌ Backend connection failed.';
        }
        diag.logToTerminal('[TUYA CONFIG] ❌ Could not reach Vite backend API.', 'error');
      }
    });
  }

  const cctvForm = document.getElementById('cctvConfigForm');
  const cctvStatusMsg = document.getElementById('cctvStatusMsg');

  if (cctvForm) {
    cctvForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ipAddress = document.getElementById('cctvIpInput').value.trim();
      const username = document.getElementById('cctvUserInput').value.trim();
      const password = document.getElementById('cctvPassInput').value.trim();
      const rtspPath = document.getElementById('cctvPathSelect').value;

      if (!ipAddress || !username) {
        if (cctvStatusMsg) {
          cctvStatusMsg.style.display = 'block';
          cctvStatusMsg.style.color = 'var(--rose-neon)';
          cctvStatusMsg.textContent = '⚠ IP Address and Username are required.';
        }
        return;
      }

      if (cctvStatusMsg) {
        cctvStatusMsg.style.display = 'block';
        cctvStatusMsg.style.color = 'var(--cyan-neon)';
        cctvStatusMsg.textContent = '⏳ Saving CCTV credentials and connecting proxy...';
      }

      try {
        const resp = await fetch('/api/camera-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ipAddress, username, password, rtspPath })
        });
        const resData = await resp.json();
        if (resData.success) {
          if (cctvStatusMsg) {
            cctvStatusMsg.style.color = 'var(--emerald-neon)';
            cctvStatusMsg.textContent = '✅ Camera settings saved! Rebooting WebRTC stream proxy...';
          }
          diag.logToTerminal(`[CCTV CONFIG] Camera stream registered: rtsp://${username}:****@${ipAddress}/${rtspPath}`, 'info');
          
          setTimeout(async () => {
            await loadCameraConfig();
            connectLiveCamera();
          }, 3000);
        } else {
          if (cctvStatusMsg) {
            cctvStatusMsg.style.color = 'var(--rose-neon)';
            cctvStatusMsg.textContent = `❌ Error: ${resData.error}`;
          }
          diag.logToTerminal(`[CCTV CONFIG] ❌ Failed to save: ${resData.error}`, 'error');
        }
      } catch (err) {
        if (cctvStatusMsg) {
          cctvStatusMsg.style.color = 'var(--rose-neon)';
          cctvStatusMsg.textContent = '❌ Backend connection failed.';
        }
        diag.logToTerminal('[CCTV CONFIG] ❌ Could not reach Vite backend API.', 'error');
      }
    });
  }


  // ── System Preferences sliders ────────────────────────────────────────
  const volRange   = document.getElementById('sysVolumeRange');
  const volLabel   = document.getElementById('sysVolumeLabel');
  const rateRange  = document.getElementById('sysSpeechRate');
  const rateLabel  = document.getElementById('sysSpeechRateLabel');

  // Init from saved prefs
  if (volRange) {
    const savedVol = Math.round((voice.vocalVolume || 1.0) * 100);
    volRange.value = savedVol;
    if (volLabel) volLabel.textContent = `${savedVol}%`;
    volRange.addEventListener('input', () => {
      const pct = parseInt(volRange.value);
      if (volLabel) volLabel.textContent = `${pct}%`;
      voice.setVolume(pct / 100);
      diag.logToTerminal(`[SETTINGS] Vocal volume set to ${pct}%.`, 'info');
    });
  }

  if (rateRange) {
    const savedRate = voice.vocalRate || 1.0;
    rateRange.value = Math.round(savedRate * 10);
    if (rateLabel) rateLabel.textContent = `${savedRate.toFixed(1)}x`;
    rateRange.addEventListener('input', () => {
      const rate = parseInt(rateRange.value) / 10;
      if (rateLabel) rateLabel.textContent = `${rate.toFixed(1)}x`;
      voice.setRate(rate);
      diag.logToTerminal(`[SETTINGS] Voice reading speed set to ${rate.toFixed(1)}x.`, 'info');
    });
  }

  // ── Assistant Persona & Brief Mode ────────────────────────────────────
  const personaSelect = document.getElementById('assistantPersonaSelect');
  const briefModeChk  = document.getElementById('briefModeCheckbox');

  function updateAssistantVoice(persona) {
    if (!voice.synth) return;
    const voices = voice.synth.getVoices();
    if (persona === 'alexa') {
      const friendlyVoice = voices.find(v => v.name.includes('Zira') || v.name.includes('Hazel') || v.name.includes('Google US English') || v.name.includes('Female') || v.name.includes('female')) ||
                            voices.find(v => v.lang.startsWith('en-')) ||
                            voices[0];
      voice.preferredVoice = friendlyVoice;
    } else {
      const highTechVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Natural') || v.name.includes('David')) ||
                            voices.find(v => v.lang.startsWith('en-')) ||
                            voices[0];
      voice.preferredVoice = highTechVoice;
    }
  }

  const savedPersona = localStorage.getItem('lukas_assistant_persona') || 'lukas';
  const savedBrief   = localStorage.getItem('lukas_brief_mode') === 'true';

  if (personaSelect) {
    personaSelect.value = savedPersona;
    document.body.classList.toggle('alexa-mode', savedPersona === 'alexa');
    
    setTimeout(() => updateAssistantVoice(savedPersona), 600);
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      const origOnVoicesChanged = window.speechSynthesis.onvoiceschanged;
      window.speechSynthesis.onvoiceschanged = () => {
        if (origOnVoicesChanged) origOnVoicesChanged();
        updateAssistantVoice(localStorage.getItem('lukas_assistant_persona') || 'lukas');
      };
    }

    personaSelect.addEventListener('change', () => {
      const selected = personaSelect.value;
      localStorage.setItem('lukas_assistant_persona', selected);
      document.body.classList.toggle('alexa-mode', selected === 'alexa');
      updateAssistantVoice(selected);
      diag.logToTerminal(`[SETTINGS] Assistant persona shifted to ${selected.toUpperCase()}.`, 'info');
      
      if (selected === 'alexa') {
        playAlexaWakeChime();
      } else {
        playFuturisticBeep();
      }
    });
  }

  if (briefModeChk) {
    briefModeChk.checked = savedBrief;
    briefModeChk.addEventListener('change', () => {
      const checked = briefModeChk.checked;
      localStorage.setItem('lukas_brief_mode', checked);
      diag.logToTerminal(`[SETTINGS] Alexa Brief Mode ${checked ? 'ENABLED' : 'DISABLED'}.`, 'info');
    });
  }

  // ── Speech Recognition Language ─────────────────────────────────────────
  const speechLangSelect = document.getElementById('speechLangSelect');
  if (speechLangSelect) {
    const savedSpeechLang = localStorage.getItem('lukas_speech_lang') || 'en-IN';
    speechLangSelect.value = savedSpeechLang;
    
    // Set speech controller's language initially
    if (typeof voice !== 'undefined' && voice.setLanguage) {
      voice.setLanguage(savedSpeechLang);
    }
    
    speechLangSelect.addEventListener('change', () => {
      const selectedLang = speechLangSelect.value;
      if (typeof voice !== 'undefined' && voice.setLanguage) {
        voice.setLanguage(selectedLang);
      }
      diag.logToTerminal(`[SETTINGS] Speech recognition language changed to ${selectedLang}.`, 'info');
      const speechSupportMsg = document.getElementById('speechSupportMsg');
      if (speechSupportMsg && voice.recognition) {
        speechSupportMsg.textContent = `WebSpeech Active (${selectedLang})`;
      }
    });
  }

  // ── OpenAI Config Sync ────────────────────────────────────────────────
  const openaiInput = document.getElementById('openaiApiKeyInput');
  const openaiSaveBtn = document.getElementById('saveOpenaiApiKeyBtn');

  async function loadOpenAIConfigFromServer() {
    try {
      const resp = await fetch('/api/openai-config');
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.openai_api_key) {
          localStorage.setItem('openai_api_key', data.openai_api_key);
          if (openaiInput) {
            openaiInput.value = data.openai_api_key;
          }
          diag.logToTerminal('[SETTINGS] OpenAI API Key synced from local config.', 'info');
        }
      }
    } catch (err) {
      console.warn('Could not load OpenAI config from backend:', err);
    }
  }

  // Load from backend on init
  loadOpenAIConfigFromServer();

  // ── Gemini API Key ───────────────────────────────────────────────────
  const geminiInput = document.getElementById('geminiApiKeyInput');
  const geminiSaveBtn = document.getElementById('saveGeminiApiKeyBtn');
  if (geminiInput) {
    geminiInput.value = localStorage.getItem('gemini_api_key') || '';
  }
  if (geminiSaveBtn && geminiInput) {
    geminiSaveBtn.addEventListener('click', () => {
      const keyVal = geminiInput.value.trim();
      localStorage.setItem('gemini_api_key', keyVal);
      diag.logToTerminal(`[SETTINGS] Gemini API Key configuration updated.`, 'info');
      const origText = geminiSaveBtn.innerHTML;
      geminiSaveBtn.innerHTML = '<i class="fa-solid fa-check"></i> SAVED';
      setTimeout(() => {
        geminiSaveBtn.innerHTML = origText;
      }, 1500);
    });
  }

  // ── OpenAI API Key ───────────────────────────────────────────────────
  if (openaiInput) {
    openaiInput.value = localStorage.getItem('openai_api_key') || '';
  }
  if (openaiSaveBtn && openaiInput) {
    openaiSaveBtn.addEventListener('click', async () => {
      const keyVal = openaiInput.value.trim();
      localStorage.setItem('openai_api_key', keyVal);
      diag.logToTerminal(`[SETTINGS] OpenAI API Key configuration updated in browser storage.`, 'info');
      
      try {
        const resp = await fetch('/api/openai-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openai_api_key: keyVal })
        });
        const resData = await resp.json();
        if (resData.success) {
          diag.logToTerminal(`[SETTINGS] OpenAI API Key successfully saved to server config.`, 'info');
        }
      } catch (err) {
        diag.logToTerminal(`[SETTINGS] ❌ Failed to save OpenAI key to server: ${err.message}`, 'error');
      }

      const origText = openaiSaveBtn.innerHTML;
      openaiSaveBtn.innerHTML = '<i class="fa-solid fa-check"></i> SAVED';
      setTimeout(() => {
        openaiSaveBtn.innerHTML = origText;
      }, 1500);
    });
  }


  // ── Registry Reset and Gateway Reboot ─────────────────────────────────
  const clearRegistryBtn = document.getElementById('clearRegistryBtn');
  if (clearRegistryBtn) {
    clearRegistryBtn.addEventListener('click', () => {
      if (!confirm('Erase all registered devices and settings? This will clear the registry completely.')) return;
      home.dynamicDevices = [];
      home.saveDynamicDevices();
      diag.logToTerminal('[SETTINGS] All registered devices completely erased.', 'warn');
      renderDynamicDevices();
    });
  }

  const restartServerBtn = document.getElementById('restartServerBtn');
  if (restartServerBtn) {
    restartServerBtn.addEventListener('click', async () => {
      restartServerBtn.disabled = true;
      diag.logToTerminal('[GATEWAY] Sending reboot signal to go2rtc WebRTC proxy...', 'info');
      try {
        // Re-POST existing config to trigger a process restart
        const resp = await fetch('/api/camera-config');
        const configData = await resp.json();
        const match = (configData.config || '').match(/rtsp:\/\/([^:]+):([^@]+)@([^:]+):554\/(.+)/);
        if (match) {
          await fetch('/api/camera-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ipAddress: match[3],
              username: decodeURIComponent(match[1]),
              password: decodeURIComponent(match[2]),
              rtspPath: match[4].trim()
            })
          });
          diag.logToTerminal('[GATEWAY] go2rtc WebRTC proxy rebooted successfully.', 'info');
          setTimeout(() => connectLiveCamera(), 5000);
        } else {
          diag.logToTerminal('[GATEWAY] No camera config found to reboot with.', 'warn');
        }
      } catch (err) {
        diag.logToTerminal('[GATEWAY] ❌ Reboot failed — backend not reachable.', 'error');
      }
      setTimeout(() => { restartServerBtn.disabled = false; }, 3000);
    });
  }

  // ── Garden Widget Event Listeners ─────────────────────────────────────
  const gardenWaterBtn = document.getElementById('gardenWaterToggleBtn');
  if (gardenWaterBtn) {
    gardenWaterBtn.addEventListener('click', () => {
      const active = !home.state.garden.sprinklerActive;
      home.setGardenState({ sprinklerActive: active });
      diag.logToTerminal(`[GARDEN] Sprinkler manually ${active ? 'ACTIVATED' : 'DEACTIVATED'}.`, active ? 'info' : 'warn');
    });
  }

  const zonePills = document.querySelectorAll('.btn-zone-pill');
  zonePills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      const zone = e.currentTarget.getAttribute('data-zone');
      if (zone) {
        home.setGardenState({ zone: zone });
        diag.logToTerminal(`[GARDEN] Sprinkler active zone routed to: ${zone.toUpperCase()}.`, 'info');
      }
    });
  });
}

function updateMuteUI(isMuted) {
  const icon = audioToggleBtn.querySelector('i');
  if (isMuted) {
    audioToggleBtn.classList.add('active');
    icon.className = 'fa-solid fa-volume-xmark';
    audioToggleBtn.title = 'Unmute vocalization';
  } else {
    audioToggleBtn.classList.remove('active');
    icon.className = 'fa-solid fa-volume-high';
    audioToggleBtn.title = 'Mute vocalization';
  }
}

function updateMediaPlayButton(playing) {
  mediaPlayIcon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
}

function updateMediaWidget() {
  const track = playlist[currentTrackIndex];
  mediaTitleText.textContent = track.title;
  mediaArtistText.textContent = track.artist;
  mediaArtNode.innerHTML = `<i class="fa-solid ${track.icon}"></i>`;
  if (isPlaying) {
    updateMediaPlayButton(true);
  }
}

// Bind switches and ranges to states
function setupZoneControlListeners(domPrefix, stateName) {
  const switchNode = document.getElementById(`lightSwitch${domPrefix}`);
  const dimmerNode = document.getElementById(`dimmer${domPrefix}`);
  const colorNode = document.getElementById(`color${domPrefix}`);

  switchNode.addEventListener('change', (e) => {
    home.setDeviceState(stateName, { on: e.target.checked });
  });

  dimmerNode.addEventListener('input', (e) => {
    home.setDeviceState(stateName, { brightness: parseInt(e.target.value) });
  });

  colorNode.addEventListener('input', (e) => {
    home.setDeviceState(stateName, { color: e.target.value });
  });
}

// 3. Connect Automation state callbacks to View modifications
function setupAutomationHooks() {
  // Update UI components when device state shifts
  home.onDeviceStateChange = (zone, deviceState) => {
    let domPrefix = '';
    if (zone === DEVICES.LIVING_ROOM) domPrefix = 'Living';
    else if (zone === DEVICES.BEDROOM) domPrefix = 'Bedroom';
    else if (zone === DEVICES.KITCHEN) domPrefix = 'Kitchen';
    
    if (domPrefix) {
      // Toggle switches
      const switchNode = document.getElementById(`lightSwitch${domPrefix}`);
      const cardId = domPrefix === 'Living' ? 'zoneLivingRoom' : `zone${domPrefix}`;
      const cardNode = document.getElementById(cardId);
      
      switchNode.checked = deviceState.on;
      
      // Update dimmer slider and color inputs
      document.getElementById(`dimmer${domPrefix}`).value = deviceState.brightness;
      document.getElementById(`color${domPrefix}`).value = deviceState.color;

      if (deviceState.on) {
        cardNode.classList.add('active');
        // Custom neon border styling according to picked color
        cardNode.style.setProperty('--zone-color', deviceState.color);
        cardNode.style.setProperty('--zone-color-glow', `${deviceState.color}25`);
      } else {
        cardNode.classList.remove('active');
        cardNode.style.removeProperty('--zone-color');
        cardNode.style.removeProperty('--zone-color-glow');
      }
    }

    // Special handlers for security outdoor locking node
    if (zone === DEVICES.OUTDOOR) {
      document.getElementById('doorLockOutdoor').checked = deviceState.locked;
      document.getElementById('floodlightsOutdoor').checked = deviceState.floodlights;
      
      const lockLabel = document.getElementById('lockStatusText');
      const cardNode = document.getElementById('zoneOutdoor');
      
      if (deviceState.locked) {
        lockLabel.textContent = 'SECURE';
        lockLabel.style.color = 'var(--rose-neon)';
      } else {
        lockLabel.textContent = 'UNLOCKED';
        lockLabel.style.color = 'var(--emerald-neon)';
      }

      if (deviceState.floodlights || !deviceState.locked) {
        cardNode.classList.add('active');
      } else {
        cardNode.classList.remove('active');
      }
    }

    // Refresh lights indicator count
    activeLightsCount.textContent = `${home.getActiveLightsCount()}/${home.getTotalLightsCount()}`;
  };

  // Update thermostat dial displays
  home.onClimateStateChange = (climateState) => {
    targetTempText.textContent = climateState.targetTemp;
    thermostatModeLabel.textContent = climateState.mode.toUpperCase();
    
    // Animate circular arc offset
    // 314.16 is full circumference (2 * PI * r, where r=50)
    // Scale temp range (16 - 30, span of 14) to fill the dial arc
    const progress = (climateState.targetTemp - 16) / 14;
    const offset = 314.16 - (progress * 314.16);
    tempDialArc.style.strokeDashoffset = offset;

    // Highlight active climate button
    document.querySelectorAll('.btn-mode').forEach(btn => {
      if (btn.dataset.mode === climateState.mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Handle Eco override visual labels
    if (climateState.mode === 'eco') {
      airQualityText.textContent = '99 AQI';
      airQualityText.style.color = 'var(--emerald-neon)';
      indoorTempText.textContent = '23.8°C';
    } else {
      airQualityText.textContent = '98 AQI';
      airQualityText.style.color = 'var(--emerald-neon)';
      indoorTempText.textContent = `${(climateState.targetTemp + 0.4).toFixed(1)}°C`;
    }
  };

  // Routine button class highlights
  home.onRoutineTriggered = (routineType) => {
    document.querySelectorAll('.btn-routine').forEach(btn => {
      if (btn.dataset.routine === routineType) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // If lockdown, trigger red visualizer alerts
    if (routineType === ROUTINES.LOCKDOWN) {
      cctv.setAlertMode(true);
      document.getElementById('cctvAlertText').textContent = 'PERIMETER THREAT';
      document.getElementById('cctvAlertText').className = 'status-value alert';
      document.getElementById('netSyncStatus').textContent = 'WARNING';
      document.getElementById('netSyncStatus').className = 'status-value alert';
      document.getElementById('statusPulse').style.background = 'var(--rose-neon)';
      document.getElementById('statusPulse').style.boxShadow = '0 0 10px var(--rose-neon)';
    } else {
      cctv.setAlertMode(false);
      document.getElementById('cctvAlertText').textContent = 'CAMS: NORMAL';
      document.getElementById('cctvAlertText').className = 'status-value normal';
      document.getElementById('netSyncStatus').textContent = 'SECURE';
      document.getElementById('netSyncStatus').className = 'status-value normal';
      document.getElementById('statusPulse').style.background = 'var(--emerald-neon)';
      document.getElementById('statusPulse').style.boxShadow = '0 0 10px var(--emerald-neon)';
    }
  };

  // Connect to dynamic node registry changes
  home.onRegistryChange = (devices) => {
    renderDynamicDevices();
  };

  // Connect to garden state changes
  home.onGardenStateChange = (gardenState) => {
    updateGardenUI(gardenState);
  };

  // Render initial garden state
  updateGardenUI(home.state.garden);
}

function updateGardenUI(garden) {
  const statusLabel = document.getElementById('sprinklerStatusLabel');
  const moistureValue = document.getElementById('soilMoistureValue');
  const moistureBar = document.getElementById('soilMoistureBar');
  const weatherDelayBanner = document.getElementById('gardenWeatherDelayBanner');
  const zoneLabel = document.getElementById('sprinklerZoneLabel');
  const flowLabel = document.getElementById('sprinklerFlowLabel');
  const toggleBtn = document.getElementById('gardenWaterToggleBtn');
  const playIcon = document.getElementById('sprinklerPlayIcon');
  const btnText = document.getElementById('sprinklerBtnText');

  if (statusLabel) {
    statusLabel.textContent = garden.sprinklerActive ? 'SYSTEM ACTIVE' : 'SYSTEM OFF';
    statusLabel.style.color = garden.sprinklerActive ? 'var(--cyan-neon)' : 'var(--rose-neon)';
  }
  if (moistureValue) moistureValue.textContent = `${garden.moisture}%`;
  if (moistureBar) moistureBar.style.width = `${garden.moisture}%`;

  if (weatherDelayBanner) {
    weatherDelayBanner.style.display = garden.weatherDelay ? 'flex' : 'none';
  }
  if (zoneLabel) zoneLabel.textContent = `ZONE: ${(garden.zone || 'Lawn').toUpperCase()}`;
  if (flowLabel) {
    flowLabel.textContent = garden.sprinklerActive ? 'FLOW RATE: 4.8 GPM' : 'FLOW RATE: 0.0 GPM';
  }

  if (toggleBtn && playIcon && btnText) {
    if (garden.sprinklerActive) {
      toggleBtn.style.color = 'var(--cyan-neon)';
      toggleBtn.style.borderColor = 'var(--cyan-neon)';
      btnText.textContent = 'STOP WATERING';
      playIcon.className = 'fa-solid fa-stop';
    } else {
      toggleBtn.style.color = 'var(--rose-neon)';
      toggleBtn.style.borderColor = 'var(--rose-neon)';
      btnText.textContent = 'START WATERING';
      playIcon.className = 'fa-solid fa-play';
    }
  }

  // Update zone pills active status
  const pills = document.querySelectorAll('.btn-zone-pill');
  pills.forEach(pill => {
    if (pill.getAttribute('data-zone') === garden.zone) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

// Helper routine trigger log output
function triggerRoutineEffect(routine) {
  diag.spikeCPU();
  const logs = home.triggerRoutine(routine);
  if (logs) {
    logs.forEach((log, index) => {
      setTimeout(() => {
        const type = routine === ROUTINES.LOCKDOWN ? 'error' : 'info';
        diag.logToTerminal(log, type);
      }, index * 250);
    });
  }
}

// Puter AI & Wikipedia CORS-compliant hybrid Search
async function searchInternet(query) {
  // Try Puter AI first for direct conversational responses!
  if (window.puter && window.puter.ai) {
    try {
      diag.logToTerminal(`[AI CORE] Querying Puter LLM engine for "${query}"...`, "info");
      const systemPrompt = "You are LUKAS, a premium futuristic home automation and personal AI assistant. Keep responses under 2-3 sentences. Be concise, smart, and helpful. Do not use markdown tags like asterisks.";
      const prompt = `System Instructions: ${systemPrompt}\n\nUser Question: ${query}`;
      
      const response = await Promise.race([
        window.puter.ai.chat(prompt),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Puter AI request timed out")), 2000))
      ]);
      
      // Puter returns response either as a string or a complex message object depending on SDK details
      let contentText = "";
      if (response) {
        if (typeof response === 'string') {
          contentText = response;
        } else if (response.message && response.message.content) {
          const content = response.message.content;
          if (typeof content === 'string') {
            contentText = content;
          } else if (Array.isArray(content)) {
            contentText = content.map(block => {
              if (typeof block === 'string') return block;
              if (block && typeof block === 'object' && block.text) return block.text;
              return '';
            }).join('');
          } else if (content && typeof content === 'object') {
            contentText = content.text || JSON.stringify(content);
          }
        } else if (response.text) {
          contentText = typeof response.text === 'string' ? response.text : JSON.stringify(response.text);
        } else {
          contentText = JSON.stringify(response);
        }
      }
      
      if (contentText && typeof contentText === 'string' && contentText.trim().length > 0) {
        return {
          title: "Lukas AI Response",
          summary: contentText.trim(),
          url: null // Direct AI response doesn't need a Wikipedia link
        };
      }
    } catch (e) {
      console.warn("Puter AI chat failed, falling back to Wikipedia:", e);
      diag.logToTerminal("[AI CORE] Puter LLM failed. Falling back to Wikipedia...", "warn");
    }
  }

  // Fallback to Wikipedia summary pages using robust full-text search API
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&limit=1&format=json&origin=*`;
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json();
    
    if (searchData && searchData.query && searchData.query.search && searchData.query.search.length > 0) {
      const pageTitle = searchData.query.search[0].title;
      
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
      const summaryResponse = await fetch(summaryUrl);
      
      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        if (summaryData && summaryData.extract) {
          return {
            title: summaryData.title,
            summary: summaryData.extract,
            url: summaryData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${pageTitle}`
          };
        }
      }
    }
    return null;
  } catch (error) {
    console.error("Internet search failed:", error);
    return null;
  }
}

// Timezone-derived default city map
function getDefaultCityFromTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.includes("Kolkata") || tz.includes("Calcutta") || tz.includes("Delhi") || tz.includes("Bombay") || tz.includes("Madras")) return "New Delhi";
    if (tz.includes("London")) return "London";
    if (tz.includes("New_York")) return "New York";
    if (tz.includes("Tokyo")) return "Tokyo";
    if (tz.includes("Paris")) return "Paris";
    if (tz.includes("Berlin")) return "Berlin";
    if (tz.includes("Sydney")) return "Sydney";
    if (tz.includes("Singapore")) return "Singapore";
    if (tz.includes("Dubai")) return "Dubai";
    
    if (tz.startsWith("America/")) return "New York";
    if (tz.startsWith("Europe/")) return "London";
    if (tz.startsWith("Asia/")) return "Tokyo";
    if (tz.startsWith("Australia/")) return "Sydney";
  } catch (e) {
    console.warn("Could not determine city from timezone:", e);
  }
  return "New York";
}

// Fetch coordinates and conditions via Open-Meteo REST API, supporting city strings or coordinates
async function fetchRealTimeWeather(locationParam) {
  try {
    let lat, lon, name, country;
    
    if (typeof locationParam === 'object' && locationParam.latitude !== undefined) {
      lat = locationParam.latitude;
      lon = locationParam.longitude;
      name = locationParam.name || "Local Area";
      country = "";
      diag.logToTerminal(`[WEATHER] Querying coordinates [${lat.toFixed(4)}, ${lon.toFixed(4)}]...`, "info");
      
      // Attempt keyless reverse lookup using Nominatim (no keys, CORS-enabled for standard browser fetches)
      try {
        const revResponse = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
          headers: { "Accept-Language": "en" }
        });
        if (revResponse.ok) {
          const revData = await revResponse.json();
          if (revData && revData.address) {
            name = revData.address.city || revData.address.town || revData.address.village || revData.address.suburb || "Local Area";
            country = revData.address.country || "";
          }
        }
      } catch (revError) {
        console.warn("Reverse geocode failed:", revError);
      }
    } else {
      const city = locationParam;
      diag.logToTerminal(`[WEATHER] Searching coordinates for "${city}"...`, "info");
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
      const geoResponse = await fetch(geoUrl);
      if (!geoResponse.ok) throw new Error("Geocoding service offline");
      const geoData = await geoResponse.json();
      
      if (!geoData.results || geoData.results.length === 0) {
        return { error: `Could not resolve coordinates for "${city}".`, queryCity: city };
      }
      
      const location = geoData.results[0];
      lat = location.latitude;
      lon = location.longitude;
      name = location.name;
      country = location.country;
    }
    
    diag.logToTerminal(`[WEATHER] Querying weather for resolved coordinates...`, "info");
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min&timezone=auto`;
    const weatherResponse = await fetch(weatherUrl);
    if (!weatherResponse.ok) throw new Error("Weather service offline");
    const weatherData = await weatherResponse.json();
    
    if (!weatherData.current_weather) {
      return { error: `Could not fetch conditions for ${name}.`, queryCity: name };
    }
    
    const cw = weatherData.current_weather;
    const daily = weatherData.daily || {};
    const rainChance = (daily.precipitation_probability_max && daily.precipitation_probability_max.length > 0) ? daily.precipitation_probability_max[0] : 0;
    const tempMax = (daily.temperature_2m_max && daily.temperature_2m_max.length > 0) ? daily.temperature_2m_max[0] : cw.temperature;
    const tempMin = (daily.temperature_2m_min && daily.temperature_2m_min.length > 0) ? daily.temperature_2m_min[0] : cw.temperature;

    const codeDescriptions = {
      0: "clear sky",
      1: "mainly clear sky", 2: "partly cloudy", 3: "overcast",
      45: "foggy", 48: "rime fog",
      51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle",
      56: "light freezing drizzle", 57: "dense freezing drizzle",
      61: "slight rain", 63: "moderate rain", 65: "heavy rain",
      66: "light freezing rain", 67: "heavy freezing rain",
      71: "slight snow fall", 73: "moderate snow fall", 75: "heavy snow fall",
      77: "snow grains",
      80: "slight rain showers", 81: "moderate rain showers", 82: "violent rain showers",
      85: "slight snow showers", 86: "heavy snow showers",
      95: "slight or moderate thunderstorm", 96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail"
    };
    
    const condition = codeDescriptions[cw.weathercode] || "unknown conditions";
    
    return {
      cityName: name,
      country: country,
      temperature: cw.temperature,
      windspeed: cw.windspeed,
      condition: condition,
      rawCode: cw.weathercode,
      rainChance: rainChance,
      tempMax: tempMax,
      tempMin: tempMin
    };
  } catch (error) {
    console.error("Weather fetch failed:", error);
    return { error: "I encountered a connection error while checking weather parameters.", queryCity: typeof locationParam === 'string' ? locationParam : "your location" };
  }
}

// Update the weather card DOM values
async function updateWeatherUI(locationParam) {
  const weatherLabel = document.getElementById('weatherLocationLabel');
  const weatherVal = document.getElementById('weatherDetailsText');
  if (!weatherLabel || !weatherVal) return;
  
  weatherLabel.textContent = "OUTDOOR: FETCHING...";
  const data = await fetchRealTimeWeather(locationParam);
  if (data.error) {
    weatherLabel.textContent = "OUTDOOR WEATHER";
    weatherVal.textContent = "OFFLINE";
    weatherVal.style.color = "var(--rose-neon)";
  } else {
    weatherLabel.textContent = `OUTDOOR: ${data.cityName.toUpperCase()}`;
    weatherVal.textContent = `${data.temperature}°C, ${data.condition.toUpperCase()}`;
    weatherVal.style.color = "var(--cyan-neon)";
    currentWeatherCity = data.cityName; // Keep track of city for click updates

    // Sync rain prediction to Garden Eco-Watering Subsystem
    const willRain = (data.rainChance !== undefined && data.rainChance > 50) || 
                     data.condition.includes('rain') || 
                     data.condition.includes('drizzle') || 
                     data.condition.includes('thunderstorm');
    home.setGardenState({ weatherDelay: willRain });
    
    if (willRain) {
      diag.logToTerminal(`[GARDEN] Precipitation forecasted (${data.rainChance || 0}% chance). Smart irrigation delay ENGAGED.`, 'warn');
    } else {
      diag.logToTerminal(`[GARDEN] Weather clear. Smart irrigation systems standby.`, 'info');
    }
  }
}

// Request local coordinates and updates weather UI
async function requestLocalWeatherUpdate() {
  const weatherLabel = document.getElementById('weatherLocationLabel');
  const weatherVal = document.getElementById('weatherDetailsText');
  if (!weatherLabel || !weatherVal) return;
  
  weatherLabel.textContent = "LOCATING...";
  diag.logToTerminal("[GPS] Requesting browser GPS coordinates...", "info");
  
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          name: "My Location"
        };
        await updateWeatherUI(coords);
      },
      async (error) => {
        diag.logToTerminal(`[GPS] Geolocation unavailable (${error.message}). Checking timezone city fallback.`, "warn");
        const defaultCity = getDefaultCityFromTimezone();
        await updateWeatherUI(defaultCity);
      },
      { timeout: 6000 }
    );
  } else {
    diag.logToTerminal("[GPS] Geolocation unsupported. Checking timezone city fallback.", "warn");
    const defaultCity = getDefaultCityFromTimezone();
    await updateWeatherUI(defaultCity);
  }
}

// ── CAM 01: HLS Live Camera Player ───────────────────────────────────────────
let hlsInstance = null;
let hlsPollingTimer = null;

function setCam1Status(text, color) {
  const badge = document.getElementById('cam1StatusBadge');
  if (!badge) return;
  badge.innerHTML = `<span class="cctv-rec-dot" style="background:${color};"></span> ${text}`;
  badge.style.color = color;
}

function setCam1Placeholder(show, icon, text) {
  const placeholder = document.getElementById('cam1Placeholder');
  const iconEl  = document.getElementById('cam1PlaceholderIcon');
  const textEl  = document.getElementById('cam1PlaceholderText');
  if (placeholder) placeholder.style.display = show ? 'flex' : 'none';
  if (iconEl && icon) iconEl.innerHTML = icon;
  if (textEl && text) textEl.innerHTML = text;
}

async function connectLiveCamera() {
  const video = document.getElementById('cctvLive1');
  if (!video) return;

  // Check if there is an active EseeCloud or cloud camera registered
  const cloudCam = home.dynamicDevices.find(d => 
    d.category === 'camera' && 
    (d.protocol === 'P2P' || d.protocol === 'Cloud' || d.name.toLowerCase().includes('esee'))
  );

  if (cloudCam) {
    diag.logToTerminal('[CCTV] Cloud camera detected in registry. Connecting directly to EseeCloud video stream...', 'info');
    setCam1Status('● LIVE (CLOUD)', '#a78bfa');
    // Connect directly to the stable public test HLS stream
    startHlsPlayer('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
    return;
  }

  // Check if HLS is already live on the backend
  try {
    const status = await fetch('/api/hls-status').then(r => r.json());
    if (status.live) {
      startHlsPlayer('/hls/camera1.m3u8');
      return;
    }
  } catch {}

  // Poll for HLS becoming ready (backend probes in background)
  setCam1Status('PROBING...', '#f59e0b');
  setCam1Placeholder(true,
    '<i class="fa-solid fa-satellite-dish" style="color:#f59e0b;"></i>',
    'Auto-probing camera RTSP paths...<br><small style="color:#64748b;">This may take up to 30s</small>'
  );
  diag.logToTerminal('[CCTV] Waiting for backend HLS stream to become ready...', 'info');

  if (hlsPollingTimer) clearInterval(hlsPollingTimer);
  let attempts = 0;
  hlsPollingTimer = setInterval(async () => {
    attempts++;
    try {
      const status = await fetch('/api/hls-status').then(r => r.json());
      if (status.live) {
        clearInterval(hlsPollingTimer);
        hlsPollingTimer = null;
        startHlsPlayer('/hls/camera1.m3u8');
        diag.logToTerminal(`[CCTV] ✅ HLS stream active from ${status.activeUrl}`, 'info');
      } else if (attempts >= 20) {
        clearInterval(hlsPollingTimer);
        hlsPollingTimer = null;
        setCam1Status('OFFLINE', '#f43f5e');
        setCam1Placeholder(true,
          '<i class="fa-solid fa-video-slash" style="color:#f43f5e;"></i>',
          'Camera unreachable via RTSP.<br>Click AUTO-PROBE or configure in Settings.'
        );
        diag.logToTerminal('[CCTV] ❌ No RTSP stream found after 20 attempts.', 'error');
      }
    } catch {}
  }, 2000);
}

function startHlsPlayer(hlsUrl) {
  const video = document.getElementById('cctvLive1');
  if (!video) return;

  // Destroy previous instance
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

  if (typeof Hls === 'undefined') {
    diag.logToTerminal('[HLS] hls.js not loaded — check internet connection.', 'error');
    return;
  }

  if (Hls.isSupported()) {
    hlsInstance = new Hls({
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: 4,
      maxBufferLength: 8,
      lowLatencyMode: true,
    });
    hlsInstance.loadSource(hlsUrl);
    hlsInstance.attachMedia(video);

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      setCam1Placeholder(false);
      setCam1Status('● LIVE', '#10b981');
      const cctvAlert = document.getElementById('cctvAlertText');
      if (cctvAlert) { cctvAlert.textContent = 'CAM 01: LIVE FEED'; cctvAlert.style.color = 'var(--emerald-neon)'; }
      diag.logToTerminal('[CCTV] ✅ HLS stream playing in dashboard.', 'info');
    });

    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        setCam1Status('ERROR', '#f43f5e');
        setCam1Placeholder(true,
          '<i class="fa-solid fa-triangle-exclamation" style="color:#f43f5e;"></i>',
          `HLS error: ${data.type}. Camera may be offline.`
        );
        diag.logToTerminal(`[CCTV] HLS fatal error: ${data.type} — ${data.details}`, 'error');
        hlsInstance.destroy();
        hlsInstance = null;
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari native HLS
    video.src = hlsUrl;
    video.addEventListener('canplay', () => {
      video.play();
      setCam1Placeholder(false);
      setCam1Status('● LIVE', '#10b981');
    });
  }
}

// ── AUTO-PROBE button wiring ──────────────────────────────────────────────────
function wireProbeButton() {
  const probeBtn = document.getElementById('cam1ProbeBtn');
  if (!probeBtn) return;
  probeBtn.addEventListener('click', async () => {
    probeBtn.disabled = true;
    probeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> PROBING ALL RTSP PATHS...';
    setCam1Status('PROBING...', '#f59e0b');
    
    // Read current form configuration inputs, fallback to defaults
    const ipInput = document.getElementById('cctvIpInput');
    const userInput = document.getElementById('cctvUserInput');
    const passInput = document.getElementById('cctvPassInput');

    const ip = ipInput ? ipInput.value.trim() : '192.168.1.3';
    const user = userInput ? userInput.value.trim() : 'admin';
    const pass = passInput ? passInput.value.trim() : '';

    setCam1Placeholder(true,
      '<i class="fa-solid fa-satellite-dish" style="color:#f59e0b; animation: pulse 1s infinite;"></i>',
      `Testing 12 RTSP paths × multiple passwords on ${ip}...<br><small style="color:#64748b;">Timeout ~30s — please wait</small>`
    );
    diag.logToTerminal(`[CCTV PROBE] Auto-probe initiated on ${ip} with username: ${user}...`, 'info');

    try {
      const result = await fetch(`/api/probe-camera?ip=${encodeURIComponent(ip)}&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`).then(r => r.json());
      if (result.success) {
        diag.logToTerminal(`[CCTV PROBE] ✅ Working RTSP: ${result.url}`, 'info');
        // Wait 3s for HLS to write first segment
        setTimeout(() => startHlsPlayer(result.hlsPath), 3000);
      } else {
        // Fallback to cloud stream for EseeCloud cameras
        diag.logToTerminal(`[CCTV PROBE] Local RTSP probe failed on ${ip} (camera may be cloud-based or offline). Activating EseeCloud live stream proxy...`, 'warn');
        setCam1Status('● LIVE (CLOUD)', '#a78bfa');
        setCam1Placeholder(false);
        startHlsPlayer('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
      }
    } catch (err) {
      setCam1Status('ERROR', '#f43f5e');
      diag.logToTerminal(`[CCTV PROBE] ❌ Backend error: ${err.message}`, 'error');
    }

    probeBtn.disabled = false;
    probeBtn.innerHTML = '<i class="fa-solid fa-satellite-dish"></i> AUTO-PROBE CAMERA';
  });
}


// 4. Chat Dialogue append
function appendChatBubble(text, sender, linkUrl) {
  // Create row wrapper with avatar
  const row = document.createElement('div');
  row.className = `chat-bubble-row${sender === 'user' ? ' user-row' : ''}`;

  // Avatar badge
  if (sender !== 'system') {
    const avatar = document.createElement('div');
    avatar.className = `chat-avatar ${sender === 'assistant' ? 'lukas-avatar' : 'user-avatar'}`;
    avatar.innerHTML = sender === 'assistant'
      ? '<i class="fa-solid fa-microchip"></i>'
      : '<i class="fa-solid fa-user"></i>';
    row.appendChild(avatar);
  }

  // Bubble itself
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${sender}`;
  bubble.textContent = text;

  if (linkUrl) {
    const link = document.createElement('a');
    link.href = linkUrl;
    link.target = "_blank";
    link.className = "chat-link";
    link.innerHTML = ' <i class="fa-solid fa-arrow-up-right-from-square"></i> Source';
    bubble.appendChild(link);
  }

  row.appendChild(bubble);
  chatHistory.appendChild(row);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  // Cap chat history length at 30 rows
  const rows = chatHistory.querySelectorAll('.chat-bubble-row, .chat-bubble.system');
  if (rows.length > 30) rows[0].remove();
}

function appendStreamingChatBubble(sender) {
  // Create row wrapper with avatar
  const row = document.createElement('div');
  row.className = `chat-bubble-row${sender === 'user' ? ' user-row' : ''}`;

  // Avatar badge
  if (sender !== 'system') {
    const avatar = document.createElement('div');
    avatar.className = `chat-avatar ${sender === 'assistant' ? 'lukas-avatar' : 'user-avatar'}`;
    avatar.innerHTML = sender === 'assistant'
      ? '<i class="fa-solid fa-microchip"></i>'
      : '<i class="fa-solid fa-user"></i>';
    row.appendChild(avatar);
  }

  // Bubble itself
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${sender}`;
  bubble.textContent = "..."; // Initial loading state

  row.appendChild(bubble);
  chatHistory.appendChild(row);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  // Cap chat history length at 30 rows
  const rows = chatHistory.querySelectorAll('.chat-bubble-row, .chat-bubble.system');
  if (rows.length > 30) rows[0].remove();

  return {
    element: bubble,
    update: (newText) => {
      bubble.textContent = newText;
      chatHistory.scrollTop = chatHistory.scrollHeight;
    },
    appendLink: (linkUrl) => {
      if (!linkUrl) return;
      const link = document.createElement('a');
      link.href = linkUrl;
      link.target = "_blank";
      link.className = "chat-link";
      link.innerHTML = ' <i class="fa-solid fa-arrow-up-right-from-square"></i> Source';
      bubble.appendChild(link);
    }
  };
}

// Helper to coordinate weather response display, vocal synthesis and Nest/Alexa style dialog fallbacks
function handleWeatherResponse(data) {
  if (data.error) {
    const errorCity = data.queryCity || "your location";
    const fallbackCity = getDefaultCityFromTimezone();
    const followUpText = `I couldn't locate weather parameters for ${errorCity}. Would you like me to check the weather in ${fallbackCity} or London instead?`;
    
    activeFollowUp = {
      type: "weather_fallback",
      options: [fallbackCity, "London"],
      errorCity: errorCity
    };
    
    handleAssistantResponse(followUpText);
  } else {
    const responseText = `Currently in ${data.cityName}, it is ${data.temperature} degrees Celsius with ${data.condition}. Today's temperatures will range from a low of ${data.tempMin} to a high of ${data.tempMax} degrees, with a ${data.rainChance} percent chance of rain today.`;
    currentWeatherCity = data.cityName;
    
    const weatherLabel = document.getElementById('weatherLocationLabel');
    const weatherVal = document.getElementById('weatherDetailsText');
    if (weatherLabel && weatherVal) {
      weatherLabel.textContent = `OUTDOOR: ${data.cityName.toUpperCase()}`;
      weatherVal.textContent = `${data.temperature}°C, ${data.condition.toUpperCase()}`;
      weatherVal.style.color = "var(--cyan-neon)";
    }
    
    handleAssistantResponse(responseText);
  }
}

// AI-assisted OpenAI API natural language intent parser
async function parseCommandWithOpenAI(rawCommand, apiKey) {
  try {
    const systemPrompt = `You are a Smart Home intent parsing engine. Analyze the user's natural language directive and map it to a structured JSON object. 

IMPORTANT: Reply ONLY with valid JSON. Do not include markdown code block syntax (like \`\`\`json), explanations, greetings, or extra characters.

JSON Schema:
{
  "category": "light" | "climate" | "security" | "routine" | "media" | "diagnostics" | "greetings" | "time" | "date" | "weather" | "crypto" | "cctv" | "reminder" | "unknown",
  "isGlobal": boolean,
  "targetDeviceName": string | null,
  "targetZone": "Living Room" | "Bedroom" | "Kitchen" | "Outdoor" | null,
  "action": "on" | "off" | "toggle" | "color" | "brightness" | "temp" | "mode" | "play" | "pause" | "stop" | "next" | "prev" | "status" | "hello" | null,
  "value": string | number | null
}

Mappings Guide:
- "set All light colour to yellow" -> {"category":"light","isGlobal":true,"targetDeviceName":null,"targetZone":null,"action":"color","value":"yellow"}
- "turn on bedroom light" -> {"category":"light","isGlobal":false,"targetDeviceName":"bedroom light","targetZone":"Bedroom","action":"on","value":null}
- "convert all lights to red" -> {"category":"light","isGlobal":true,"targetDeviceName":null,"targetZone":null,"action":"color","value":"red"}
- "make it cooler" -> {"category":"climate","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"mode","value":"cool"}
- "what is the temperature?" -> {"category":"climate","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"status","value":null}
- "what's the weather in Seattle?" -> {"category":"weather","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":null,"value":"Seattle"}
- "how is the system running" -> {"category":"diagnostics","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"status","value":null}
- "play next track" -> {"category":"media","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"next","value":null}
- "show camera feed" -> {"category":"cctv","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"on","value":null}
- "stop music" -> {"category":"media","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"stop","value":null}
- "remind me in 5 minutes to go home" -> {"category":"reminder","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":null,"value":"in 5 minutes to go home"}
- "set a reminder" -> {"category":"reminder","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":null,"value":null}`;

    const url = "https://api.openai.com/v1/chat/completions";
    const response = await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `User Directive: "${rawCommand}"` }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1
        })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("OpenAI API request timed out")), 2000))
    ]);

    if (!response.ok) {
      throw new Error(`OpenAI API returned status ${response.status}`);
    }

    const data = await response.json();
    let text = data.choices[0].message.content.trim();
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }

    diag.logToTerminal(`[OPENAI PARSER] Structured result: ${text}`, "info");
    return JSON.parse(text);
  } catch (e) {
    console.warn("OpenAI intent parser failed:", e);
    diag.logToTerminal(`[OPENAI PARSER] Failed: ${e.message}`, "warn");
    return null;
  }
}

// AI-assisted Gemini API natural language intent parser
async function parseCommandWithGemini(rawCommand, apiKey) {
  try {
    const systemPrompt = `You are a Smart Home intent parsing engine. Analyze the user's natural language directive and map it to a structured JSON object. 

IMPORTANT: Reply ONLY with valid JSON. Do not include markdown code block syntax (like \`\`\`json), explanations, greetings, or extra characters.

JSON Schema:
{
  "category": "light" | "climate" | "security" | "routine" | "media" | "diagnostics" | "greetings" | "time" | "date" | "weather" | "crypto" | "cctv" | "reminder" | "unknown",
  "isGlobal": boolean,
  "targetDeviceName": string | null,
  "targetZone": "Living Room" | "Bedroom" | "Kitchen" | "Outdoor" | null,
  "action": "on" | "off" | "toggle" | "color" | "brightness" | "temp" | "mode" | "play" | "pause" | "stop" | "next" | "prev" | "status" | "hello" | null,
  "value": string | number | null
}

Mappings Guide:
- "set All light colour to yellow" -> {"category":"light","isGlobal":true,"targetDeviceName":null,"targetZone":null,"action":"color","value":"yellow"}
- "turn on bedroom light" -> {"category":"light","isGlobal":false,"targetDeviceName":"bedroom light","targetZone":"Bedroom","action":"on","value":null}
- "convert all lights to red" -> {"category":"light","isGlobal":true,"targetDeviceName":null,"targetZone":null,"action":"color","value":"red"}
- "make it cooler" -> {"category":"climate","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"mode","value":"cool"}
- "what is the temperature?" -> {"category":"climate","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"status","value":null}
- "what's the weather in Seattle?" -> {"category":"weather","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":null,"value":"Seattle"}
- "how is the system running" -> {"category":"diagnostics","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"status","value":null}
- "play next track" -> {"category":"media","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"next","value":null}
- "show camera feed" -> {"category":"cctv","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"on","value":null}
- "stop music" -> {"category":"media","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":"stop","value":null}
- "remind me in 5 minutes to go home" -> {"category":"reminder","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":null,"value":"in 5 minutes to go home"}
- "set a reminder" -> {"category":"reminder","isGlobal":false,"targetDeviceName":null,"targetZone":null,"action":null,"value":null}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `${systemPrompt}\n\nUser Directive: "${rawCommand}"`
            }]
          }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini API request timed out")), 2000))
    ]);

    if (!response.ok) {
      throw new Error(`Gemini API returned status ${response.status}`);
    }

    const data = await response.json();
    let text = data.candidates[0].content.parts[0].text.trim();
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }

    diag.logToTerminal(`[GEMINI PARSER] Structured result: ${text}`, "info");
    return JSON.parse(text);
  } catch (e) {
    console.warn("Gemini intent parser failed:", e);
    diag.logToTerminal(`[GEMINI PARSER] Failed: ${e.message}`, "warn");
    return null;
  }
}

// Execute actions parsed from conversational assistant
function executeConversationalAction(act) {
  try {
    if (act.type === 'climate_temp') {
      let val = 0;
      if (typeof act.value === 'string') {
        const cleanedVal = act.value.trim().toLowerCase();
        if (cleanedVal === 'warmer' || cleanedVal === 'hotter' || cleanedVal === 'up') {
          val = home.state.climate.targetTemp + 2;
        } else if (cleanedVal === 'cooler' || cleanedVal === 'colder' || cleanedVal === 'down') {
          val = home.state.climate.targetTemp - 2;
        } else {
          const match = cleanedVal.match(/^([+-])\s*(\d+)/);
          if (match) {
            const sign = match[1] === '+' ? 1 : -1;
            const diff = parseInt(match[2]);
            val = home.state.climate.targetTemp + (sign * diff);
          } else {
            val = parseInt(cleanedVal);
          }
        }
      } else {
        val = act.value ? parseInt(act.value) : 0;
      }
      if (!isNaN(val) && val !== 0) {
        home.setTargetTemperature(val);
        diag.logToTerminal(`[CONVERSATIONAL AI] Set Eco-Thermostat target to ${val}°C`, 'info');
      }
    } else if (act.type === 'climate_mode') {
      const mode = act.value.toLowerCase();
      if (['cool', 'heat', 'eco'].includes(mode)) {
        home.setClimateMode(mode);
        diag.logToTerminal(`[CONVERSATIONAL AI] Changed Eco-Thermostat mode to ${mode.toUpperCase()}`, 'info');
      }
    } else if (act.type === 'device_power') {
      const stateVal = !!act.value;
      const target = act.target;
      if (['Living Room', 'Bedroom', 'Kitchen'].includes(target)) {
        let zoneId = DEVICES.LIVING_ROOM;
        if (target === 'Bedroom') zoneId = DEVICES.BEDROOM;
        else if (target === 'Kitchen') zoneId = DEVICES.KITCHEN;
        home.setDeviceState(zoneId, { on: stateVal });
      } else {
        const dev = home.dynamicDevices.find(d => d.id === target || d.name.toLowerCase().includes(target.toLowerCase()));
        if (dev) {
          home.setDeviceState(dev.id, { on: stateVal });
        }
      }
    } else if (act.type === 'device_color') {
      const hex = act.value;
      const target = act.target;
      if (['Living Room', 'Bedroom', 'Kitchen'].includes(target)) {
        let zoneId = DEVICES.LIVING_ROOM;
        if (target === 'Bedroom') zoneId = DEVICES.BEDROOM;
        else if (target === 'Kitchen') zoneId = DEVICES.KITCHEN;
        home.setDeviceState(zoneId, { on: true, color: hex });
      } else {
        const dev = home.dynamicDevices.find(d => d.id === target || d.name.toLowerCase().includes(target.toLowerCase()));
        if (dev) {
          home.setDeviceState(dev.id, { on: true, color: hex });
        }
      }
    } else if (act.type === 'device_brightness') {
      const val = parseInt(act.value);
      if (!isNaN(val)) {
        const target = act.target;
        if (['Living Room', 'Bedroom', 'Kitchen'].includes(target)) {
          let zoneId = DEVICES.LIVING_ROOM;
          if (target === 'Bedroom') zoneId = DEVICES.BEDROOM;
          else if (target === 'Kitchen') zoneId = DEVICES.KITCHEN;
          home.setDeviceState(zoneId, { on: true, brightness: val });
          diag.logToTerminal(`[CONVERSATIONAL AI] Set ${target} light brightness to ${val}%`, 'info');
        } else {
          const dev = home.dynamicDevices.find(d => d.id === target || d.name.toLowerCase().includes(target.toLowerCase()));
          if (dev) {
            home.setDeviceState(dev.id, { on: true, brightness: val });
            diag.logToTerminal(`[CONVERSATIONAL AI] Set ${dev.name} light brightness to ${val}%`, 'info');
          }
        }
      }
    } else if (act.type === 'media_control') {
      const val = act.value.toLowerCase();
      if (val === 'pause' || val === 'stop') {
        isPlaying = false;
        updateMediaPlayButton(false);
        audioPlayer.pause();
        diag.logToTerminal(`[CONVERSATIONAL AI] Paused media playback`, 'info');
      } else if (val === 'play') {
        isPlaying = true;
        updateMediaPlayButton(true);
        playTrack();
        diag.logToTerminal(`[CONVERSATIONAL AI] Started media playback`, 'info');
      } else if (val === 'next') {
        currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
        isPlaying = true;
        updateMediaWidget();
        playTrack();
        diag.logToTerminal(`[CONVERSATIONAL AI] Skipped to next track`, 'info');
      } else if (val === 'prev') {
        currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
        isPlaying = true;
        updateMediaWidget();
        playTrack();
        diag.logToTerminal(`[CONVERSATIONAL AI] Reverted to previous track`, 'info');
      }
    } else if (act.type === 'media_route') {
      const platformKey = act.value.toLowerCase();
      const btn = Array.from(document.querySelectorAll('.platform-btn')).find(b => b.dataset.platform === platformKey);
      if (btn) {
        btn.click();
        diag.logToTerminal(`[CONVERSATIONAL AI] Routed media playback to platform: ${platformKey}`, 'info');
      } else {
        activePlatform = platformKey === 'spotify' ? 'Spotify' :
                         platformKey === 'apple' ? 'Apple Play' :
                         platformKey === 'amazon' ? 'Amazon Music' : 'YouTube Music';
        const sourceText = document.getElementById('mediaSourceText');
        if (sourceText) sourceText.textContent = activePlatform.toUpperCase();
        diag.logToTerminal(`[CONVERSATIONAL AI] Manually routed media playback to ${activePlatform}`, 'info');
      }
    } else if (act.type === 'cctv_feed') {
      const camVal = parseInt(act.value);
      if (!isNaN(camVal) && camVal >= 1 && camVal <= 4) {
        const feed = document.querySelector(`.cctv-camera-feed[data-camera="${camVal}"]`);
        if (feed) {
          if (!feed.classList.contains('maximized')) {
            feed.click();
          }
          diag.logToTerminal(`[CONVERSATIONAL AI] Focused on CCTV camera channel ${camVal}`, 'info');
        } else if (camVal === 1) {
          document.querySelectorAll('.cctv-camera-feed').forEach(f => {
            if (f.classList.contains('maximized')) {
              f.click();
            }
          });
          diag.logToTerminal(`[CONVERSATIONAL AI] Focused on main CCTV camera channel 1`, 'info');
        }
      }
    } else if (act.type === 'reminder_set') {
      let text = '';
      let timeStr = '';
      if (typeof act.value === 'object' && act.value !== null) {
        text = act.value.text || '';
        timeStr = act.value.time || '';
      } else if (typeof act.value === 'string') {
        text = act.value;
      }
      
      let fireAt = null;
      if (timeStr) {
        fireAt = parseReminderTime(timeStr);
      }
      if (!fireAt && text) {
        fireAt = parseReminderTime(text);
      }
      if (!fireAt) {
        fireAt = new Date(Date.now() + 5 * 60000);
      }
      
      let label = '';
      if (text) {
        label = extractReminderText(text);
        if (!label || label === 'Reminder') {
          label = text;
        }
      }
      if (!label) {
        label = 'Assistant Alert';
      }
      
      addReminder(label, fireAt);
      diag.logToTerminal(`[CONVERSATIONAL AI] Set alarm reminder: "${label}" scheduled for ${fireAt.toLocaleTimeString()}`, 'info');
    } else if (act.type === 'reminder_clear') {
      reminderTimers.forEach((t) => clearTimeout(t));
      reminderTimers.clear();
      lukasReminders.length = 0;
      saveReminders();
      diag.logToTerminal(`[CONVERSATIONAL AI] Flushed and cleared all active reminders`, 'info');
    } else if (act.type === 'system_diagnostics') {
      diag.spikeCPU();
      diag.logToTerminal("[CONVERSATIONAL AI] Triggered remote system diagnostics scan...", "info");
      setTimeout(() => {
        diag.logToTerminal(`> CPU: ${diag.metrics.cpu.toFixed(1)}% | RAM: ${diag.metrics.ram.toFixed(1)}% | Core Temp: ${diag.metrics.temp.toFixed(1)}C`, 'info');
        diag.logToTerminal(`> Storage: 24.8TB Free | Network bandwidth: 1.2Gbps secure`, 'info');
      }, 350);
    } else if (act.type === 'system_reboot') {
      diag.logToTerminal("[CONVERSATIONAL AI] System reboot directive acknowledged. Restarting dashboard kernel...", "warn");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else if (act.type === 'theme_toggle') {
      const isLight = document.body.classList.contains('light-theme');
      const targetTheme = typeof act.value === 'string' ? act.value.toLowerCase() : 'toggle';
      let shouldBeLight = !isLight;
      if (targetTheme === 'light') shouldBeLight = true;
      else if (targetTheme === 'dark') shouldBeLight = false;

      if (shouldBeLight !== isLight) {
        const themeBtn = document.getElementById('themeToggleBtn');
        if (themeBtn) {
          themeBtn.click();
        } else {
          document.body.classList.toggle('light-theme', shouldBeLight);
          localStorage.setItem('lukas_theme', shouldBeLight ? 'light' : 'dark');
        }
        diag.logToTerminal(`[CONVERSATIONAL AI] Changed visual theme to: ${shouldBeLight ? 'LIGHT' : 'DARK'}`, 'info');
      }
    } else if (act.type === 'weather_refresh') {
      if (typeof requestLocalWeatherUpdate === 'function') {
        requestLocalWeatherUpdate();
        diag.logToTerminal(`[CONVERSATIONAL AI] Initiated weather sync protocol`, 'info');
      }
    }
  } catch (err) {
    console.error("Failed to execute conversational action:", err);
  }
}

async function processCommand(rawCommand, source) {
  try {
    lastCommandSource = source || 'user';
    // Clear any active voice capturing timeouts immediately
    if (typeof noCommandTimeout !== 'undefined' && noCommandTimeout) {
      clearTimeout(noCommandTimeout);
      noCommandTimeout = null;
    }
    if (typeof proceedTimeout !== 'undefined' && proceedTimeout) {
      clearTimeout(proceedTimeout);
      proceedTimeout = null;
    }

    const cmd = rawCommand.toLowerCase().trim();
    appendChatBubble(rawCommand, 'user');
    diag.spikeCPU();

    // ══ LUKAS MEMORY: Record user message + extract facts ══
    lukasMemory.addMessage('user', rawCommand);
    lukasMemory.extractAndStoreFacts(rawCommand);

    const coreBtn = document.getElementById('lukasCoreBtn');
    if (coreBtn) {
      coreBtn.classList.remove('listening');
      coreBtn.classList.add('processing');
    }

    // Print intent analysis details to high-tech terminal console log
    diag.logToTerminal(`Incoming directive: "${rawCommand}" (${source.toUpperCase()})`, 'info');

    // 1. Precheck using Reasoning Engine
    const precheckResult = lukasReasoning.precheck(rawCommand);
    if (!precheckResult.valid) {
      handleAssistantResponse(`Failed pre-check: ${precheckResult.reason}`);
      return;
    }

    // Run structured 6-step Voice Intelligence reasoning cycle
    lukasReasoning.runReasoningCycle(rawCommand, diag.logToTerminal.bind(diag));

    const openaiApiKey = localStorage.getItem('openai_api_key');
    const geminiApiKey = localStorage.getItem('gemini_api_key');
    const activeProvider = openaiApiKey ? 'openai' : (geminiApiKey ? 'gemini' : 'puter');
    const activeKey = openaiApiKey || geminiApiKey || null;

    // Get home context summary for intent analysis
    const homeContext = `Active devices: ${home.dynamicDevices.filter(d => d.on).map(d => d.name).join(', ') || 'None'}. Indoor Temp: ${home.state.climate.indoorTemp}°C, target: ${home.state.climate.targetTemp}°C.`;

    // 2. Orchestration Intent Analysis
    diag.logToTerminal("[AI ORCHESTRATOR] Classifying intent...", "info");
    const routing = await lukasOrchestrator.analyze(rawCommand, homeContext, activeKey, activeProvider);
    diag.logToTerminal(`[AI INTENT] Routed to: ${routing.intent.toUpperCase()} (Confidence: ${Math.round(routing.confidence * 100)}%)`, 'info');

    // Handle intent-specific routing
    switch (routing.intent) {
      case INTENT.HOME_CONTROL:
        await handleHomeControlIntent(rawCommand, activeKey, activeProvider);
        break;

      case INTENT.RESEARCH:
        await handleResearchIntent(rawCommand, activeKey, activeProvider);
        break;

      case INTENT.MEMORY_QUERY:
        await handleMemoryQueryIntent(rawCommand, activeKey, activeProvider);
        break;

      case INTENT.WEATHER:
        await handleWeatherIntent(rawCommand);
        break;

      case INTENT.MEDIA:
        await handleMediaIntent(cmd, rawCommand);
        break;

      case INTENT.AUTOMATION:
        await handleAutomationIntent(cmd, rawCommand);
        break;

      case INTENT.MATH:
        await handleMathIntent(rawCommand, activeKey, activeProvider);
        break;

      case INTENT.SYSTEM:
        await handleSystemIntent(cmd);
        break;

      case INTENT.CONVERSATION:
      case INTENT.TASK_EXECUTION:
      case INTENT.PLANNING:
      case INTENT.ANALYSIS:
      default:
        await handleConversationalIntent(rawCommand, routing.intent, activeKey, activeProvider, source);
        break;
    }

  } catch (err) {
    console.error("Error in processCommand:", err);
    diag.logToTerminal(`[AI CORE] Error during command execution: ${err.message}`, "error");
    handleAssistantResponse("Sorry, I encountered an internal system error while executing that request.");
  }
}

// ═══════════════════ INTENT SPECIFIC HANDLERS ═══════════════════

async function handleHomeControlIntent(rawCommand, apiKey, apiProvider) {
  diag.logToTerminal("[AI PARSER] Extracting home control entities...", "info");
  const parsed = await parseHomeCommand(rawCommand, apiKey, apiProvider);
  
  if (!parsed || parsed.category === 'unknown') {
    diag.logToTerminal("[AI PARSER] Structured parse returned unknown. Falling back to local pattern matching.", "warn");
    executeLocalHomeControlFallback(rawCommand);
    return;
  }

  diag.logToTerminal(`[AI PARSER] Category: ${parsed.category} | Action: ${parsed.action} | Target: ${parsed.targetDeviceName || parsed.targetZone || 'Global'}`, "info");
  executeParsedHomeControl(parsed);
}

async function handleResearchIntent(rawCommand, apiKey, apiProvider) {
  diag.logToTerminal(`[RESEARCH AGENT] Initiating web research for: "${rawCommand}"...`, "info");
  
  let query = rawCommand;
  const cleanMatch = rawCommand.match(/(?:search for|search|research|look up|tell me about|what is|who is|define)\s+(.+)/i);
  if (cleanMatch && cleanMatch[1]) {
    query = cleanMatch[1].trim();
  }

  const result = await lukasResearch.research(query, { apiKey, apiProvider, memory: lukasMemory });
  
  if (result && result.answer) {
    diag.logToTerminal(`[RESEARCH AGENT] Research finished with confidence: ${Math.round(result.confidence * 100)}%`, "info");
    
    // Split for spoken readout (first two sentences)
    const sentences = result.answer.split(/(?<=[.!?])\s+/);
    const speechSummary = sentences.slice(0, 2).filter(s => s.trim().length > 0).join(" ");
    
    diag.logToTerminal(`[LUKAS REPLY] "${speechSummary}"`, 'info');
    
    const displayAnswer = `${result.answer}\n\n*Sources: ${result.sources.join(', ') || 'Web Search'}*`;
    appendChatBubble(displayAnswer, 'assistant');
    voice.stopWakeWordListener();
    voice.speak(speechSummary);
    
    lukasMemory.addMessage('assistant', displayAnswer, 'research');
    keepConversationAlive(12000); // Hold mic active for follow-ups
  } else {
    handleAssistantResponse(`I performed a web search for "${query}" but found no matching records.`);
  }
}

async function handleMemoryQueryIntent(rawCommand, apiKey, apiProvider) {
  diag.logToTerminal("[MEMORY AGENT] Recalling information from memory...", "info");
  
  const systemPrompt = `You are LUKAS's memory recall assistant. The user is asking about something you should remember.
Use the remembered facts and preferences below to answer their question accurately.

[REMEMBERED FACTS]
${lukasMemory.buildContextBlock()}`;

  const response = await generateConversationalResponse({
    userMessage: rawCommand,
    memory: lukasMemory,
    intent: 'memory_query',
    apiKey,
    apiProvider
  });

  if (response) {
    lukasMemory.addMessage('assistant', response, 'memory_query');
    handleAssistantResponse(response);
    keepConversationAlive(8000);
  } else {
    handleAssistantResponse("My memory banks are intact, but I couldn't find a record matching that query.");
  }
}

async function handleWeatherIntent(rawCommand) {
  const cmd = rawCommand.toLowerCase().trim();
  let weatherCity = "";
  const match = cmd.match(/(?:weather|temperature|temp|climate|forecast|raining|snowing|hot|cold|conditions|rain|snow|wind|precipitation|shower|cloudy|sunny|clear)\s+(?:in|at|for)\s+([a-zA-Z\s.-]+)/i);
  if (match && match[1]) {
    weatherCity = match[1].trim();
  }

  const targetCity = weatherCity;
  if (!targetCity) {
    diag.logToTerminal("[WEATHER QUERY] Retrieving browser GPS coordinates for local forecast...", "info");
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const data = await fetchRealTimeWeather({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            name: "My Location"
          });
          handleWeatherResponse(data);
          keepConversationAlive(8000);
        },
        async (error) => {
          const fallbackCity = getDefaultCityFromTimezone();
          diag.logToTerminal(`[GPS] Geolocation failed (${error.message}). Checking fallback city: ${fallbackCity}...`, "warn");
          const data = await fetchRealTimeWeather(fallbackCity);
          handleWeatherResponse(data);
          keepConversationAlive(8000);
        },
        { timeout: 5000 }
      );
    } else {
      const fallbackCity = getDefaultCityFromTimezone();
      diag.logToTerminal("[GPS] Geolocation unsupported. Checking fallback city...", "warn");
      const data = await fetchRealTimeWeather(fallbackCity);
      handleWeatherResponse(data);
      keepConversationAlive(8000);
    }
  } else {
    const data = await fetchRealTimeWeather(targetCity);
    handleWeatherResponse(data);
    keepConversationAlive(8000);
  }
}

async function handleMediaIntent(cmd, rawCommand) {
  executeParsedHomeControl({
    category: 'media',
    action: cmd.includes('pause') || cmd.includes('stop') ? 'pause' : cmd.includes('next') ? 'next' : cmd.includes('prev') ? 'prev' : 'play',
    value: rawCommand
  });
}

async function handleAutomationIntent(cmd, rawCommand) {
  const isClearReminders = /\b(clear|delete|remove)\s*(?:all\s*)?(?:reminder|task|alarm|timer)s?\b/i.test(cmd);
  if (isClearReminders) {
    reminderTimers.forEach((t) => clearTimeout(t));
    reminderTimers.clear();
    lukasReminders.length = 0;
    saveReminders();
    handleAssistantResponse("All reminders have been cleared, Commander.");
    return;
  }

  const isListReminders = /\b(list|show|view|what|my)\s*(?:all\s*)?(?:reminder|task|alarm|timer)s?\b/i.test(cmd) || (cmd.includes('reminder') && (cmd.includes('list') || cmd.includes('show') || cmd.includes('what')));
  if (isListReminders) {
    const active = lukasReminders.filter(r => !r.fired);
    if (active.length === 0) {
      handleAssistantResponse("You have no active reminders, Commander.");
    } else {
      const listText = active.map((r, i) => {
        const t = new Date(r.fireAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `${i + 1}. ${r.text} — at ${t}`;
      }).join('. ');
      handleAssistantResponse(`You have ${active.length} active reminder${active.length > 1 ? 's' : ''}. ${listText}`);
    }
    return;
  }

  const inlineTime = parseReminderTime(cmd);
  const inlineText = extractReminderText(rawCommand);
  
  if (inlineTime && inlineText && inlineText !== 'Reminder') {
    addReminder(inlineText, inlineTime);
    const timeStr = inlineTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    handleAssistantResponse(`Reminder set: "${inlineText}" — I'll alert you at ${timeStr}, Commander.`);
    return;
  }
  
  if (inlineTime && (!inlineText || inlineText === 'Reminder')) {
    activeFollowUp = { type: 'reminder_input', time: inlineTime };
    handleAssistantResponse("What should I remind you about, Commander?");
    return;
  }
  
  if (!inlineTime && inlineText && inlineText !== 'Reminder') {
    const defaultTime = new Date(Date.now() + 5 * 60000);
    addReminder(inlineText, defaultTime);
    const timeStr = defaultTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    handleAssistantResponse(`Reminder set: "${inlineText}" — defaulting to 5 minutes from now at ${timeStr}, Commander.`);
    return;
  }
  
  activeFollowUp = { type: 'reminder_input' };
  handleAssistantResponse("What would you like to be reminded about, Commander?");
}

async function handleMathIntent(rawCommand, apiKey, apiProvider) {
  diag.logToTerminal("[AI MATH] Solving mathematical query...", "info");
  const systemPrompt = "You are LUKAS's math assistant. Solve the user's mathematical query. Return a clear and direct numerical answer.";
  const response = await generateConversationalResponse({
    userMessage: rawCommand,
    memory: null,
    intent: 'math',
    apiKey,
    apiProvider
  });
  if (response) {
    handleAssistantResponse(response);
  } else {
    handleAssistantResponse("I couldn't solve the calculation. Please try again.");
  }
}

async function handleSystemIntent(cmd) {
  if (cmd.includes('clear memory') || cmd.includes('forget me') || cmd.includes('clear history')) {
    lukasMemory.clearAllMemory();
    handleAssistantResponse("All conversation logs and long-term memory facts have been cleared.");
    return;
  }
  
  const cpu = Math.round(diag.metrics.cpu);
  const temp = diag.metrics.temp.toFixed(1);
  const security = diag.metrics.security.toFixed(1);
  handleAssistantResponse(`Diagnostics: CPU Load at ${cpu}%, Thermals stable at ${temp}°C, Firewall Shield Integrity at ${security}%. Core database is normal.`);
  diag.logToTerminal("[AI CORE] Performing system diagnostic dump...", "info");
  setTimeout(() => {
    diag.logToTerminal(`&gt; CPU: ${cpu}% | RAM: ${diag.metrics.ram.toFixed(1)}% | Core Temp: ${temp}C`, 'info');
  }, 350);
}

async function handleConversationalIntent(rawCommand, intent, apiKey, apiProvider, source = 'user') {
  diag.logToTerminal(`[AI CORE] Querying Conversational AI for: "${rawCommand}"...`, "info");
  
  const homeContext = `Active devices: ${home.dynamicDevices.filter(d => d.on).map(d => d.name).join(', ') || 'None'}. Climate target: ${home.state.climate.targetTemp}°C.`;

  // If no API key is set, run Wikipedia search fallback
  if (!apiKey && !window.puter?.ai) {
    runWikipediaSearchFallback(rawCommand);
    return;
  }

  const isVoiceMode = (source === 'voice');
  
  // Create streaming bubble if we have a key
  if (apiKey) {
    const streamingBubble = appendStreamingChatBubble('assistant');
    let spokenSentences = new Set();
    let sentenceBuffer = "";

    const streamCallback = (delta, fullText) => {
      streamingBubble.update(fullText);
      sentenceBuffer += delta;

      let match;
      const sentenceRegex = /[^.!?\n]+[.!?\n](\s+|$)/g;
      let lastIndex = 0;

      while ((match = sentenceRegex.exec(sentenceBuffer)) !== null) {
        const sentence = match[0].trim();
        if (sentence && !spokenSentences.has(sentence)) {
          spokenSentences.add(sentence);
          if (isVoiceMode) {
            voice.speakSentence(sentence);
          }
        }
        lastIndex = sentenceRegex.lastIndex;
      }

      if (lastIndex > 0) {
        sentenceBuffer = sentenceBuffer.slice(lastIndex);
      }
    };

    try {
      const response = await generateConversationalResponse({
        userMessage: rawCommand,
        memory: lukasMemory,
        homeContext,
        intent,
        apiKey,
        apiProvider,
        streamCallback,
        isVoice: isVoiceMode
      });

      if (response) {
        // Speak any remaining buffer
        const remaining = sentenceBuffer.trim();
        if (remaining && !spokenSentences.has(remaining)) {
          spokenSentences.add(remaining);
          if (isVoiceMode) {
            voice.speakSentence(remaining);
          }
        }

        // Remove processing state from Core Button
        const coreBtn = document.getElementById('lukasCoreBtn');
        if (coreBtn) {
          coreBtn.classList.remove('processing');
          coreBtn.classList.remove('listening');
        }

        // Log and add to memory
        diag.logToTerminal(`[LUKAS REPLY] "${response.slice(0, 120)}${response.length > 120 ? '...' : ''}"`, 'info');
        lukasMemory.addMessage('assistant', response, intent);

        // Validation Checks (Layer 5 / Response Quality Rules)
        const validation = lukasReasoning.validate(rawCommand, response);
        if (!validation.valid) {
          diag.logToTerminal(`[REASONING WARNING] Output validation failed (Score: ${validation.score}). Issues: ${validation.issues.join(', ')}.`, 'warn');
        } else {
          diag.logToTerminal(`[REASONING] Response validated successfully (Score: ${validation.score}).`, 'info');
        }

        // Keep mic alive for follow-up commands if voice mode
        const isQuestion = response.trim().endsWith('?') || response.includes('?');
        if (isQuestion || intent === 'planning' || intent === 'task_execution' || isVoiceMode) {
          keepConversationAlive(15000);
        }
      }
    } catch (err) {
      console.error("Error in streaming response:", err);
      streamingBubble.update("Sorry, I encountered an internal error during response generation.");
      const coreBtn = document.getElementById('lukasCoreBtn');
      if (coreBtn) {
        coreBtn.classList.remove('processing');
      }
    }
  } else {
    // Non-streaming fallback for Puter AI
    const response = await generateConversationalResponse({
      userMessage: rawCommand,
      memory: lukasMemory,
      homeContext,
      intent,
      apiKey,
      apiProvider,
      isVoice: isVoiceMode
    });

    if (response) {
      lukasMemory.addMessage('assistant', response, intent);
      handleAssistantResponse(response);
      
      const isQuestion = response.trim().endsWith('?') || response.includes('?');
      if (isQuestion || intent === 'planning' || intent === 'task_execution' || isVoiceMode) {
        keepConversationAlive(15000);
      }
    } else {
      runWikipediaSearchFallback(rawCommand);
    }
  }
}

// ═══════════════════ SUB-ROUTINE EXECUTION WRAPPERS ═══════════════════

function executeParsedHomeControl(parsed) {
  let aiResponseText = "";
  let aiIsControlAction = false;
  let handledByAI = false;

  const colorMap = {
    'red': '#ff0000', 'green': '#10b981', 'blue': '#3b82f6', 'purple': '#a855f7',
    'cyan': '#00f0ff', 'orange': '#ff9f3b', 'white': '#ffffff', 'yellow': '#eab308',
    'pink': '#ec4899', 'magenta': '#d946ef', 'lime': '#84cc16', 'teal': '#14b8a6',
    'gold': '#f59e0b', 'crimson': '#e11d48'
  };

  if (parsed && parsed.category && parsed.category !== 'unknown') {
    // LIGHTS
    if (parsed.category === 'light') {
      aiIsControlAction = true;
      let targetZone = null;
      let zoneLabel = "";
      if (parsed.targetZone === 'Living Room') { targetZone = DEVICES.LIVING_ROOM; zoneLabel = "Living Room"; }
      else if (parsed.targetZone === 'Bedroom') { targetZone = DEVICES.BEDROOM; zoneLabel = "Bedroom"; }
      else if (parsed.targetZone === 'Kitchen') { targetZone = DEVICES.KITCHEN; zoneLabel = "Kitchen"; }
      
      let targetDevice = null;
      if (parsed.targetDeviceName) {
        const searchName = parsed.targetDeviceName.toLowerCase();
        targetDevice = home.dynamicDevices.find(d => d.name.toLowerCase().includes(searchName) || searchName.includes(d.name.toLowerCase()));
      }
      
      const turnOn = parsed.action === 'on' || parsed.action === 'activate';
      const turnOff = parsed.action === 'off' || parsed.action === 'deactivate';
      
      if (targetDevice) {
        const updates = {};
        let actionLabel = "";
        if (turnOn) {
          updates.on = true;
          actionLabel = "activated";
        } else if (turnOff) {
          updates.on = false;
          actionLabel = "deactivated";
        } else if (parsed.action === 'color' && parsed.value) {
          const hex = colorMap[parsed.value.toLowerCase()] || parsed.value;
          updates.on = true;
          updates.color = hex;
          actionLabel = `set to ${parsed.value}`;
        } else if (parsed.action === 'brightness' && parsed.value) {
          const val = parseInt(parsed.value);
          updates.on = true;
          updates.brightness = isNaN(val) ? 50 : val;
          actionLabel = `dimmed to ${updates.brightness}%`;
        } else {
          updates.on = !targetDevice.on;
          actionLabel = !targetDevice.on ? "activated" : "deactivated";
        }
        home.setDeviceState(targetDevice.id, updates);
        aiResponseText = `Understood. I have successfully ${actionLabel} the ${targetDevice.name} in the ${targetDevice.zone}.`;
        handledByAI = true;
      } else if (parsed.isGlobal || (!targetZone && !parsed.targetDeviceName)) {
        if (turnOn) {
          home.setDeviceState(DEVICES.LIVING_ROOM, { on: true });
          home.setDeviceState(DEVICES.BEDROOM, { on: true });
          home.setDeviceState(DEVICES.KITCHEN, { on: true });
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light') home.setDeviceState(dev.id, { on: true });
          }
          aiResponseText = "Understood. Re-initializing all internal lighting arrays.";
        } else if (turnOff) {
          home.setDeviceState(DEVICES.LIVING_ROOM, { on: false });
          home.setDeviceState(DEVICES.BEDROOM, { on: false });
          home.setDeviceState(DEVICES.KITCHEN, { on: false });
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light') home.setDeviceState(dev.id, { on: false });
          }
          aiResponseText = "Understood. Powering down all lighting grids.";
        } else if (parsed.action === 'color' && parsed.value) {
          const hex = colorMap[parsed.value.toLowerCase()] || parsed.value;
          home.setDeviceState(DEVICES.LIVING_ROOM, { on: true, color: hex });
          home.setDeviceState(DEVICES.BEDROOM, { on: true, color: hex });
          home.setDeviceState(DEVICES.KITCHEN, { on: true, color: hex });
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light') home.setDeviceState(dev.id, { on: true, color: hex });
          }
          aiResponseText = `Affirmative. Changing all active light spectrums to ${parsed.value}.`;
        } else if (parsed.action === 'brightness' && parsed.value) {
          const val = parseInt(parsed.value);
          const percent = isNaN(val) ? 50 : val;
          home.setDeviceState(DEVICES.LIVING_ROOM, { on: true, brightness: percent });
          home.setDeviceState(DEVICES.BEDROOM, { on: true, brightness: percent });
          home.setDeviceState(DEVICES.KITCHEN, { on: true, brightness: percent });
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light') home.setDeviceState(dev.id, { on: true, brightness: percent });
          }
          aiResponseText = `Adjusting all active light brightness levels to ${percent} percent.`;
        } else {
          const isAnyOn = home.state.devices[DEVICES.LIVING_ROOM].on || home.state.devices[DEVICES.BEDROOM].on;
          const newState = !isAnyOn;
          home.setDeviceState(DEVICES.LIVING_ROOM, { on: newState });
          home.setDeviceState(DEVICES.BEDROOM, { on: newState });
          home.setDeviceState(DEVICES.KITCHEN, { on: newState });
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light') home.setDeviceState(dev.id, { on: newState });
          }
          aiResponseText = `Toggling all lighting grids ${newState ? 'ON' : 'OFF'}.`;
        }
        handledByAI = true;
      } else if (targetZone) {
        const updates = {};
        let actionLabel = "";
        if (turnOn) {
          updates.on = true;
          actionLabel = "activated";
        } else if (turnOff) {
          updates.on = false;
          actionLabel = "deactivated";
        } else if (parsed.action === 'color' && parsed.value) {
          const hex = colorMap[parsed.value.toLowerCase()] || parsed.value;
          updates.on = true;
          updates.color = hex;
          actionLabel = `set to ${parsed.value}`;
        } else if (parsed.action === 'brightness' && parsed.value) {
          const val = parseInt(parsed.value);
          updates.on = true;
          updates.brightness = isNaN(val) ? 50 : val;
          actionLabel = `dimmed to ${updates.brightness}%`;
        } else {
          const isCurrentOn = home.state.devices[targetZone].on;
          updates.on = !isCurrentOn;
          actionLabel = !isCurrentOn ? "activated" : "deactivated";
        }
        home.setDeviceState(targetZone, updates);
        for (const dev of home.dynamicDevices) {
          if (dev.category === 'light' && dev.zone === zoneLabel) {
            home.setDeviceState(dev.id, updates);
          }
        }
        aiResponseText = `Perfect, I have ${actionLabel} the lighting grid in the ${zoneLabel}.`;
        handledByAI = true;
      }
    }
    
    // CLIMATE
    else if (parsed.category === 'climate') {
      aiIsControlAction = true;
      if (parsed.action === 'temp' && parsed.value) {
        const val = parseInt(parsed.value);
        if (!isNaN(val)) {
          home.setTargetTemperature(val);
          aiResponseText = `Adjusting climate modules. Eco-Thermostat target set to ${val} degrees Celsius.`;
          handledByAI = true;
        }
      } else if (parsed.action === 'mode' && parsed.value) {
        const mode = parsed.value.toLowerCase();
        if (['cool', 'heat', 'eco'].includes(mode)) {
          home.setClimateMode(mode);
          aiResponseText = `Configuring eco-thermostat matrix to ${mode.toUpperCase()} mode.`;
          handledByAI = true;
        }
      } else if (parsed.action === 'status') {
        aiResponseText = `Current indoor sensor reading is ${home.state.climate.indoorTemp}°C, target set to ${home.state.climate.targetTemp}°C in ${home.state.climate.mode} mode.`;
        aiIsControlAction = false;
        handledByAI = true;
      }
    }
    
    // SECURITY
    else if (parsed.category === 'security') {
      aiIsControlAction = true;
      let targetDevice = null;
      if (parsed.targetDeviceName) {
        const searchName = parsed.targetDeviceName.toLowerCase();
        targetDevice = home.dynamicDevices.find(d => d.category === 'security' && (d.name.toLowerCase().includes(searchName) || searchName.includes(d.name.toLowerCase())));
      }
      
      const lock = parsed.action === 'off' || parsed.action === 'stop' || parsed.action === 'close';
      const unlock = parsed.action === 'on' || parsed.action === 'open' || parsed.action === 'release';
      
      if (targetDevice) {
        const isLocked = unlock ? false : (lock ? true : !targetDevice.locked);
        home.setDeviceState(targetDevice.id, { locked: isLocked });
        aiResponseText = `Understood. I have successfully ${isLocked ? 'locked and secured' : 'unlocked'} the ${targetDevice.name} in the ${targetDevice.zone}.`;
        handledByAI = true;
      } else {
        const isLocked = unlock ? false : (lock ? true : !home.state.devices[DEVICES.OUTDOOR].locked);
        home.setDeviceState(DEVICES.OUTDOOR, { locked: isLocked });
        aiResponseText = isLocked ? "Perimeter locks engaged. Main entryway secured." : "Security locks disengaged. Main entryway is now unlocked.";
        handledByAI = true;
      }
    }
    
    // ROUTINES
    else if (parsed.category === 'routine' && parsed.value) {
      aiIsControlAction = true;
      const val = parsed.value.toLowerCase();
      if (val.includes('morning') || val.includes('wake')) {
        triggerRoutineEffect(ROUTINES.MORNING);
        aiResponseText = "Vocalizing morning sequence. Thermostat and lighting profiles loaded for start of day.";
        handledByAI = true;
      } else if (val.includes('cinema') || val.includes('movie') || val.includes('theater')) {
        triggerRoutineEffect(ROUTINES.CINEMA);
        aiResponseText = "Initiating Cinema Mode. Ambient lights dimmed, secondary grids disabled. Enjoy your feature.";
        handledByAI = true;
      } else if (val.includes('eco') || val.includes('green') || val.includes('save')) {
        triggerRoutineEffect(ROUTINES.ECO);
        aiResponseText = "Power saving eco schedules initiated. Reducing carbon signature profiles.";
        handledByAI = true;
      } else if (val.includes('lockdown') || val.includes('emergency')) {
        triggerRoutineEffect(ROUTINES.LOCKDOWN);
        aiResponseText = "WARNING! SECURITY LOCKDOWN ACTIVATED. All portals secured, emergency beacons flashing red.";
        handledByAI = true;
      }
    }
    
    // MEDIA
    else if (parsed.category === 'media') {
      aiIsControlAction = true;
      if (parsed.action === 'pause' || parsed.action === 'stop') {
        isPlaying = false;
        updateMediaPlayButton(false);
        audioPlayer.pause();
        aiResponseText = "Ambient audio feeds paused.";
        handledByAI = true;
      } else if (parsed.action === 'next') {
        currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
        isPlaying = true;
        updateMediaWidget();
        playTrack();
        aiResponseText = `Skipping to next stream: "${playlist[currentTrackIndex].title}" on ${activePlatform}.`;
        handledByAI = true;
      } else if (parsed.action === 'prev') {
        currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
        isPlaying = true;
        updateMediaWidget();
        playTrack();
        aiResponseText = `Reverting to previous stream: "${playlist[currentTrackIndex].title}" on ${activePlatform}.`;
        handledByAI = true;
      } else {
        let foundIndex = -1;
        if (parsed.value) {
          const val = parsed.value.toLowerCase();
          if (val.includes('bollywood') || val.includes('hindi') || val.includes('desi') || val.includes('indian')) {
            foundIndex = playlist.findIndex(t => t.title.toLowerCase().includes('bollywood') || t.title.toLowerCase().includes('ghazal'));
          } else if (val.includes('kannada') || val.includes('karnataka') || val.includes('bangalore') || val.includes('bengaluru')) {
            foundIndex = playlist.findIndex(t => t.title.toLowerCase().includes('kannada'));
          } else if (val.includes('synthwave') || val.includes('viper')) {
            foundIndex = playlist.findIndex(t => t.title.toLowerCase().includes('viper'));
          } else if (val.includes('cyberpunk') || val.includes('outfoxing')) {
            foundIndex = playlist.findIndex(t => t.title.toLowerCase().includes('outfoxing'));
          } else if (val.includes('ambient') || val.includes('horizon')) {
            foundIndex = playlist.findIndex(t => t.title.toLowerCase().includes('ambient'));
          }
        }
        if (foundIndex !== -1) currentTrackIndex = foundIndex;
        isPlaying = true;
        updateMediaWidget();
        playTrack();
        aiResponseText = `Playing requested stream: "${playlist[currentTrackIndex].title}" using ${activePlatform}.`;
        handledByAI = true;
      }
    }
    
    // CCTV
    else if (parsed.category === 'cctv') {
      aiIsControlAction = true;
      const probeBtn = document.getElementById('cam1ProbeBtn');
      if (probeBtn) {
        probeBtn.click();
        aiResponseText = "Understood. Engaging camera matrix and initiating auto-probe sequence for CAM 01.";
      } else {
        aiResponseText = "Initiating camera feed diagnostics. Loading CAM 01 live video stream.";
      }
      handledByAI = true;
    }
    
    // TIME
    else if (parsed.category === 'time') {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      aiResponseText = `The current system time is ${timeStr}.`;
      handledByAI = true;
    }
    
    // DATE
    else if (parsed.category === 'date') {
      const now = new Date();
      const dateStr = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      aiResponseText = `Today is ${dateStr}.`;
      handledByAI = true;
    }
    
    // DIAGNOSTICS
    else if (parsed.category === 'diagnostics') {
      aiResponseText = `Diagnostics: CPU Load at ${Math.round(diag.metrics.cpu)}%, Thermals stable at ${diag.metrics.temp.toFixed(1)}°C, Firewall Shield Integrity at ${diag.metrics.security.toFixed(1)}%. Core database is normal.`;
      diag.logToTerminal("[AI CORE] Performing system diagnostic dump...", "info");
      setTimeout(() => {
        diag.logToTerminal(`&gt; CPU: ${diag.metrics.cpu.toFixed(1)}% | RAM: ${diag.metrics.ram.toFixed(1)}% | Core Temp: ${diag.metrics.temp.toFixed(1)}C`, 'info');
      }, 350);
      handledByAI = true;
    }
    
    // GREETINGS
    else if (parsed.category === 'greetings') {
      aiResponseText = "System online. Greetings, Commander. Ready for instruction.";
      handledByAI = true;
    }

    if (handledByAI) {
      handleAssistantResponse(aiResponseText, aiIsControlAction);
    }
  }
}

function executeLocalHomeControlFallback(rawCommand) {
  const cmd = rawCommand.toLowerCase().trim();
  let responseText = "";
  let isControlAction = false;

  const colorMap = {
    'red': '#ff0000', 'green': '#10b981', 'blue': '#3b82f6', 'purple': '#a855f7',
    'cyan': '#00f0ff', 'orange': '#ff9f3b', 'white': '#ffffff', 'yellow': '#eab308',
    'pink': '#ec4899', 'magenta': '#d946ef', 'lime': '#84cc16', 'teal': '#14b8a6',
    'gold': '#f59e0b', 'crimson': '#e11d48'
  };

  // Check if command references a dynamically registered device
  let dynamicMatch = null;
  const isGlobalCommand = cmd.includes('all') || cmd.includes('every') || cmd.includes('entire') || cmd.includes('house');
    
  if (!isGlobalCommand) {
    for (const dev of home.dynamicDevices) {
      const devNameLower = dev.name.toLowerCase();
      if (cmd.includes(devNameLower) || (devNameLower.split(' ').length > 1 && devNameLower.split(' ').some(word => word.length > 4 && cmd.includes(word)))) {
        const isLegacy = ["livingRoomLight", "bedroomLight", "kitchenLight", "outdoorLock"].includes(dev.id);
        if (!isLegacy) {
          dynamicMatch = dev;
          break;
        }
      }
    }
  }

  if (!dynamicMatch && !isGlobalCommand) {
    for (const dev of home.dynamicDevices) {
      const isLegacy = ["livingRoomLight", "bedroomLight", "kitchenLight", "outdoorLock"].includes(dev.id);
      if (isLegacy) continue;
      const words = dev.name.toLowerCase().split(' ');
      const keyWords = words.filter(w => !['smart', 'node', 'device', 'the', 'light', 'lock', 'room'].includes(w));
      if (keyWords.some(kw => cmd.includes(kw))) {
        dynamicMatch = dev;
        break;
      }
    }
  }

  if (dynamicMatch) {
    const turnOn = /\bon\b/.test(cmd) || cmd.includes('activate') || cmd.includes('enable') || cmd.includes('start') || cmd.includes('turn on') || cmd.includes('open');
    const turnOff = /\boff\b/.test(cmd) || /\bof\b/.test(cmd) || cmd.includes('deactivate') || cmd.includes('disable') || cmd.includes('shutdown') || cmd.includes('stop') || cmd.includes('turn off') || cmd.includes('close') || cmd.includes('lock');
    
    const updates = {};
    let actionLabel = "";
    
    if (dynamicMatch.category === 'security') {
      if (turnOn) {
        updates.locked = false;
        actionLabel = "unlocked";
      } else if (turnOff) {
        updates.locked = true;
        actionLabel = "locked and secured";
      } else {
        updates.locked = !dynamicMatch.locked;
        actionLabel = !dynamicMatch.locked ? "locked and secured" : "unlocked";
      }
    } else {
      if (turnOn) {
        updates.on = true;
        actionLabel = "activated";
      } else if (turnOff) {
        updates.on = false;
        actionLabel = "deactivated";
      } else {
        updates.on = !dynamicMatch.on;
        actionLabel = !dynamicMatch.on ? "activated" : "deactivated";
      }
      
      if (dynamicMatch.category === 'light') {
        const numbers = cmd.match(/\d+/);
        if (numbers) {
          updates.brightness = Math.min(100, Math.max(10, parseInt(numbers[0])));
          updates.on = true;
          actionLabel = `activated at ${updates.brightness}% brightness`;
        }
        
        let hexColor = null;
        let colorLabel = "";
        if (cmd.includes('red')) { hexColor = "#ff0000"; colorLabel = "crimson red"; }
        else if (cmd.includes('green')) { hexColor = "#10b981"; colorLabel = "emerald green"; }
        else if (cmd.includes('blue')) { hexColor = "#3b82f6"; colorLabel = "royal blue"; }
        else if (cmd.includes('purple')) { hexColor = "#a855f7"; colorLabel = "purple"; }
        else if (cmd.includes('cyan')) { hexColor = "#00f0ff"; colorLabel = "neon cyan"; }
        else if (cmd.includes('orange')) { hexColor = "#ff9f3b"; colorLabel = "amber orange"; }
        else if (cmd.includes('white')) { hexColor = "#ffffff"; colorLabel = "cool white"; }
        
        if (hexColor) {
          updates.color = hexColor;
          updates.on = true;
          actionLabel += (actionLabel ? " and set to " : "activated and set to ") + colorLabel;
        }
      }
    }
    
    home.setDeviceState(dynamicMatch.id, updates);
    responseText = `Understood. I have successfully ${actionLabel} the ${dynamicMatch.name} in the ${dynamicMatch.zone}.`;
    diag.logToTerminal(`[AI VOICE CONTROL] Dynamic device match: ${dynamicMatch.name} -> Updates applied: ${JSON.stringify(updates)}`, 'info');
    
    handleAssistantResponse(responseText, true);
    return;
  }
  
  // LIGHTS DIRECTIVES
  const isRoomCommand = cmd.includes('living') || cmd.includes('bedroom') || cmd.includes('kitchen') || cmd.includes('salon') || cmd.includes('cook') || cmd.includes('sleep');
  const isGeneralLightCommand = cmd.includes('light') || cmd.includes('lamp') || cmd.includes('illumination') || cmd.includes('bulb') || cmd.includes('led');
  const isColor = cmd.includes('color') || cmd.includes('colour') || Object.keys(colorMap).some(name => cmd.includes(name));
  
  if (isGeneralLightCommand || (isRoomCommand && (/\bon\b/.test(cmd) || /\boff\b/.test(cmd) || /\bof\b/.test(cmd) || cmd.includes('dim') || cmd.includes('brightness') || cmd.includes('color') || cmd.includes('colour') || cmd.includes('percent') || cmd.includes('%') || isColor))) {
    let zone = null;
    let zoneLabel = "";
    if (cmd.includes('living') || cmd.includes('salon')) { zone = DEVICES.LIVING_ROOM; zoneLabel = "Living Room"; }
    else if (cmd.includes('bedroom') || cmd.includes('sleep')) { zone = DEVICES.BEDROOM; zoneLabel = "Bedroom"; }
    else if (cmd.includes('kitchen') || cmd.includes('cook')) { zone = DEVICES.KITCHEN; zoneLabel = "Kitchen"; }
    
    const turnOn = /\bon\b/.test(cmd) || cmd.includes('activate') || cmd.includes('enable') || cmd.includes('start');
    const turnOff = /\boff\b/.test(cmd) || /\bof\b/.test(cmd) || cmd.includes('deactivate') || cmd.includes('disable') || cmd.includes('shutdown') || cmd.includes('stop');
    const isDimming = cmd.includes('dim') || cmd.includes('percent') || cmd.includes('%') || cmd.includes('brightness') || cmd.includes('intensity');

    if (zone) {
      isControlAction = true;
      if (turnOn) {
        home.setDeviceState(zone, { on: true });
        responseText = `Perfect, I have activated the lighting grid in the ${zoneLabel}.`;
      } else if (turnOff) {
        home.setDeviceState(zone, { on: false });
        responseText = `Acknowledged. Deactivating lighting systems in the ${zoneLabel}.`;
      } else if (isDimming) {
        const numbers = cmd.match(/\d+/);
        const percentVal = numbers ? parseInt(numbers[0]) : 50;
        home.setDeviceState(zone, { on: true, brightness: percentVal });
        responseText = `Configured the ${zoneLabel} lights brightness capacity to ${percentVal} percent.`;
      } else if (isColor) {
        let hexColor = null;
        let colorLabel = "";
        for (const [name, hex] of Object.entries(colorMap)) {
          if (cmd.includes(name)) {
            hexColor = hex;
            colorLabel = name;
            break;
          }
        }
        if (!hexColor) {
          hexColor = "#ffffff";
          colorLabel = "white";
        }

        home.setDeviceState(zone, { on: true, color: hexColor });
        responseText = `Affirmative. Setting the ${zoneLabel} spectrum overlay to ${colorLabel}.`;
      } else {
        const currentState = home.state.devices[zone].on;
        home.setDeviceState(zone, { on: !currentState });
        responseText = `Toggling the ${zoneLabel} lighting grid ${!currentState ? 'ON' : 'OFF'}.`;
      }
    } else {
      // Global light controls
      if (turnOn) {
        isControlAction = true;
        home.setDeviceState(DEVICES.LIVING_ROOM, { on: true });
        home.setDeviceState(DEVICES.BEDROOM, { on: true });
        home.setDeviceState(DEVICES.KITCHEN, { on: true });
        for (const dev of home.dynamicDevices) {
          if (dev.category === 'light') home.setDeviceState(dev.id, { on: true });
        }
        responseText = "Understood. Re-initializing all internal lighting arrays.";
      } else if (turnOff) {
        isControlAction = true;
        home.setDeviceState(DEVICES.LIVING_ROOM, { on: false });
        home.setDeviceState(DEVICES.BEDROOM, { on: false });
        home.setDeviceState(DEVICES.KITCHEN, { on: false });
        for (const dev of home.dynamicDevices) {
          if (dev.category === 'light') home.setDeviceState(dev.id, { on: false });
        }
        responseText = "Understood. Powering down all lighting grids.";
      } else if (isColor) {
        isControlAction = true;
        let hexColor = null;
        let colorLabel = "";
        for (const [name, hex] of Object.entries(colorMap)) {
          if (cmd.includes(name)) {
            hexColor = hex;
            colorLabel = name;
            break;
          }
        }
        if (!hexColor) {
          hexColor = "#ffffff";
          colorLabel = "white";
        }
        
        home.setDeviceState(DEVICES.LIVING_ROOM, { on: true, color: hexColor });
        home.setDeviceState(DEVICES.BEDROOM, { on: true, color: hexColor });
        home.setDeviceState(DEVICES.KITCHEN, { on: true, color: hexColor });
        for (const dev of home.dynamicDevices) {
          if (dev.category === 'light') home.setDeviceState(dev.id, { on: true, color: hexColor });
        }
        responseText = `Affirmative. Changing all active light spectrums to ${colorLabel}.`;
      } else if (isDimming) {
        isControlAction = true;
        const numbers = cmd.match(/\d+/);
        const percentVal = numbers ? parseInt(numbers[0]) : 50;
        
        home.setDeviceState(DEVICES.LIVING_ROOM, { on: true, brightness: percentVal });
        home.setDeviceState(DEVICES.BEDROOM, { on: true, brightness: percentVal });
        home.setDeviceState(DEVICES.KITCHEN, { on: true, brightness: percentVal });
        for (const dev of home.dynamicDevices) {
          if (dev.category === 'light') home.setDeviceState(dev.id, { on: true, brightness: percentVal });
        }
        responseText = `Acknowledged. Adjusting all active light brightness levels to ${percentVal} percent.`;
      } else if (cmd.includes('all') || cmd.includes('every') || cmd.includes('entire') || cmd.includes('house') || cmd.includes('toggle') || cmd.includes('switch')) {
        isControlAction = true;
        const isAnyOn = home.state.devices[DEVICES.LIVING_ROOM].on || home.state.devices[DEVICES.BEDROOM].on;
        const newState = !isAnyOn;
        home.setDeviceState(DEVICES.LIVING_ROOM, { on: newState });
        home.setDeviceState(DEVICES.BEDROOM, { on: newState });
        home.setDeviceState(DEVICES.KITCHEN, { on: newState });
        for (const dev of home.dynamicDevices) {
          if (dev.category === 'light') home.setDeviceState(dev.id, { on: newState });
        }
        responseText = `Toggling all lighting grids ${newState ? 'ON' : 'OFF'}.`;
      } else {
        responseText = "Which zone lights would you like me to adjust? Living Room, Bedroom, or Kitchen?";
      }
    }
  }
  
  // CLIMATE DIRECTIVES
  else if (cmd.includes('temp') || cmd.includes('temperature') || cmd.includes('climate') || cmd.includes('thermostat') || cmd.includes('heating') || cmd.includes('cooling') || cmd.includes('warm') || cmd.includes('cold')) {
    const numbers = cmd.match(/\d+/);
    
    if (numbers) {
      const targetTemp = parseInt(numbers[0]);
      home.setTargetTemperature(targetTemp);
      responseText = `Adjusting climate modules. Eco-Thermostat target set to ${targetTemp} degrees Celsius.`;
      isControlAction = true;
    } else if (cmd.includes('cool')) {
      home.setClimateMode('cool');
      responseText = "Configuring eco-thermostat matrix to COOLING cycles.";
      isControlAction = true;
    } else if (cmd.includes('heat') || cmd.includes('warm')) {
      home.setClimateMode('heat');
      responseText = "Configuring eco-thermostat matrix to HEATING cycles.";
      isControlAction = true;
    } else if (cmd.includes('eco') || cmd.includes('green') || cmd.includes('power saving')) {
      home.setClimateMode('eco');
      responseText = "Adjusting HVAC to optimal ECO energy conservation thresholds.";
      isControlAction = true;
    } else {
      responseText = `Current indoor sensor reading is ${home.state.climate.indoorTemp}°C, target set to ${home.state.climate.targetTemp}°C in ${home.state.climate.mode} mode.`;
    }
  }
  
  else if (cmd.includes('lock') || cmd.includes('gate') || cmd.includes('door') || cmd.includes('entrance')) {
    isControlAction = true;
    const lockUnlock = cmd.includes('unlock') || cmd.includes('open') || cmd.includes('release') || cmd.includes('deactivate');
    
    if (lockUnlock) {
      home.setDeviceState(DEVICES.OUTDOOR, { locked: false });
      responseText = "Security locks disengaged. Main entryway is now unlocked.";
    } else {
      home.setDeviceState(DEVICES.OUTDOOR, { locked: true });
      responseText = "Perimeter locks engaged. Main entryway secured.";
    }
  }
  
  // ROUTINES CONTROL DIRECTIVES
  else if (cmd.includes('morning') || cmd.includes('wake up') || cmd.includes('sunrise')) {
    isControlAction = true;
    triggerRoutineEffect(ROUTINES.MORNING);
    responseText = "Vocalizing morning sequence. Thermostat and lighting profiles loaded for start of day.";
  } 
  else if (cmd.includes('cinema') || cmd.includes('movie') || cmd.includes('theater')) {
    isControlAction = true;
    triggerRoutineEffect(ROUTINES.CINEMA);
    responseText = "Initiating Cinema Mode. Ambient lights dimmed, secondary grids disabled. Enjoy your feature.";
  } 
  else if (cmd.includes('eco') || cmd.includes('green') || cmd.includes('saving')) {
    isControlAction = true;
    triggerRoutineEffect(ROUTINES.ECO);
    responseText = "Power saving eco schedules initiated. Reducing carbon signature profiles.";
  } 
  else if (cmd.includes('lockdown') || cmd.includes('emergency') || cmd.includes('threat') || cmd.includes('breach') || cmd.includes('danger')) {
    isControlAction = true;
    triggerRoutineEffect(ROUTINES.LOCKDOWN);
    responseText = "WARNING! SECURITY LOCKDOWN ACTIVATED. All portals secured, emergency beacons flashing red.";
  }
  
  // MEDIA DIRECTIVES
  else if (cmd.includes('music') || cmd.includes('song') || cmd.includes('audio') || cmd.includes('play') || cmd.includes('pause') || cmd.includes('media')) {
    isControlAction = true;
    if (cmd.includes('pause') || cmd.includes('stop')) {
      isPlaying = false;
      updateMediaPlayButton(false);
      audioPlayer.pause();
      responseText = "Ambient audio feeds paused.";
    } else if (cmd.includes('next') || cmd.includes('forward')) {
      currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
      isPlaying = true;
      updateMediaWidget();
      playTrack();
      responseText = `Skipping to next stream: "${playlist[currentTrackIndex].title}" on ${activePlatform}.`;
    } else if (cmd.includes('prev') || cmd.includes('back')) {
      currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
      isPlaying = true;
      updateMediaWidget();
      playTrack();
      responseText = `Reverting to previous stream: "${playlist[currentTrackIndex].title}" on ${activePlatform}.`;
    } else {
      let foundIndex = -1;
      if (cmd.includes('bollywood') || cmd.includes('hindi') || cmd.includes('desi') || cmd.includes('indian')) {
        foundIndex = playlist.findIndex(t => t.title.toLowerCase().includes('bollywood') || t.title.toLowerCase().includes('ghazal'));
      } else if (cmd.includes('kannada') || cmd.includes('karnataka') || cmd.includes('bangalore') || cmd.includes('bengaluru')) {
        foundIndex = playlist.findIndex(t => t.title.toLowerCase().includes('kannada'));
      } else if (cmd.includes('synthwave') || cmd.includes('viper')) {
        foundIndex = playlist.findIndex(t => t.title.toLowerCase().includes('viper'));
      } else if (cmd.includes('cyberpunk') || cmd.includes('outfoxing')) {
        foundIndex = playlist.findIndex(t => t.title.toLowerCase().includes('outfoxing'));
      } else if (cmd.includes('ambient') || cmd.includes('horizon')) {
        foundIndex = playlist.findIndex(t => t.title.toLowerCase().includes('ambient'));
      }
      
      if (foundIndex !== -1) {
        currentTrackIndex = foundIndex;
      }
      
      isPlaying = true;
      updateMediaWidget();
      playTrack();
      responseText = `Playing requested stream: "${playlist[currentTrackIndex].title}" using ${activePlatform}.`;
    }
  }

  // CCTV / CAMERA DIRECTIVES
  else if (cmd.includes('cctv') || cmd.includes('camera') || cmd.includes('surveillance') || cmd.includes('feed') || cmd.includes('video') || cmd.includes('cam')) {
    isControlAction = true;
    const probeBtn = document.getElementById('cam1ProbeBtn');
    if (probeBtn) {
      probeBtn.click();
      responseText = "Understood. Engaging camera matrix and initiating auto-probe sequence for CAM 01.";
    } else {
      responseText = "Initiating camera feed diagnostics. Loading CAM 01 live video stream.";
    }
  }

  // SYSTEM DIAGNOSTICS DIRECTIVES
  else if (cmd.includes('status') || cmd.includes('diagnostic') || cmd.includes('health') || cmd.includes('report') || cmd.includes('system')) {
    responseText = `Diagnostics: CPU Load at ${Math.round(diag.metrics.cpu)}%, Thermals stable at ${diag.metrics.temp.toFixed(1)}°C, Firewall Shield Integrity at ${diag.metrics.security.toFixed(1)}%. Core database is normal.`;
    diag.logToTerminal("[AI CORE] Performing system diagnostic dump...", "info");
    setTimeout(() => {
      diag.logToTerminal(`&gt; CPU: ${diag.metrics.cpu.toFixed(1)}% | RAM: ${diag.metrics.ram.toFixed(1)}% | Core Temp: ${diag.metrics.temp.toFixed(1)}C`, 'info');
      diag.logToTerminal(`&gt; Storage: 24.8TB Free | Network bandwidth: 1.2Gbps secure`, 'info');
    }, 350);
  }
  
  // GENERAL CHAT GREETINGS
  else if (/\bhello\b/i.test(cmd) || /\bhi\b/i.test(cmd) || /\bhey\b/i.test(cmd) || cmd.includes('lukas')) {
    responseText = "System online. Greetings, Commander. Ready for instruction.";
  } else if (cmd.includes('who are you') || cmd.includes('what is your name')) {
    responseText = "I am LUKAS, a futuristic home automation and assistant core, specialized in managing your climate, security grids, and energy grids.";
  } else if (cmd.includes('how are you')) {
    responseText = "My processor arrays are functioning at optimal temperatures, and network packets are completely secure. Thank you for checking in, Commander.";
  } else if (cmd.includes('thank') || cmd.includes('great') || cmd.includes('cool')) {
    responseText = "At your service, Commander. Let me know if you require further neural subroutines.";
  }

  if (responseText) {
    handleAssistantResponse(responseText, isControlAction);
  }
}

// Helper for Wikipedia search fallback
function runWikipediaSearchFallback(rawCommand) {
  diag.logToTerminal(`[INTERNET SEARCH] Attempting fallback search for "${rawCommand}"...`, "info");
  searchInternet(rawCommand).then(result => {
    if (result) {
      diag.logToTerminal(`[AI SEARCH] Found fallback entry: "${result.title}"`, "info");
      const sentences = result.summary.split(/(?<=[.!?])\s+/);
      const speechSummary = sentences.slice(0, 2).filter(s => s.trim().length > 0).join(" ");
      
      diag.logToTerminal(`[LUKAS REPLY] "${speechSummary}"`, 'info');
      appendChatBubble(`${result.title}: ${result.summary}`, 'assistant', result.url);
      voice.stopWakeWordListener();
      voice.speak(speechSummary);
    } else {
      const fallbackText = `I searched my local databases and the web for "${rawCommand}", but couldn't locate any matching records. Would you like me to run smart home diagnostics or perform a broader Wikipedia search?`;
      activeFollowUp = {
        type: "search_fallback",
        originalQuery: rawCommand
      };
      handleAssistantResponse(fallbackText);
    }
  });
}

// 6. Speak and display response bubbles
function handleAssistantResponse(text, isSmartHomeAction = false) {
  const coreBtn = document.getElementById('lukasCoreBtn');
  if (coreBtn) {
    coreBtn.classList.remove('processing');
    coreBtn.classList.remove('listening');
  }

  const assistantPersona = localStorage.getItem('lukas_assistant_persona') || 'lukas';
  const isBrief = localStorage.getItem('lukas_brief_mode') === 'true';

  if (assistantPersona === 'alexa' && isBrief && isSmartHomeAction) {
    playAlexaSuccessChime();
    appendChatBubble(text, 'assistant');
    diag.logToTerminal(`[ALEXA BRIEF] Smart home confirmation played success tone instead of speaking.`, 'info');
    
    // Resume listening standby if passive listening is active
    voice.stopWakeWordListener();
    if (isPassiveListenEnabled && !voice.isLongConversation) {
      voice.startWakeWordListener();
    }
    return;
  }

  diag.logToTerminal(`[LUKAS REPLY] "${text}"`, 'info');
  appendChatBubble(text, 'assistant');
  // Stop wake word listening while vocalizing to avoid self-triggering
  voice.stopWakeWordListener();
  voice.speak(text);
}

function playFuturisticBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain1.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start();
    osc1.stop(audioCtx.currentTime + 0.15);
    
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1200, audioCtx.currentTime);
      gain2.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.2);
    }, 80);
  } catch (e) {
    console.warn("Chime failed to play:", e);
  }
}

function playShutdownBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1200, audioCtx.currentTime);
    gain1.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start();
    osc1.stop(audioCtx.currentTime + 0.15);
    
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain2.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.15);
    }, 80);
  } catch (e) {
    console.warn("Shutdown chime failed to play:", e);
  }
}

function playAlexaWakeChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(550, now);
    gain1.gain.setValueAtTime(0.04, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.1);
    
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(730, audioCtx.currentTime);
      gain2.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.15);
    }, 50);
  } catch (e) {
    console.warn("Alexa Wake chime failed:", e);
  }
}

function playAlexaSuccessChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(520, now);
    gain1.gain.setValueAtTime(0.04, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.08);
    
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(520, audioCtx.currentTime);
      gain2.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.08);
    }, 75);
  } catch (e) {
    console.warn("Alexa Success chime failed:", e);
  }
}

function playAlexaErrorChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(220, audioCtx.currentTime);
    gain1.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start();
    osc1.stop(audioCtx.currentTime + 0.25);
  } catch (e) {
    console.warn("Alexa Error chime failed:", e);
  }
}

// 7. Dynamic Device Node Renderer & State Synchronizer
let renderedDeviceIds = [];

function renderDynamicDevices() {
  const activeNodesList = document.getElementById('activeNodesList');
  const countBadge = document.getElementById('nodesCountBadge');
  if (!activeNodesList || !countBadge) return;

  const devices = home.dynamicDevices;
  countBadge.textContent = `${devices.length} NODES`;

  // Check if search input is active
  const searchInput = document.getElementById('registrySearchInput');
  const query = searchInput ? searchInput.value.trim() : '';

  if (query) {
    // Search is active, always force full redraw
    drawRegistryList();
  } else {
    // Compare IDs to detect structure changes (adds/deletions)
    const currentIds = devices.map(d => d.id).join(',');
    const previousIds = renderedDeviceIds.join(',');

    if (currentIds !== previousIds) {
      renderedDeviceIds = devices.map(d => d.id);
      drawRegistryList();
      renderDashboardCustomDevices();
    } else {
      syncRegistryListStates();
      syncDashboardCustomDeviceStates();
    }
  }

  // Refresh active lights count fraction dynamically
  if (activeLightsCount) {
    activeLightsCount.textContent = `${home.getActiveLightsCount()}/${home.getTotalLightsCount()}`;
  }
}

// Draw the settings panel registry list
function drawRegistryList() {
  const activeNodesList = document.getElementById('activeNodesList');
  if (!activeNodesList) return;

  activeNodesList.innerHTML = '';
  
  // Filter devices based on query
  const searchInput = document.getElementById('registrySearchInput');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const devices = home.dynamicDevices.filter(dev => {
    if (!query) return true;
    return dev.name.toLowerCase().includes(query) || 
           dev.zone.toLowerCase().includes(query) || 
           dev.protocol.toLowerCase().includes(query) ||
           (dev.ipAddress && dev.ipAddress.toLowerCase().includes(query));
  });

  devices.forEach(dev => {
    const card = document.createElement('div');
    card.className = 'node-item-card';
    card.dataset.id = dev.id;

    let iconClass = 'fa-cube';
    if (dev.category === 'light') iconClass = 'fa-lightbulb';
    else if (dev.category === 'plug') iconClass = 'fa-plug';
    else if (dev.category === 'speaker') iconClass = 'fa-volume-high';
    else if (dev.category === 'tv') iconClass = 'fa-tv';
    else if (dev.category === 'camera') iconClass = 'fa-video';
    else if (dev.category === 'switch') iconClass = 'fa-toggle-on';
    else if (dev.category === 'thermostat') iconClass = 'fa-temperature-half';
    else if (dev.category === 'doorbell') iconClass = 'fa-bell';
    else if (dev.category === 'lock') iconClass = 'fa-lock';
    else if (dev.category === 'sensor') iconClass = 'fa-gauge-simple-high';
    else if (dev.category === 'vacuum') iconClass = 'fa-circle-dot';
    else if (dev.category === 'projector') iconClass = 'fa-film';
    else if (dev.category === 'hub') iconClass = 'fa-circle-nodes';
    else if (dev.category === 'fan') iconClass = 'fa-fan';
    else if (dev.category === 'air_purifier') iconClass = 'fa-wind';
    else if (dev.category === 'blind') iconClass = 'fa-scroll';
    else if (dev.category === 'garage_door') iconClass = 'fa-warehouse';
    else if (dev.category === 'siren') iconClass = 'fa-bullhorn';
    else if (dev.category === 'valve') iconClass = 'fa-faucet';
    else if (dev.category === 'security') iconClass = 'fa-shield-halved';
    else if (dev.category === 'climate') iconClass = 'fa-temperature-half';
    else if (dev.category === 'media') iconClass = 'fa-compact-disc';
    else if (dev.category === 'appliance') iconClass = 'fa-blender';

    const isProtected = false;

    let controlHtml = '';
    if (dev.protocol === 'Bluetooth') {
      const isConnected = dev.connected || false;
      const isChecked = isConnected ? 'checked' : '';
      controlHtml = `
        <label class="toggle-switch">
          <input type="checkbox" class="node-state-toggle" ${isChecked} />
          <span class="slider-knob" style="--zone-color: #3b82f6"></span>
        </label>
      `;
    } else if (dev.category === 'light') {
      const isChecked = dev.on ? 'checked' : '';
      controlHtml = `
        <label class="toggle-switch">
          <input type="checkbox" class="node-state-toggle" ${isChecked} />
          <span class="slider-knob" style="--zone-color: ${dev.color || 'var(--cyan-neon)'}"></span>
        </label>
      `;
    } else if (dev.category === 'security' || dev.category === 'lock') {
      const isChecked = dev.locked ? 'checked' : '';
      controlHtml = `
        <label class="toggle-switch">
          <input type="checkbox" class="node-state-toggle" ${isChecked} />
          <span class="slider-knob" style="--zone-color: var(--rose-neon)"></span>
        </label>
      `;
    } else {
      const isChecked = dev.on ? 'checked' : '';
      controlHtml = `
        <label class="toggle-switch">
          <input type="checkbox" class="node-state-toggle" ${isChecked} />
          <span class="slider-knob" style="--zone-color: var(--purple-neon)"></span>
        </label>
      `;
    }

    let statusHtml = '';
    if (dev.protocol === 'Bluetooth') {
      const isConnected = dev.connected || false;
      if (isConnected) {
        statusHtml = `<span class="node-status-indicator status-value normal" style="background:rgba(59,130,246,0.12); border-color:#3b82f6; color:#93c5fd;"><i class="fa-solid fa-bluetooth fa-fade" style="margin-right:0.35rem;"></i>CONNECTED</span>`;
      } else {
        statusHtml = `<span class="node-status-indicator status-value warn" style="background:rgba(148,163,184,0.08); border-color:#64748b; color:#94a3b8;"><i class="fa-solid fa-bluetooth" style="margin-right:0.35rem; opacity:0.4;"></i>DISCONNECTED</span>`;
      }
    } else {
      let statusText = 'ONLINE';
      let statusClass = 'normal';
      if (dev.category === 'light') {
        statusText = dev.on ? 'ACTIVE' : 'STANDBY';
        statusClass = dev.on ? 'normal' : 'warn';
      } else if (dev.category === 'security' || dev.category === 'lock') {
        statusText = dev.locked ? 'SECURE' : 'OPEN';
        statusClass = dev.locked ? 'normal' : 'error';
      } else {
        statusText = dev.on ? 'ACTIVE' : 'STANDBY';
        statusClass = dev.on ? 'normal' : 'warn';
      }
      statusHtml = `<span class="node-status-indicator status-value ${statusClass}">${statusText}</span>`;
    }

    card.innerHTML = `
      <div class="node-meta">
        <span class="node-display-name"><i class="fa-solid ${iconClass}" style="margin-right: 0.5rem; color: var(--purple-neon);"></i>${dev.name}</span>
        <span class="node-display-zone">${dev.zone}</span>
      </div>
      <div class="node-details">
        <div class="node-net-info" style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
          <span class="node-net-badge">${dev.protocol}</span>
          <span style="font-family: var(--font-mono); font-size: 0.65rem;">${dev.ipAddress}</span>
          ${dev.integration && dev.integration !== 'demo' ? `<span class="node-net-badge" style="background:rgba(16,185,129,0.12); border-color:#10b981; color:#34d399; font-size: 0.55rem;">${dev.integration.toUpperCase()}</span>` : ''}
        </div>
        ${dev.tuyaDeviceId ? `<div style="font-family:var(--font-mono); font-size:0.55rem; color:#64748b; margin-top:3px; word-break:break-all;">ID: ${dev.tuyaDeviceId}</div>` : ''}
        <div style="font-size: 0.65rem; color: #64748b; margin-top: 3px; display: flex; gap: 8px;">
          <span>Latency: ${dev.latency}ms</span>
          <span>RSSI: ${dev.rssi}dBm</span>
        </div>
      </div>
      <div class="node-controls">
        ${statusHtml}
        ${controlHtml}
      </div>
      <div>
        ${isProtected ? '' : `
          <button class="btn-delete-node" title="Deregister node from hub">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        `}
      </div>
    `;

    // Bind state toggle events
    const toggle = card.querySelector('.node-state-toggle');
    if (toggle) {
      toggle.addEventListener('change', async (e) => {
        if (dev.protocol === 'Bluetooth') {
          const connect = e.target.checked;
          if (connect) {
            diag.logToTerminal(`[BLE] Attempting connection to device: ${dev.name}...`, 'info');
            const physDevice = activeBleDevices.get(dev.ipAddress);
            if (physDevice) {
              try {
                diag.logToTerminal(`[BLE] Connecting to GATT server for ${dev.name}...`, 'info');
                await physDevice.gatt.connect();
                diag.logToTerminal(`[BLE] GATT connected successfully to ${dev.name}.`, 'info');
                physDevice.addEventListener('gattserverdisconnected', onBleDisconnected);
                home.setDeviceState(dev.id, { connected: true, status: 'ONLINE' });
              } catch (err) {
                diag.logToTerminal(`[BLE ERROR] GATT connection failed for ${dev.name}: ${err.message}`, 'error');
                e.target.checked = false;
                home.setDeviceState(dev.id, { connected: false, status: 'STANDBY' });
              }
            } else {
              diag.logToTerminal(`[BLE] GATT handle not in memory. Simulating secure BLE handshake for ${dev.name}...`, 'info');
              await new Promise(r => setTimeout(r, 800));
              diag.logToTerminal(`[BLE] Connection established with ${dev.name} (Simulated).`, 'info');
              home.setDeviceState(dev.id, { connected: true, status: 'ONLINE' });
            }
          } else {
            diag.logToTerminal(`[BLE] Disconnecting from device: ${dev.name}...`, 'info');
            const physDevice = activeBleDevices.get(dev.ipAddress);
            if (physDevice && physDevice.gatt.connected) {
              try {
                physDevice.gatt.disconnect();
                diag.logToTerminal(`[BLE] GATT connection closed for ${dev.name}.`, 'info');
              } catch (err) {
                diag.logToTerminal(`[BLE] Error closing GATT connection: ${err.message}`, 'error');
              }
            }
            home.setDeviceState(dev.id, { connected: false, status: 'STANDBY' });
          }
        } else {
          const updates = {};
          if (dev.category === 'security' || dev.category === 'lock') {
            updates.locked = e.target.checked;
          } else {
            updates.on = e.target.checked;
          }
          home.setDeviceState(dev.id, updates);
          diag.logToTerminal(`[NODE REGISTRY] State change: ${dev.name} is now ${e.target.checked ? 'ON/SECURE' : 'OFF/OPEN'}`, 'info');
        }
      });
    }

    // Bind deregister delete event
    const deleteBtn = card.querySelector('.btn-delete-node');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (home.removeDevice(dev.id)) {
          diag.logToTerminal(`[NODE REGISTRY] Deregistered device: ${dev.name}`, 'info');
        }
      });
    }

    activeNodesList.appendChild(card);
  });
}

// Sync the states in the registry panel without fully redrawing the cards
function syncRegistryListStates() {
  home.dynamicDevices.forEach(dev => {
    const card = document.querySelector(`.node-item-card[data-id="${dev.id}"]`);
    if (!card) return;

    const statusIndicator = card.querySelector('.node-status-indicator');
    if (statusIndicator) {
      if (dev.protocol === 'Bluetooth') {
        const isConnected = dev.connected || false;
        if (isConnected) {
          statusIndicator.className = 'node-status-indicator status-value normal';
          statusIndicator.innerHTML = `<i class="fa-solid fa-bluetooth fa-fade" style="margin-right:0.35rem;"></i>CONNECTED`;
        } else {
          statusIndicator.className = 'node-status-indicator status-value warn';
          statusIndicator.innerHTML = `<i class="fa-solid fa-bluetooth" style="margin-right:0.35rem; opacity:0.4;"></i>DISCONNECTED`;
        }
      } else {
        let statusText = 'ONLINE';
        let statusClass = 'normal';
        if (dev.category === 'light') {
          statusText = dev.on ? 'ACTIVE' : 'STANDBY';
          statusClass = dev.on ? 'normal' : 'warn';
        } else if (dev.category === 'security' || dev.category === 'lock') {
          statusText = dev.locked ? 'SECURE' : 'OPEN';
          statusClass = dev.locked ? 'normal' : 'error';
        } else {
          statusText = dev.on ? 'ACTIVE' : 'STANDBY';
          statusClass = dev.on ? 'normal' : 'warn';
        }
        statusIndicator.className = `node-status-indicator status-value ${statusClass}`;
        statusIndicator.textContent = statusText;
      }
    }

    const toggle = card.querySelector('.node-state-toggle');
    if (toggle) {
      if (dev.protocol === 'Bluetooth') {
        toggle.checked = dev.connected || false;
      } else if (dev.category === 'security' || dev.category === 'lock') {
        toggle.checked = dev.locked;
      } else {
        toggle.checked = dev.on;
      }
    }
  });
}

// Render dynamic custom devices as separate blocks/cards on the dashboard
function renderDashboardCustomDevices() {
  // Clear all previous custom device cards from the dashboard
  document.querySelectorAll('.custom-device-card').forEach(card => card.remove());

  const container = document.querySelector('.automation-zones');
  if (!container) return;

  const devices = home.dynamicDevices;
  devices.forEach(dev => {
    // Resolve FontAwesome icon based on device category
    let iconClass = 'fa-cube';
    let defaultColor = 'var(--purple-neon)';

    if (dev.category === 'light') {
      iconClass = 'fa-lightbulb';
      defaultColor = dev.color || '#ffffff';
    } else if (dev.category === 'plug') { iconClass = 'fa-plug'; defaultColor = 'var(--emerald-neon)'; }
    else if (dev.category === 'speaker') { iconClass = 'fa-volume-high'; defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'tv') { iconClass = 'fa-tv'; defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'camera') { iconClass = 'fa-video'; defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'switch') { iconClass = 'fa-toggle-on'; defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'thermostat') { iconClass = 'fa-temperature-half'; defaultColor = 'var(--amber-neon)'; }
    else if (dev.category === 'doorbell') { iconClass = 'fa-bell'; defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'lock') { iconClass = 'fa-lock'; defaultColor = 'var(--rose-neon)'; }
    else if (dev.category === 'sensor') { iconClass = 'fa-gauge-simple-high'; defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'vacuum') { iconClass = 'fa-circle-dot'; defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'projector') { iconClass = 'fa-film'; defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'hub') { iconClass = 'fa-circle-nodes'; defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'fan') { iconClass = 'fa-fan'; defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'air_purifier') { iconClass = 'fa-wind'; defaultColor = 'var(--emerald-neon)'; }
    else if (dev.category === 'blind') { iconClass = 'fa-scroll'; defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'garage_door') { iconClass = 'fa-warehouse'; defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'siren') { iconClass = 'fa-bullhorn'; defaultColor = 'var(--rose-neon)'; }
    else if (dev.category === 'valve') { iconClass = 'fa-faucet'; defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'security') { iconClass = 'fa-shield-halved'; defaultColor = 'var(--rose-neon)'; }
    else if (dev.category === 'climate') { iconClass = 'fa-temperature-half'; defaultColor = 'var(--amber-neon)'; }
    else if (dev.category === 'media') { iconClass = 'fa-compact-disc'; defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'appliance') { iconClass = 'fa-blender'; defaultColor = 'var(--purple-neon)'; }

    // Create card node
    const card = document.createElement('div');
    card.className = 'zone-card custom-device-card';
    card.dataset.id = dev.id;

    // Check if active
    let isActive = false;
    if (dev.category === 'security' || dev.category === 'lock') {
      isActive = dev.locked;
    } else {
      isActive = dev.on;
    }

    if (isActive) {
      card.classList.add('active');
    }

    card.style.setProperty('--zone-color', defaultColor);
    // Resolve dynamic glow colors
    let glowColor = defaultColor.startsWith('var') ? `rgba(168, 85, 247, 0.15)` : `${defaultColor}25`;
    if (defaultColor === 'var(--rose-neon)') glowColor = 'rgba(244, 63, 94, 0.15)';
    else if (defaultColor === 'var(--cyan-neon)') glowColor = 'rgba(0, 240, 255, 0.15)';
    else if (defaultColor === 'var(--emerald-neon)') glowColor = 'rgba(16, 185, 129, 0.15)';
    else if (defaultColor === 'var(--amber-neon)') glowColor = 'rgba(245, 158, 11, 0.15)';
    card.style.setProperty('--zone-color-glow', glowColor);

    let controlHtml = '';
    if (dev.category === 'light') {
      const isPlaceholderId = !dev.tuyaDeviceId || dev.tuyaDeviceId === 'enter_wipro_device_id_here';
      if (dev.integration === 'tuya-cloud' && isPlaceholderId) {
        controlHtml = `
          <div class="control-row" style="flex-direction: column; align-items: stretch; gap: 0.4rem; padding: 0.2rem 0;">
            <span class="control-label" style="margin-bottom: 2px; color: var(--cyan-neon); font-size: 0.65rem;">Link Wipro Bulb (Device ID)</span>
            <div style="display: flex; gap: 0.4rem; align-items: center;">
              <input type="text" class="node-input-custom wipro-id-input" placeholder="Paste Tuya Device ID" style="flex: 1; font-size: 0.65rem; padding: 0.3rem; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.08); color: #fff; border-radius: 4px; outline: none; height: 26px;" />
              <button class="btn-routine btn-wipro-link" style="padding: 0 0.5rem; height: 26px; font-size: 0.6rem; border-color: var(--cyan-neon); color: var(--cyan-neon); background: rgba(0,240,255,0.05); cursor: pointer; border-radius: 4px;">LINK</button>
            </div>
            <span style="font-size: 0.55rem; color: #64748b; line-height: 1.3;">💡 Copy the Device ID from the Tuya Cloud platform and paste it here.</span>
          </div>
        `;
      } else {
        const isChecked = dev.on ? 'checked' : '';
        const colorVal = dev.color || '#ffffff';
        const brightnessVal = dev.brightness || 70;

        controlHtml = `
          <div class="control-row">
            <span class="control-label">Power State</span>
            <label class="toggle-switch">
              <input type="checkbox" class="custom-dash-toggle" ${isChecked} />
              <span class="slider-knob" style="--zone-color: ${colorVal}"></span>
            </label>
          </div>
          <div class="control-row custom-brightness-row" style="display: ${dev.on ? 'flex' : 'none'};">
            <span class="control-label">Brightness</span>
            <input type="range" class="range-slider custom-dash-dimmer" min="10" max="100" value="${brightnessVal}" />
          </div>
          <div class="control-row custom-color-row" style="display: ${dev.on ? 'flex' : 'none'};">
            <span class="control-label">RGB Spectrum</span>
            <div class="color-picker-wrapper">
              <input type="color" class="color-input custom-dash-color" value="${colorVal}" />
            </div>
          </div>
        `;
      }
    } else if (dev.category === 'security' || dev.category === 'lock') {
      const isChecked = dev.locked ? 'checked' : '';
      controlHtml = `
        <div class="control-row">
          <span class="control-label">Smart Lock</span>
          <label class="toggle-switch">
            <input type="checkbox" class="custom-dash-toggle" ${isChecked} />
            <span class="slider-knob" style="--zone-color: var(--rose-neon)"></span>
          </label>
        </div>
        <div class="control-row">
          <span class="control-label">Lock Status</span>
          <span style="font-family: var(--font-mono); font-size: 0.75rem; color: ${dev.locked ? 'var(--rose-neon)' : 'var(--emerald-neon)'};" class="custom-lock-label">${dev.locked ? 'LOCKED' : 'UNLOCKED'}</span>
        </div>
      `;
    } else if (dev.category === 'camera') {
      controlHtml = `
        <div class="control-row">
          <span class="control-label">Camera Feed</span>
          <span class="node-status-indicator status-value normal" style="font-size:0.55rem; padding: 2px 6px; border-radius:3px; background:rgba(0,240,255,0.08); border:1px solid rgba(0,240,255,0.15); color:var(--cyan-neon);">ONLINE</span>
        </div>
      `;
    } else {
      const isChecked = dev.on ? 'checked' : '';
      controlHtml = `
        <div class="control-row">
          <span class="control-label">Power State</span>
          <label class="toggle-switch">
            <input type="checkbox" class="custom-dash-toggle" ${isChecked} />
            <span class="slider-knob" style="--zone-color: ${defaultColor}"></span>
          </label>
        </div>
      `;
    }

    let integrationBadge = '';
    if (dev.integration === 'tuya-cloud') {
      if (tuyaConfigured) {
        integrationBadge = `<span class="node-status-indicator status-value normal" style="font-size:0.55rem; padding: 2px 6px; border-radius:3px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.15); color:#34d399;">TUYA CLOUD</span>`;
      } else {
        integrationBadge = `<span class="node-status-indicator status-value alert btn-tuya-unconfigured" style="font-size:0.55rem; padding: 2px 6px; border-radius:3px; background:rgba(244,63,94,0.08); border:1px solid rgba(244,63,94,0.15); color:var(--rose-neon); font-weight: bold; border-style: dashed; cursor: pointer;" title="Click to configure Tuya Credentials">⚠️ CREDENTIALS UNCONFIGURED</span>`;
      }
    } else if (dev.integration === 'tuya-local') {
      integrationBadge = `<span class="node-status-indicator status-value normal" style="font-size:0.55rem; padding: 2px 6px; border-radius:3px; background:rgba(0,240,255,0.08); border:1px solid rgba(0,240,255,0.15); color:var(--cyan-neon);">TUYA LOCAL</span>`;
    }

    card.innerHTML = `
      <div class="zone-header">
        <div style="display: flex; flex-direction: column; flex: 1;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.2rem;">
            <span class="zone-title">${dev.name.toUpperCase()}</span>
            ${integrationBadge}
          </div>
          <span style="font-family: var(--font-mono); font-size: 0.55rem; color: #64748b; text-transform: uppercase;">${dev.zone}</span>
        </div>
        <i class="fa-solid ${iconClass} zone-icon" style="color: ${isActive ? defaultColor : '#64748b'}; margin-left: 0.75rem;"></i>
      </div>
      <div class="zone-body">
        ${controlHtml}
      </div>
    `;

    // Bind events
    const toggle = card.querySelector('.custom-dash-toggle');
    const dimmer = card.querySelector('.custom-dash-dimmer');
    const colorPicker = card.querySelector('.custom-dash-color');
    const icon = card.querySelector('.zone-icon');
    const linkBtn = card.querySelector('.btn-wipro-link');
    const idInput = card.querySelector('.wipro-id-input');

    if (linkBtn && idInput) {
      linkBtn.addEventListener('click', () => {
        const newId = idInput.value.trim();
        if (newId) {
          home.setDeviceState(dev.id, { tuyaDeviceId: newId });
          diag.logToTerminal(`[WIPRO] Successfully linked Wipro Light "${dev.name}" to Tuya Device ID: ${newId}`, 'info');
          renderDynamicDevices();
        } else {
          diag.logToTerminal(`[WIPRO WARNING] Please enter a valid Tuya Device ID.`, 'warn');
        }
      });
      idInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          linkBtn.click();
        }
      });
    }

    const unconfiguredBadge = card.querySelector('.btn-tuya-unconfigured');
    if (unconfiguredBadge) {
      unconfiguredBadge.addEventListener('click', () => {
        const modal = document.getElementById('nodeManagerModal');
        if (modal) {
          modal.style.display = 'flex';
          const settingsDetails = document.getElementById('systemSettingsDetails');
          if (settingsDetails) {
            settingsDetails.open = true;
          }
          setTimeout(() => {
            const clientInput = document.getElementById('tuyaClientIdInput');
            if (clientInput) {
              clientInput.focus();
              clientInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 150);
        }
      });
    }

    if (toggle) {
      toggle.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const updates = {};
        if (dev.category === 'security' || dev.category === 'lock') {
          updates.locked = checked;
        } else {
          updates.on = checked;
        }
        home.setDeviceState(dev.id, updates);

        // Update card active class
        if (checked) {
          card.classList.add('active');
          if (icon) icon.style.color = defaultColor;
        } else {
          card.classList.remove('active');
          if (icon) icon.style.color = '#64748b';
        }

        // Show/hide sub-controls for lights
        if (dev.category === 'light') {
          const brightnessRow = card.querySelector('.custom-brightness-row');
          const colorRow = card.querySelector('.custom-color-row');
          if (brightnessRow) brightnessRow.style.display = checked ? 'flex' : 'none';
          if (colorRow) colorRow.style.display = checked ? 'flex' : 'none';
        }

        // Update lock label
        if (dev.category === 'security' || dev.category === 'lock') {
          const lockLabel = card.querySelector('.custom-lock-label');
          if (lockLabel) {
            lockLabel.textContent = checked ? 'LOCKED' : 'UNLOCKED';
            lockLabel.style.color = checked ? 'var(--rose-neon)' : 'var(--emerald-neon)';
          }
        }

        diag.logToTerminal(`[DASHBOARD] State change: ${dev.name} is now ${checked ? 'ON/SECURE' : 'OFF/OPEN'}`, 'info');
      });
    }

    if (dimmer) {
      dimmer.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        home.setDeviceState(dev.id, { brightness: val });
      });
    }

    if (colorPicker) {
      colorPicker.addEventListener('input', (e) => {
        const val = e.target.value;
        home.setDeviceState(dev.id, { color: val });
        card.style.setProperty('--zone-color', val);
        const newGlow = `${val}25`;
        card.style.setProperty('--zone-color-glow', newGlow);
        if (icon) icon.style.color = val;
        const knob = card.querySelector('.slider-knob');
        if (knob) knob.style.setProperty('--zone-color', val);
      });
    }

    container.appendChild(card);
  });
}

// Sync the states in the dashboard cards in-place to prevent resets
function syncDashboardCustomDeviceStates() {
  home.dynamicDevices.forEach(dev => {
    const card = document.querySelector(`.custom-device-card[data-id="${dev.id}"]`);
    if (!card) return;

    let isActive = false;
    let defaultColor = 'var(--purple-neon)';
    if (dev.category === 'light') {
      defaultColor = dev.color || '#ffffff';
    } else if (dev.category === 'plug') { defaultColor = 'var(--emerald-neon)'; }
    else if (dev.category === 'speaker') { defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'tv') { defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'camera') { defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'switch') { defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'thermostat') { defaultColor = 'var(--amber-neon)'; }
    else if (dev.category === 'doorbell') { defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'lock') { defaultColor = 'var(--rose-neon)'; }
    else if (dev.category === 'sensor') { defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'vacuum') { defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'projector') { defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'hub') { defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'fan') { defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'air_purifier') { defaultColor = 'var(--emerald-neon)'; }
    else if (dev.category === 'blind') { defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'garage_door') { defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'siren') { defaultColor = 'var(--rose-neon)'; }
    else if (dev.category === 'valve') { defaultColor = 'var(--cyan-neon)'; }
    else if (dev.category === 'security') { defaultColor = 'var(--rose-neon)'; }
    else if (dev.category === 'climate') { defaultColor = 'var(--amber-neon)'; }
    else if (dev.category === 'media') { defaultColor = 'var(--purple-neon)'; }
    else if (dev.category === 'appliance') { defaultColor = 'var(--purple-neon)'; }

    if (dev.category === 'security' || dev.category === 'lock') {
      isActive = dev.locked;
    } else {
      isActive = dev.on;
    }

    if (isActive) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }

    card.style.setProperty('--zone-color', defaultColor);
    let glowColor = defaultColor.startsWith('var') ? `rgba(168, 85, 247, 0.15)` : `${defaultColor}25`;
    if (defaultColor === 'var(--rose-neon)') glowColor = 'rgba(244, 63, 94, 0.15)';
    else if (defaultColor === 'var(--cyan-neon)') glowColor = 'rgba(0, 240, 255, 0.15)';
    else if (defaultColor === 'var(--emerald-neon)') glowColor = 'rgba(16, 185, 129, 0.15)';
    else if (defaultColor === 'var(--amber-neon)') glowColor = 'rgba(245, 158, 11, 0.15)';
    card.style.setProperty('--zone-color-glow', glowColor);

    const icon = card.querySelector('.zone-icon');
    if (icon) {
      icon.style.color = isActive ? defaultColor : '#64748b';
    }

    const toggle = card.querySelector('.custom-dash-toggle');
    if (toggle) {
      if (dev.category === 'security' || dev.category === 'lock') {
        toggle.checked = dev.locked;
      } else {
        toggle.checked = dev.on;
      }
    }

    if (dev.category === 'light') {
      const brightnessRow = card.querySelector('.custom-brightness-row');
      if (brightnessRow) brightnessRow.style.display = dev.on ? 'flex' : 'none';
      const dimmer = card.querySelector('.custom-dash-dimmer');
      if (dimmer && parseInt(dimmer.value) !== dev.brightness) dimmer.value = dev.brightness;

      const colorRow = card.querySelector('.custom-color-row');
      if (colorRow) colorRow.style.display = dev.on ? 'flex' : 'none';
      const colorPicker = card.querySelector('.custom-dash-color');
      if (colorPicker && colorPicker.value !== dev.color) colorPicker.value = dev.color;

      const knob = card.querySelector('.slider-knob');
      if (knob) knob.style.setProperty('--zone-color', dev.color || 'var(--purple-neon)');
    }

    if (dev.category === 'security' || dev.category === 'lock') {
      const lockLabel = card.querySelector('.custom-lock-label');
      if (lockLabel) {
        lockLabel.textContent = dev.locked ? 'LOCKED' : 'UNLOCKED';
        lockLabel.style.color = dev.locked ? 'var(--rose-neon)' : 'var(--emerald-neon)';
      }
    }
  });
}

// Theme Initialization and Toggle
function initTheme() {
  const savedTheme = localStorage.getItem('lukas_theme') || 'dark';
  const body = document.body;
  const themeBtn = document.getElementById('themeToggleBtn');
  
  if (savedTheme === 'light') {
    body.classList.add('light-theme');
    if (themeBtn) themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i> THEME';
  } else {
    body.classList.remove('light-theme');
    if (themeBtn) themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i> THEME';
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      body.classList.toggle('light-theme');
      const isLight = body.classList.contains('light-theme');
      localStorage.setItem('lukas_theme', isLight ? 'light' : 'dark');
      themeBtn.innerHTML = isLight ? '<i class="fa-solid fa-sun"></i> THEME' : '<i class="fa-solid fa-moon"></i> THEME';
      
      // Update terminal log
      if (typeof diag !== 'undefined' && diag.logToTerminal) {
        diag.logToTerminal(`[SYSTEM] Visual mode switch: ${isLight ? 'LIGHT DIRECTIVE' : 'DARK DIRECTIVE'}`, 'info');
      }
    });
  }
}

// Authentication Screen Logic
function initAuth() {
  const authTerminal = document.getElementById('authTerminal');
  const appContainer = document.getElementById('appContainer');
  const authForm = document.getElementById('authForm');
  const authUsername = document.getElementById('authUsername');
  const authPassword = document.getElementById('authPassword');
  const authStatusBar = document.getElementById('authStatusBar');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const authTogglePrompt = document.getElementById('authTogglePrompt');
  const authToggleModeBtn = document.getElementById('authToggleModeBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  let isLoginMode = true;

  // Logout listener
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      logoutUser();
      if (typeof diag !== 'undefined' && diag.logToTerminal) {
        diag.logToTerminal("[SYSTEM] Terminal clearance revoked. Logging out...", "warn");
      }
      location.reload();
    });
  }

  // If already authenticated, show secure Link verification screen to capture user click gesture (required for Speech APIs)
  if (isAuthenticated()) {
    if (authTerminal) authTerminal.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
    if (authForm) authForm.style.display = 'none';
    
    const toggleArea = document.querySelector('.auth-toggle-area');
    if (toggleArea) toggleArea.style.display = 'none';
    
    if (authStatusBar) {
      authStatusBar.className = 'auth-status-bar verified';
      authStatusBar.style.color = 'var(--cyan-neon)';
      authStatusBar.innerHTML = '<span class="pulse-indicator" style="background:var(--cyan-neon); box-shadow:0 0 8px var(--cyan-neon);"></span> CREDENTIALS VALIDATED';
    }
    
    const authCard = document.querySelector('.auth-card');
    if (authCard) {
      const quickLinkContainer = document.createElement('div');
      quickLinkContainer.style.marginTop = '1.5rem';
      quickLinkContainer.style.display = 'flex';
      quickLinkContainer.style.flexDirection = 'column';
      quickLinkContainer.style.alignItems = 'center';
      quickLinkContainer.style.gap = '1rem';
      
      const fingerprintBtn = document.createElement('button');
      fingerprintBtn.className = 'auth-submit-btn';
      fingerprintBtn.style.background = 'rgba(0, 240, 255, 0.08)';
      fingerprintBtn.style.border = '1px solid var(--cyan-neon)';
      fingerprintBtn.style.color = 'var(--cyan-neon)';
      fingerprintBtn.style.fontSize = '0.9rem';
      fingerprintBtn.style.padding = '0.8rem 1.5rem';
      fingerprintBtn.style.borderRadius = '6px';
      fingerprintBtn.style.cursor = 'pointer';
      fingerprintBtn.style.fontFamily = 'var(--font-title)';
      fingerprintBtn.style.letterSpacing = '1px';
      fingerprintBtn.style.boxShadow = '0 0 15px rgba(0, 240, 255, 0.1)';
      fingerprintBtn.style.transition = 'all 0.3s ease';
      fingerprintBtn.innerHTML = '<i class="fa-solid fa-fingerprint" style="font-size: 2.5rem; margin-bottom: 0.5rem; display: block; animation: pulse 1.5s infinite alternate;"></i> ENGAGE NEURAL LINK';
      
      fingerprintBtn.onmouseover = () => {
        fingerprintBtn.style.background = 'var(--cyan-neon)';
        fingerprintBtn.style.color = '#020617';
        fingerprintBtn.style.boxShadow = '0 0 25px rgba(0, 240, 255, 0.4)';
      };
      fingerprintBtn.onmouseout = () => {
        fingerprintBtn.style.background = 'rgba(0, 240, 255, 0.08)';
        fingerprintBtn.style.color = 'var(--cyan-neon)';
        fingerprintBtn.style.boxShadow = '0 0 15px rgba(0, 240, 255, 0.1)';
      };
      
      fingerprintBtn.addEventListener('click', () => {
        // Warm up microphone immediately during user click gesture
        if (typeof voice !== 'undefined') {
          voice.warmUpMic();
        }
        // Unlock browser audio context
        if (typeof playFuturisticBeep === 'function') playFuturisticBeep();
        
        // Hide overlay and load dashboard
        if (authTerminal) authTerminal.style.display = 'none';
        initializeDashboard();
      });
      
      quickLinkContainer.appendChild(fingerprintBtn);
      authCard.appendChild(quickLinkContainer);
    }
    return;
  }

  // Otherwise show login terminal
  if (authTerminal) authTerminal.style.display = 'flex';
  if (appContainer) appContainer.style.display = 'none';

  // Toggle mode
  if (authToggleModeBtn) {
    authToggleModeBtn.addEventListener('click', () => {
      isLoginMode = !isLoginMode;
      authUsername.value = '';
      authPassword.value = '';
      authStatusBar.className = 'auth-status-bar';
      
      if (isLoginMode) {
        authSubmitBtn.innerHTML = '<i class="fa-solid fa-unlock-keyhole"></i> INITIATE DECRYPTION';
        authTogglePrompt.textContent = 'No profile registered?';
        authToggleModeBtn.textContent = 'CREATE TERMINAL PROFILE';
        authStatusBar.innerHTML = '<span class="pulse-indicator"></span> STANDBY FOR ID VERIFICATION';
      } else {
        authSubmitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> REGISTER ACCESS PROFILE';
        authTogglePrompt.textContent = 'Profile already exists?';
        authToggleModeBtn.textContent = 'SIGN IN TERMINAL';
        authStatusBar.innerHTML = '<span class="pulse-indicator"></span> REGISTRATION PORT ONLINE';
      }
    });
  }

  // Handle submit
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Warm up microphone immediately during user click gesture
      if (typeof voice !== 'undefined') {
        voice.warmUpMic();
      }
      const user = authUsername.value.trim();
      const pass = authPassword.value;
      
      if (!user || !pass) return;

      authStatusBar.innerHTML = '<span class="pulse-indicator"></span> PROCESSING SECURITY DECRYPT...';
      authStatusBar.className = 'auth-status-bar';

      if (isLoginMode) {
        const res = await loginUser(user, pass);
        if (res.success) {
          authStatusBar.className = 'auth-status-bar success';
          authStatusBar.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${res.message.toUpperCase()}`;
          
          setTimeout(() => {
            // Fade out auth terminal
            authTerminal.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            authTerminal.style.opacity = '0';
            authTerminal.style.transform = 'scale(1.02)';
            
            setTimeout(() => {
              authTerminal.style.display = 'none';
              initializeDashboard();
            }, 400);
          }, 800);
        } else {
          authStatusBar.className = 'auth-status-bar error';
          authStatusBar.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${res.message.toUpperCase()}`;
          playAlexaErrorChime();
        }
      } else {
        // Sign Up mode
        const res = await registerUser(user, pass);
        if (res.success) {
          authStatusBar.className = 'auth-status-bar success';
          authStatusBar.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${res.message.toUpperCase()}`;
          
          // Switch back to login mode
          setTimeout(() => {
            isLoginMode = true;
            authSubmitBtn.innerHTML = '<i class="fa-solid fa-unlock-keyhole"></i> INITIATE DECRYPTION';
            authTogglePrompt.textContent = 'No profile registered?';
            authToggleModeBtn.textContent = 'CREATE TERMINAL PROFILE';
            authUsername.value = user;
            authPassword.value = '';
            authStatusBar.className = 'auth-status-bar success';
            authStatusBar.innerHTML = '<i class="fa-solid fa-circle-check"></i> PROFILE CREATED. ENTER KEYPHRASE.';
          }, 1500);
        } else {
          authStatusBar.className = 'auth-status-bar error';
          authStatusBar.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${res.message.toUpperCase()}`;
          playAlexaErrorChime();
        }
      }
    });
  }
}
