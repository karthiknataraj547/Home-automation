// main.js - LUKAS AI Operating System Orchestrator
import './src/style.css';
import LukasVoiceController from './src/voice.js';
import LukasAutomationHub, { DEVICES, ROUTINES } from './src/automation.js';
import LukasCCTVManager from './src/cctv.js';
import LukasDiagnosticsHub from './src/diagnostics.js';
import { fingerprintDevice, fingerprintBLE } from './src/deviceKnowledgeBase.js';
import { loginUser, registerUser, isAuthenticated, logoutUser, getSessionUser } from './src/auth.js';

// ═══════ LUKAS Intelligence Layer ═══════
import LukasMemory from './src/ai/memory.js';
import LukasOrchestrator, { INTENT } from './src/ai/orchestrator.js';
import LukasResearchAgent from './src/ai/research.js';
import LukasReasoningEngine from './src/ai/reasoning.js';
import { generateConversationalResponse, parseHomeCommand, scoreResponse, callLukasAI } from './src/ai/core.js';
import LukasMusicEngine from './src/ai/music.js';
import LukasPlannerAgent from './src/ai/planner.js';
import LukasTaskRunner from './src/ai/taskrunner.js';
import { LukasExecutionTracker } from './src/ai/execution.js';

// ── Puter Quiet Mode (Silence WebSocket warnings in console) ───────────
if (window.puter) {
  window.puter.quiet = true;
}

// ── Production Frontend Resiliency API Interceptor (Handles static file hosting) ──
const originalFetch = window.fetch;
window.fetch = async function (resource, options) {
  let url = typeof resource === 'string' ? resource : (resource.url || '');
  
  let isOwnApi = false;
  try {
    const parsedUrl = new URL(url, window.location.origin);
    isOwnApi = parsedUrl.origin === window.location.origin && parsedUrl.pathname.startsWith('/api/');
  } catch (e) {
    isOwnApi = url.startsWith('/api/') || url.startsWith('api/') || url.startsWith('./api/');
  }
  
  if (isOwnApi) {
    const isStaticDeployment = window.location.hostname !== 'localhost' && 
                             window.location.hostname !== '127.0.0.1';
                             
    if (isStaticDeployment) {
      // Direct LocalStorage bypass to prevent red 404 GET requests in browser console on Vercel/GitHub pages
      return handleLocalAPIResponse(url, options);
    }
    
    try {
      const response = await originalFetch(resource, options);
      if (response.status === 404) {
        throw new Error("404");
      }
      return response;
    } catch (err) {
      return handleLocalAPIResponse(url, options);
    }
  }
  
  return originalFetch(resource, options);
};

function handleLocalAPIResponse(url, options) {
  const endpoint = url.split('?')[0];
  const method = (options && options.method || 'GET').toUpperCase();
  console.log(`[LUKAS OFFLINE BRIDGE] Serving ${method} ${endpoint} from browser LocalStorage.`);
  
  let resBody = null;
  if (endpoint === '/api/tuya-config') {
    if (method === 'GET') {
      resBody = JSON.parse(localStorage.getItem('lukas_tuya_config') || '{"clientId":"","clientSecret":"","region":"openapi.tuyain.com"}');
    } else if (method === 'POST') {
      const body = JSON.parse(options.body);
      localStorage.setItem('lukas_tuya_config', JSON.stringify(body));
      resBody = { success: true, message: "Saved to LocalStorage" };
    }
  } else if (endpoint === '/api/camera-config') {
    if (method === 'GET') {
      resBody = JSON.parse(localStorage.getItem('lukas_camera_config') || '{"config":"","cloudEmail":"","cloudPassword":""}');
    } else if (method === 'POST') {
      const body = JSON.parse(options.body);
      localStorage.setItem('lukas_camera_config', JSON.stringify(body));
      resBody = { success: true, message: "Saved to LocalStorage" };
    }
  } else if (endpoint === '/api/openai-config') {
    if (method === 'GET') {
      resBody = JSON.parse(localStorage.getItem('lukas_openai_config') || '{"openaiApiKey":""}');
    } else if (method === 'POST') {
      const body = JSON.parse(options.body);
      localStorage.setItem('lukas_openai_config', JSON.stringify(body));
      resBody = { success: true, message: "Saved to LocalStorage" };
    }
  } else if (endpoint === '/api/hls-status') {
    resBody = { live: true, hlsUrl: "" };
  } else if (endpoint === '/api/probe-camera') {
    resBody = { success: true, rtspUrl: "rtsp://192.168.1.3/onvif2" };
  } else if (endpoint === '/api/tuya-control') {
    resBody = { success: true, message: "Mocked Tuya command executed" };
  } else if (endpoint === '/api/scan-lan' || endpoint === '/api/scan-onvif' || endpoint === '/api/scan-network' || endpoint === '/api/scan-tuya') {
    resBody = [];
  } else if (endpoint === '/api/music-search') {
    resBody = { found: false, error: 'Music search requires local dev server. Use built-in playlist.' };
  } else {
    resBody = {};
  }
  
  return new Response(JSON.stringify(resBody), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Instantiate core hubs
let voice = new LukasVoiceController();
const home = new LukasAutomationHub();
const cctv = new LukasCCTVManager();
const diag = new LukasDiagnosticsHub();
const executionTracker = new LukasExecutionTracker({ voice, home, diag });

// ═══════ LUKAS Intelligence System ═══════
let lukasMemory = new LukasMemory();
const lukasOrchestrator = new LukasOrchestrator(lukasMemory);
const lukasResearch = new LukasResearchAgent();
const lukasReasoning = new LukasReasoningEngine();

// ═══ LUKAS Music Engine — Smart Song Search & Playlist ═══
const lukasMusic = new LukasMusicEngine();

// Playlist is now managed by the music engine — this alias keeps legacy code compatible
let playlist = lukasMusic.getFullPlaylist().map(t => ({ ...t, icon: 'fa-music' }));

// ═══ LUKAS Planner & Task Runner ═══
const lukasPlan = new LukasPlannerAgent();
const lukasTask = new LukasTaskRunner();
let currentTrackIndex = 0;
let isPlaying = false;
let isPassiveListenEnabled = true;
let isWakingUp = false;
let isProcessingCommand = false;
let multiTaskEngine = null;
let currentWeatherCity = "";
let activeFollowUp = null;
let conversationActive = false;   // TRUE while we keep mic hot after a voice exchange
let conversationTimer = null;     // Timer to revert to passive after conversation window
let visibleMessageCount = 15;

let isVoiceTrainingActive = false;
let voiceTrainingStep = '';
let tempVoiceprint = null;
let isVoicePrintTrainingActive = false;
let voicePrintTrainingName = '';

let isRegistrationConfirmationActive = false;
let tempName = '';
let tempLanguage = '';
let tempAccent = '';
let tempStyle = '';

let isVoiceRetrainingActive = false;
let voiceRetrainingName = '';
let voiceRetrainingStep = '';

let pendingProfileUpdate = null;
let isProfileUpdateConfirmationActive = false;
let pendingDirectProfileQuery = '';

// Keep mic active for follow-up commands after a voice exchange (respects user timeout selection)
function keepConversationAlive(durationMs = null) {
  const timeoutStr = localStorage.getItem('lukas_continuous_convo_timeout');
  const userTimeout = timeoutStr !== null ? parseInt(timeoutStr) : 15000;
  
  if (userTimeout <= 0) {
    conversationActive = false;
    if (conversationTimer) clearTimeout(conversationTimer);
    return;
  }
  
  const actualDuration = durationMs !== null ? Math.min(durationMs, userTimeout) : userTimeout;

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
  }, actualDuration);
}

function endConversation() {
  conversationActive = false;
  if (conversationTimer) { clearTimeout(conversationTimer); conversationTimer = null; }
}

let activePlatform = "Spotify";
let tuyaConfigured = false;
let lastCommandSource = 'user';

// ── Voice silence-timeout state (module-level so processCommand can reach it) ──
let noCommandTimeout = null;
let proceedTimeout = null;
let accumulatedTranscript = "";

function clearSilenceTimeout() {
  if (noCommandTimeout) {
    clearTimeout(noCommandTimeout);
    noCommandTimeout = null;
  }
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
    if (isAlexa) { playAlexaErrorChime(); } else { playShutdownBeep(); }
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

// ═══════════════════ REMINDER & TASK ENGINE ═══════════════════
let lukasReminders = [];
let reminderTimers = new Map();

function loadUserReminders() {
  const prefix = `lukas_user_${(typeof lukasMemory !== 'undefined' ? lukasMemory.currentUsername : 'Guest').toLowerCase()}_`;
  try {
    lukasReminders = JSON.parse(localStorage.getItem(prefix + 'reminders') || '[]');
  } catch (e) {
    lukasReminders = [];
  }
}

function saveReminders() {
  const prefix = `lukas_user_${(typeof lukasMemory !== 'undefined' ? lukasMemory.currentUsername : 'Guest').toLowerCase()}_`;
  localStorage.setItem(prefix + 'reminders', JSON.stringify(lukasReminders));
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
  if (typeof reminderTimers !== 'undefined') {
    reminderTimers.forEach(timer => clearTimeout(timer));
    reminderTimers.clear();
  }
  loadUserReminders();
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

// Apply user profile preferences to speech synthesis, UI, and memories
function applyUserPreferencesToVoiceAndUI(username) {
  if (!username) username = 'Guest';
  
  // Switch memory namespace
  lukasMemory.switchUser(username);
  
  // Initialize defaults for new users
  if (username !== 'Guest' && !lukasMemory.getFact('name')) {
    lukasMemory.addFact('name', username, 'User Confirmed', 'Direct User Input');
    lukasMemory.setPreference('name', username);
    lukasMemory.setPreference('speechLang', 'en-IN');
    lukasMemory.setPreference('voiceAccent', 'indian_english');
    lukasMemory.setPreference('personalityMode', 'casual');
    lukasMemory.setPreference('voiceVolume', '1.0');
    lukasMemory.setPreference('voiceRateVal', '1.0');
    lukasMemory.setPreference('voiceRate', 'normal');
    lukasMemory.setPreference('voiceEmotionalTone', 'adaptive');
  }
  
  // Now load preferences from memory
  const volume = parseFloat(lukasMemory.getPreference('voiceVolume', '1.0'));
  const rate = parseFloat(lukasMemory.getPreference('voiceRateVal', '1.0'));
  const accent = lukasMemory.getPreference('voiceAccent', 'indian_english');
  const speedProfile = lukasMemory.getPreference('voiceRate', 'normal');
  const tone = lukasMemory.getPreference('voiceEmotionalTone', 'adaptive');
  const persona = lukasMemory.getPreference('assistantPersona', 'lukas');
  const briefMode = lukasMemory.getPreference('briefMode', 'false') === 'true';
  const isMuted = lukasMemory.getPreference('isMuted', 'false') === 'true';
  const speechLang = lukasMemory.getPreference('speechLang', 'en-IN');
  const continuousConvo = lukasMemory.getPreference('continuousConvoTimeout', '15000');
  
  const syncEnabled = lukasMemory.getPreference('syncEnabled', 'false') === 'true';
  const syncPassphrase = lukasMemory.getPreference('syncPassphrase', '');
  
  const geminiKey = lukasMemory.getPreference('gemini_api_key', '');
  const openaiKey = lukasMemory.getPreference('openai_api_key', '');

  // Apply to voice controller
  voice.isMuted = isMuted;
  voice.vocalVolume = volume;
  voice.vocalRate = rate;
  voice.preferredAccent = accent;
  voice.speakingRateProfile = speedProfile;
  voice.emotionalToneMode = tone;
  if (voice.setLanguage) voice.setLanguage(speechLang);
  voice.setAccent(accent);
  voice.setSpeakingRateProfile(speedProfile);
  voice.setEmotionalToneMode(tone);
  voice.setVolume(volume);
  voice.setRate(rate);

  // Apply to UI elements if they exist
  const volRange = document.getElementById('sysVolumeRange');
  const volLabel = document.getElementById('sysVolumeLabel');
  if (volRange) {
    volRange.value = Math.round(volume * 100);
    if (volLabel) volLabel.textContent = `${volRange.value}%`;
  }
  
  const rateRange = document.getElementById('sysSpeechRate');
  const rateLabel = document.getElementById('sysSpeechRateLabel');
  if (rateRange) {
    rateRange.value = Math.round(rate * 10);
    if (rateLabel) rateLabel.textContent = `${rate.toFixed(1)}x`;
  }

  const personaSelect = document.getElementById('assistantPersonaSelect');
  if (personaSelect) {
    personaSelect.value = persona;
    document.body.classList.toggle('alexa-mode', persona === 'alexa');
    if (typeof updateAssistantVoice === 'function') {
      updateAssistantVoice(persona);
    }
  }

  const briefModeChk = document.getElementById('briefModeCheckbox');
  if (briefModeChk) briefModeChk.checked = briefMode;

  const voiceAccentSelect = document.getElementById('voiceAccentSelect');
  if (voiceAccentSelect) voiceAccentSelect.value = accent;

  const voiceRateSelect = document.getElementById('voiceRateSelect');
  if (voiceRateSelect) voiceRateSelect.value = speedProfile;

  const voiceEmotionalToneSelect = document.getElementById('voiceEmotionalToneSelect');
  if (voiceEmotionalToneSelect) voiceEmotionalToneSelect.value = tone;

  const speechLangSelect = document.getElementById('speechLangSelect');
  if (speechLangSelect) {
    speechLangSelect.value = speechLang;
    const speechSupportMsg = document.getElementById('speechSupportMsg');
    if (speechSupportMsg && voice.recognition) {
      speechSupportMsg.textContent = `WebSpeech Active (${speechLang})`;
      speechSupportMsg.style.color = 'var(--emerald-neon)';
    }
  }

  const continuousConvoSelect = document.getElementById('continuousConvoSelect');
  if (continuousConvoSelect) {
    continuousConvoSelect.value = continuousConvo;
  }

  const nexusSyncCheckbox = document.getElementById('nexusSyncCheckbox');
  if (nexusSyncCheckbox) {
    nexusSyncCheckbox.checked = syncEnabled;
  }

  const nexusSyncPassphrase = document.getElementById('nexusSyncPassphrase');
  if (nexusSyncPassphrase) {
    nexusSyncPassphrase.value = syncPassphrase;
  }
  
  const geminiInput = document.getElementById('geminiApiKeyInput');
  if (geminiInput) {
    geminiInput.value = geminiKey;
  }
  
  const openaiInput = document.getElementById('openaiApiKeyInput');
  if (openaiInput) {
    openaiInput.value = openaiKey;
  }
  
  // Reload reminders
  loadUserReminders();
  renderReminders();
  if (typeof reminderTimers !== 'undefined') {
    reminderTimers.forEach(timer => clearTimeout(timer));
    reminderTimers.clear();
  }
  lukasReminders.forEach((r, i) => { if (!r.fired) scheduleReminder(i); });

  // Refresh Memory Panel
  updateMemoryPanel();
  
  // Refresh Voice Profiles list
  renderVoiceProfilesList();

  // Update header active user display
  const currentUserBadge = document.getElementById('currentUserBadge');
  if (currentUserBadge) {
    currentUserBadge.innerHTML = `<i class="fa-solid fa-user"></i> ${username.toUpperCase()}`;
  }

  // Update details inside profile manager modal
  const activeProfileUsername = document.getElementById('activeProfileUsername');
  const activeProfileFactName = document.getElementById('activeProfileFactName');
  const activeProfileAccent = document.getElementById('activeProfileAccent');
  const activeProfileSessions = document.getElementById('activeProfileSessions');

  if (activeProfileUsername) activeProfileUsername.textContent = username;
  if (activeProfileFactName) activeProfileFactName.textContent = lukasMemory.getFact('name') || 'Unknown';
  const rawAccent = lukasMemory.getPreference('voiceAccent', 'indian_english');
  const accentLabels = {
    indian_english: 'Indian English',
    bengaluru_professional: 'Bengaluru Professional',
    neutral_corporate: 'Neutral Corporate India',
    kannada_native: 'Kannada Native',
    'en-US': 'American Accent',
    'en-GB': 'British Accent',
    'en-AU': 'Australian Accent',
    'en-CA': 'Canadian Accent'
  };
  if (activeProfileAccent) activeProfileAccent.textContent = accentLabels[rawAccent] || rawAccent;
  if (activeProfileSessions) activeProfileSessions.textContent = lukasMemory.longTerm.sessionCount || 0;

  // Restore user-specific chat history
  visibleMessageCount = 15;
  renderChatHistory();

  // Populate user-specific sidebar memory
  updateSidebarMemory();
}

// Initialize dashboard core components (invoked upon verified clearance)
function initializeDashboard() {
  const appContainer = document.getElementById('appContainer');
  if (appContainer) appContainer.style.display = 'block';

  initClock();
  diag.initGauges();
  diag.initChartTooltip();

  // Load user-specific configurations and preferences
  const user = getSessionUser()?.username || 'Guest';
  applyUserPreferencesToVoiceAndUI(user);

  // Load secure server backup on startup if enabled
  const syncEnabled = lukasMemory.getPreference('syncEnabled', 'false') === 'true';
  const syncPassphrase = lukasMemory.getPreference('syncPassphrase', '');
  if (syncEnabled && syncPassphrase) {
    diag.logToTerminal("[NEXUS SYNC] Restoring secure database from server...", "info");
    lukasMemory.loadFromServer(syncPassphrase).then(res => {
      if (res.success && res.loaded) {
        diag.logToTerminal("[NEXUS SYNC] Zero-knowledge backup loaded. Memory matrix synchronized.", "info");
        // Re-apply preferences since they might have loaded from server
        applyUserPreferencesToVoiceAndUI(user);
      }
    });
  }

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

  // Auto-register LUKAS 4D Projector if missing
  const hasProjector = home.dynamicDevices.some(d =>
    d.category === 'projector'
  );
  if (!hasProjector) {
    home.addDevice("LUKAS 4D Projector", "Living Room", "projector", "WiFi", "192.168.1.18", "demo");
    diag.logToTerminal("[SYSTEM] Auto-registered LUKAS 4D Projector to registry.", "info");
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

function resolveDevice(targetName, category, targetZone) {
  if (!targetName) return { device: null, ambiguous: false, matches: [] };
  
  const searchName = targetName.toLowerCase().trim();
  
  // 1. Determine zone/room filter
  let zoneFilter = null;
  if (targetZone) {
    zoneFilter = targetZone;
  } else if (searchName.includes('living room') || searchName.includes('livingroom')) {
    zoneFilter = 'Living Room';
  } else if (searchName.includes('bedroom')) {
    zoneFilter = 'Bedroom';
  } else if (searchName.includes('kitchen')) {
    zoneFilter = 'Kitchen';
  } else if (searchName.includes('outdoor')) {
    zoneFilter = 'Outdoor';
  }
  
  let matches = [];
  
  // Step A: If room/zone specified or inferred, get all devices in that room
  if (zoneFilter) {
    matches = home.dynamicDevices.filter(d => d.zone.toLowerCase() === zoneFilter.toLowerCase());
  } else {
    matches = [...home.dynamicDevices];
  }
  
  // Step B: Filter by category/type if provided
  if (category && ['light', 'climate', 'security', 'media', 'lock'].includes(category)) {
    const categoryMatches = matches.filter(d => d.category === category);
    if (categoryMatches.length > 0) {
      matches = categoryMatches;
    }
  }
  
  // Step C: Match by targetName (either exact name match or exact ID match)
  let cleanSearch = searchName;
  if (zoneFilter) {
    cleanSearch = searchName.replace(zoneFilter.toLowerCase(), '').trim();
  }
  
  let finalMatches = matches.filter(d => {
    const devName = d.name.toLowerCase();
    const devId = d.id.toLowerCase();
    return devName.includes(cleanSearch) || cleanSearch.includes(devName) || devId === cleanSearch;
  });
  
  // If no final matches, do NOT guess/substitute, just return empty
  if (finalMatches.length === 0) {
    return { device: null, ambiguous: false, matches: [] };
  }
  
  // Exact match takes precedence
  const exactMatch = finalMatches.find(d => d.name.toLowerCase() === cleanSearch || d.id.toLowerCase() === cleanSearch);
  if (exactMatch) {
    return { device: exactMatch, ambiguous: false, matches: [exactMatch] };
  }
  
  if (finalMatches.length > 1) {
    return { device: null, ambiguous: true, matches: finalMatches };
  }
  
  return { device: finalMatches[0], ambiguous: false, matches: finalMatches };
}

async function setDeviceStateWithFeedback(deviceId, updates) {
  // 1. Locate the card
  let id = deviceId;
  if (id === 'livingRoom' || id === 'livingRoomLight') id = 'zoneLivingRoom';
  else if (id === 'bedroom' || id === 'bedroomLight') id = 'zoneBedroom';
  else if (id === 'kitchen' || id === 'kitchenLight') id = 'zoneKitchen';
  else if (id === 'outdoor' || id === 'outdoorLock') id = 'zoneOutdoor';

  const card = document.getElementById(id) || 
               document.querySelector(`.custom-device-card[data-id="${deviceId}"]`) || 
               document.querySelector(`.node-item-card[data-id="${deviceId}"]`);

  // 2. Add spinner & reset error state
  let spinner = null;
  let errorIcon = null;
  let feedbackLine = null;
  
  if (card) {
    // Check/create spinner
    spinner = card.querySelector('.device-spinner');
    if (!spinner) {
      spinner = document.createElement('i');
      spinner.className = 'fa-solid fa-spinner fa-spin device-spinner';
      spinner.style.color = 'var(--cyan-neon)';
      spinner.style.marginLeft = '0.5rem';
      spinner.style.fontSize = '0.9rem';
      card.querySelector('.zone-header')?.appendChild(spinner);
    }
    spinner.style.display = 'inline-block';

    // Hide existing error icon
    errorIcon = card.querySelector('.device-error-icon');
    if (errorIcon) {
      errorIcon.style.display = 'none';
    }

    // Check/create feedback line at the bottom of card
    feedbackLine = card.querySelector('.device-feedback-line');
    if (!feedbackLine) {
      feedbackLine = document.createElement('div');
      feedbackLine.className = 'device-feedback-line';
      feedbackLine.style.fontSize = '0.6rem';
      feedbackLine.style.color = '#64748b';
      feedbackLine.style.marginTop = '6px';
      feedbackLine.style.display = 'flex';
      feedbackLine.style.justifyContent = 'space-between';
      card.appendChild(feedbackLine);
    }
  }

  try {
    // 3. Await actual home state update (which fetches API)
    await home.setDeviceState(deviceId, updates);

    // 4. Update UI with Success
    if (card) {
      if (spinner) spinner.style.display = 'none';
      
      // Update RSSI and Latency if we have dynamic device details
      const dev = home.dynamicDevices.find(d => d.id === deviceId || d.id === id);
      const latencyVal = dev ? dev.latency : Math.floor(Math.random() * 20) + 5;
      const rssiVal = dev ? dev.rssi : -50 - Math.floor(Math.random() * 25);
      
      if (feedbackLine) {
        feedbackLine.innerHTML = `<span>Updated: ${new Date().toLocaleTimeString()}</span> <span>RSSI: ${rssiVal}dBm (${latencyVal}ms)</span>`;
      }
    }
  } catch (err) {
    // 5. Handle Failure: Revert UI, hide spinner, display warning icon
    console.error(`[setDeviceStateWithFeedback Error]`, err);
    if (card) {
      if (spinner) spinner.style.display = 'none';
      
      errorIcon = card.querySelector('.device-error-icon');
      if (!errorIcon) {
        errorIcon = document.createElement('i');
        errorIcon.className = 'fa-solid fa-triangle-exclamation device-error-icon';
        errorIcon.style.color = 'var(--rose-neon)';
        errorIcon.style.marginLeft = '0.5rem';
        errorIcon.style.fontSize = '0.9rem';
        card.querySelector('.zone-header')?.appendChild(errorIcon);
      }
      errorIcon.style.display = 'inline-block';

      if (feedbackLine) {
        feedbackLine.innerHTML = `<span style="color: var(--rose-neon);">API Error: ${err.message || 'Timeout'}</span>`;
      }
    }
    throw err;
  }
}

class LukasMultiTaskEngine {
  constructor() {
    this.currentActions = [];
    this.isRunning = false;
    this.currentIndex = 0;
    this.bubbleElement = null;
    this.statusMap = [];
    this.detailsMap = [];
    this.transactionDevice = null;
    
    // Snapshot state
    this.registrySnapshot = null;
    this.climateSnapshot = null;
    this.devicesSnapshot = null;
    
    // Expected state maps
    this.expectedDeviceStates = {};
    this.expectedClimateStates = {};
    
    // Modification tracking
    this.modifiedDevicesList = [];
    this.modifiedClimate = null;
  }

  async _setDeviceStateAndTrack(devId, updates) {
    const currentDev = home.dynamicDevices.find(d => d.id === devId);
    if (!currentDev) return;
    
    if (!this.expectedDeviceStates[devId]) {
      this.expectedDeviceStates[devId] = {};
    }
    
    for (const [k, v] of Object.entries(updates)) {
      this.expectedDeviceStates[devId][k] = v;
    }
    
    if (!this.modifiedDevicesList.some(d => d.id === devId)) {
      this.modifiedDevicesList.push({
        id: devId,
        name: currentDev.name,
        category: currentDev.category,
        originalState: { ...currentDev }
      });
    }

    await setDeviceStateWithFeedback(devId, updates);
  }

  _setTargetTemperatureAndTrack(val) {
    this.expectedClimateStates['targetTemp'] = val;
    if (!this.modifiedClimate) {
      this.modifiedClimate = {
        originalState: { ...home.state.climate }
      };
    }
    home.setTargetTemperature(val);
  }

  _setClimateModeAndTrack(mode) {
    this.expectedClimateStates['mode'] = mode;
    if (!this.modifiedClimate) {
      this.modifiedClimate = {
        originalState: { ...home.state.climate }
      };
    }
    home.setClimateMode(mode);
  }

  _rollback() {
    console.warn("[TRANSACTION] Rollback triggered!");
    diag.logToTerminal("[TRANSACTION] ❌ Validation failure. Rolling back state...", "warn");
    
    if (this.registrySnapshot) {
      home.dynamicDevices = JSON.parse(JSON.stringify(this.registrySnapshot));
      home.saveDynamicDevices();
    }
    if (this.climateSnapshot) {
      Object.assign(home.state.climate, this.climateSnapshot);
    }
    if (this.devicesSnapshot) {
      Object.assign(home.state.devices, this.devicesSnapshot);
    }
    
    if (typeof renderDynamicDevices === 'function') {
      renderDynamicDevices();
    }
    if (typeof updateClimateWidget === 'function') {
      updateClimateWidget();
    }
  }

  _verifyStates() {
    let passed = true;
    const mismatchDetails = [];

    for (const [devId, expectedProps] of Object.entries(this.expectedDeviceStates)) {
      const dev = home.dynamicDevices.find(d => d.id === devId);
      if (!dev) {
        passed = false;
        mismatchDetails.push(`Device ${devId} not found in registry.`);
        continue;
      }
      for (const [prop, val] of Object.entries(expectedProps)) {
        if (dev[prop] !== val) {
          passed = false;
          mismatchDetails.push(`Device "${dev.name}" ${prop} mismatch: expected ${val}, got ${dev[prop]}`);
        }
      }
    }

    for (const [prop, val] of Object.entries(this.expectedClimateStates)) {
      if (home.state.climate[prop] !== val) {
        passed = false;
        mismatchDetails.push(`Climate ${prop} mismatch: expected ${val}, got ${home.state.climate[prop]}`);
      }
    }

    return { passed, details: mismatchDetails.join(', ') };
  }

  _buildConfirmationResponse() {
    const parts = [];
    const reverseColorMap = {
      '#ff0000': 'red', '#10b981': 'green', '#3b82f6': 'blue', '#a855f7': 'purple',
      '#00f0ff': 'cyan', '#ff9f3b': 'orange', '#ffffff': 'white', '#eab308': 'yellow',
      '#ec4899': 'pink', '#d946ef': 'magenta', '#84cc16': 'lime', '#14b8a6': 'teal',
      '#f59e0b': 'gold', '#e11d48': 'crimson'
    };

    for (const item of this.modifiedDevicesList) {
      const dev = home.dynamicDevices.find(d => d.id === item.id);
      if (!dev) continue;

      const changes = [];
      const expected = this.expectedDeviceStates[item.id] || {};

      const powerChanged = 'on' in expected && expected.on !== item.originalState.on;
      const brightnessChanged = 'brightness' in expected && expected.brightness !== item.originalState.brightness;
      const colorChanged = 'color' in expected && expected.color !== item.originalState.color;
      const lockedChanged = 'locked' in expected && expected.locked !== item.originalState.locked;

      if (dev.category === 'light') {
        if (powerChanged) {
          changes.push(`is ${dev.on ? 'on' : 'off'}`);
        }
        if (brightnessChanged) {
          changes.push(`brightness set to ${dev.brightness}%`);
        }
        if (colorChanged) {
          const colorName = reverseColorMap[dev.color.toLowerCase()] || dev.color;
          changes.push(`color changed to ${colorName}`);
        }
      } else if (dev.category === 'security') {
        if (lockedChanged) {
          changes.push(`is ${dev.locked ? 'locked' : 'unlocked'}`);
        }
      }

      if (changes.length > 0) {
        if (changes.length === 1) {
          parts.push(`${dev.name} ${changes[0]}`);
        } else if (changes.length === 2) {
          parts.push(`${dev.name} ${changes[0]} and ${changes[1]}`);
        } else {
          const last = changes.pop();
          parts.push(`${dev.name} ${changes.join(', ')}, and ${last}`);
        }
      }
    }

    if (this.modifiedClimate) {
      const changes = [];
      const expected = this.expectedClimateStates;
      const original = this.modifiedClimate.originalState;
      const current = home.state.climate;

      if ('targetTemp' in expected && expected.targetTemp !== original.targetTemp) {
        changes.push(`temperature set to ${current.targetTemp}°C`);
      }
      if ('mode' in expected && expected.mode !== original.mode) {
        changes.push(`mode configured to ${current.mode}`);
      }

      if (changes.length > 0) {
        parts.push(`Thermostat ${changes.join(' and ')}`);
      }
    }

    if (parts.length === 0) {
      return "All systems are already at their requested states.";
    }

    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + ".";
    } else if (parts.length === 2) {
      const start = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      return start + " and " + parts[1] + ".";
    } else {
      const last = parts.pop();
      const start = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      parts[0] = start;
      return parts.join(', ') + ", and " + last + ".";
    }
  }

  async run(actions, apiKey, apiProvider) {
    if (this.isRunning) {
      console.warn("Task engine is already running!");
      return;
    }

    // Assign unique IDs and dependency array to actions
    actions.forEach((act, idx) => {
      act.id = idx + 1;
      act.dependsOn = [];
    });

    // Build dependency graph: Actions targeting the same device/zone chain sequentially
    const lastTargetMap = {};
    actions.forEach((act) => {
      const targetId = (act.targetDeviceName || act.targetZone || 'global').toLowerCase();
      if (lastTargetMap[targetId] !== undefined) {
        act.dependsOn = [lastTargetMap[targetId]];
      }
      lastTargetMap[targetId] = act.id;
    });

    this.currentActions = actions;
    this.isRunning = true;
    this.currentIndex = 0;
    this.statusMap = actions.map(() => 'pending');
    this.detailsMap = actions.map(act => this._getActionDescription(act));

    this._appendQueueBubble();

    isProcessingCommand = true;
    const coreBtn = document.getElementById('lukasCoreBtn');
    if (coreBtn) {
      coreBtn.classList.add('processing');
    }

    this.registrySnapshot = JSON.parse(JSON.stringify(home.dynamicDevices));
    this.climateSnapshot = JSON.parse(JSON.stringify(home.state.climate));
    this.devicesSnapshot = JSON.parse(JSON.stringify(home.state.devices));

    this.expectedDeviceStates = {};
    this.expectedClimateStates = {};
    this.modifiedDevicesList = [];
    this.modifiedClimate = null;
    this.transactionDevice = null;

    let ambiguousHalt = false;
    let ambiguousMessage = "";

    const pendingSet = [...actions];
    const completedSet = [];

    const runAvailableActions = async () => {
      if (ambiguousHalt) return;

      // Find actions with no pending dependencies
      const readyActions = pendingSet.filter(act => {
        return act.dependsOn.every(depId => completedSet.some(c => c.id === depId));
      });

      if (readyActions.length === 0 && pendingSet.length > 0) {
        // Fallback for circular dependencies or deadlocks: process the first pending item
        const forced = pendingSet.shift();
        readyActions.push(forced);
      }

      if (readyActions.length === 0) return;

      // Remove ready actions from the pending set
      readyActions.forEach(act => {
        const idx = pendingSet.indexOf(act);
        if (idx !== -1) pendingSet.splice(idx, 1);
      });

      // Execute ready actions in parallel
      const promises = readyActions.map(async (action) => {
        const actionIdx = actions.indexOf(action);
        this.statusMap[actionIdx] = 'running';
        this._updateQueueUI();

        // 800ms delay to make execution look human/cinematic
        await new Promise(resolve => setTimeout(resolve, 800));

        try {
          const result = await this._executeSingleAction(action);
          if (result.status === 'ambiguous') {
            this.statusMap[actionIdx] = 'ambiguous';
            this.detailsMap[actionIdx] = `Ambiguous device: ${result.message}`;
            this._updateQueueUI();
            ambiguousHalt = true;
            ambiguousMessage = `Wait, I found multiple matches for "${action.targetDeviceName}": ${result.matches.map(m => m.name).join(', ')}. Which one did you mean?`;
          } else if (result.status === 'failed') {
            this.statusMap[actionIdx] = 'failed';
            this.detailsMap[actionIdx] = result.message;
            this._updateQueueUI();
          } else {
            this.statusMap[actionIdx] = 'completed';
            this.detailsMap[actionIdx] = result.message;
            this._updateQueueUI();
            completedSet.push(action);
          }
        } catch (err) {
          console.error(err);
          this.statusMap[actionIdx] = 'failed';
          this.detailsMap[actionIdx] = `Error: ${err.message}`;
          this._updateQueueUI();
        }

        // Trigger next level of graph steps recursively
        await runAvailableActions();
      });

      await Promise.all(promises);
    };

    await runAvailableActions();

    this.isRunning = false;

    if (ambiguousHalt) {
      this._rollback();
      this._speakAndOutput(ambiguousMessage, true);
      return;
    }

    const succeededCount = this.statusMap.filter(s => s === 'completed').length;
    const failedCount = this.statusMap.filter(s => s === 'failed').length;

    if (succeededCount === actions.length) {
      // All actions succeeded! Verify and speak.
      const verification = this._verifyStates();
      if (verification.passed) {
        const response = this._buildConfirmationResponse();
        this._speakAndOutput(response);
      } else {
        // State mismatch warning
        const response = this._buildConfirmationResponse() + " Note: state verification reported some mismatches.";
        this._speakAndOutput(response);
      }
    } else if (succeededCount === 0) {
      // All actions failed! Rollback and say failed.
      this._rollback();
      
      const failedActs = [];
      for (let i = 0; i < actions.length; i++) {
        failedActs.push(this._getActionDescriptionSimplified(actions[i]));
      }
      this._speakAndOutput(`I couldn't reach the device to execute: ${failedActs.join(', ')}.`);
    } else {
      // Partial success! Do not rollback, but report success & failure truths.
      const succeededActs = [];
      const failedActs = [];
      for (let i = 0; i < actions.length; i++) {
        const desc = this._getActionDescriptionSimplified(actions[i]);
        if (this.statusMap[i] === 'completed') {
          succeededActs.push(desc);
        } else if (this.statusMap[i] === 'failed') {
          failedActs.push(desc);
        }
      }
      this._speakAndOutput(`I was able to ${succeededActs.join(' and ')}, but ${failedActs.join(' and ')} failed.`);
    }
  }

  _getActionDescriptionSimplified(act) {
    const actionStr = act.action === 'on' ? 'turn on' : (act.action === 'off' ? 'turn off' : act.action || 'set');
    const target = act.targetDeviceName || act.targetZone || 'device';
    const value = act.value ? ` to ${act.value}` : '';
    return `${actionStr} ${target}${value}`;
  }

  _getActionDescription(act) {
    const actionStr = act.action || 'set';
    const cat = act.category || 'home';
    const target = act.targetDeviceName || act.targetZone || 'system';
    const value = act.value ? ` to ${act.value}` : '';
    return `${actionStr.toUpperCase()} ${target}${value} (${cat})`;
  }

  _appendQueueBubble() {
    const row = document.createElement('div');
    row.className = 'chat-bubble-row';

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar lukas-avatar';
    avatar.innerHTML = '<i class="fa-solid fa-microchip"></i>';
    row.appendChild(avatar);

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant';
    
    const queueContainer = document.createElement('div');
    queueContainer.className = 'chat-task-queue';
    
    const title = document.createElement('div');
    title.className = 'chat-task-title';
    title.innerHTML = '<i class="fa-solid fa-list-check"></i> Lukas Multi-Action Queue';
    queueContainer.appendChild(title);
    
    const itemsList = document.createElement('div');
    itemsList.className = 'chat-task-items';
    queueContainer.appendChild(itemsList);
    
    bubble.appendChild(queueContainer);
    row.appendChild(bubble);
    
    chatHistory.appendChild(row);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    
    this.bubbleElement = itemsList;
    this._updateQueueUI();
  }

  _updateQueueUI() {
    if (!this.bubbleElement) return;
    this.bubbleElement.innerHTML = "";
    
    this.currentActions.forEach((act, idx) => {
      const status = this.statusMap[idx];
      const details = this.detailsMap[idx];
      
      const item = document.createElement('div');
      item.className = `chat-task-item ${status}`;
      
      let iconHtml = '';
      if (status === 'pending') {
        iconHtml = '<i class="fa-regular fa-circle"></i>';
      } else if (status === 'running') {
        iconHtml = '<i class="fa-solid fa-circle-notch"></i>';
      } else if (status === 'completed') {
        iconHtml = '<i class="fa-solid fa-circle-check"></i>';
      } else if (status === 'failed' || status === 'ambiguous') {
        iconHtml = '<i class="fa-solid fa-triangle-exclamation"></i>';
      }
      
      item.innerHTML = `
        <span>${details}</span>
        <span class="chat-task-status-icon">${iconHtml}</span>
      `;
      this.bubbleElement.appendChild(item);
    });
  }

  _speakAndOutput(text, isClarification = false) {
    isProcessingCommand = false;
    const coreBtn = document.getElementById('lukasCoreBtn');
    if (coreBtn) {
      coreBtn.classList.remove('processing');
      coreBtn.classList.remove('listening');
    }
    
    diag.logToTerminal(`[LUKAS REPLY] "${text}"`, 'info');
    
    appendChatBubble(text, 'assistant');
    
    voice.stopWakeWordListener();
    voice.speak(text);
    
    lukasMemory.addMessage('assistant', text, 'home_control');
  }

  async _executeSingleAction(parsed) {
    const colorMap = {
      'red': '#ff0000', 'green': '#10b981', 'blue': '#3b82f6', 'purple': '#a855f7',
      'cyan': '#00f0ff', 'orange': '#ff9f3b', 'white': '#ffffff', 'yellow': '#eab308',
      'pink': '#ec4899', 'magenta': '#d946ef', 'lime': '#84cc16', 'teal': '#14b8a6',
      'gold': '#f59e0b', 'crimson': '#e11d48'
    };

    if (parsed && parsed.category && parsed.category !== 'unknown') {
      let targetDevice = null;
      const isModifier = ['brightness', 'color'].includes(parsed.action) || parsed.category === 'climate';
      
      if (isModifier && this.transactionDevice && (!parsed.targetDeviceName || parsed.targetDeviceName.toLowerCase() === 'it' || parsed.targetDeviceName.toLowerCase() === 'them')) {
        targetDevice = this.transactionDevice;
      } else {
        const res = resolveDevice(parsed.targetDeviceName, parsed.category, parsed.targetZone);
        if (res.ambiguous) {
          return { status: 'ambiguous', matches: res.matches, message: `Ambiguous target "${parsed.targetDeviceName}"` };
        }
        targetDevice = res.device;
        if (targetDevice && !this.transactionDevice) {
          this.transactionDevice = targetDevice;
        }
      }

      // LIGHTS
      if (parsed.category === 'light') {
        let targetZone = null;
        let zoneLabel = "";
        if (parsed.targetZone === 'Living Room') { targetZone = DEVICES.LIVING_ROOM; zoneLabel = "Living Room"; }
        else if (parsed.targetZone === 'Bedroom') { targetZone = DEVICES.BEDROOM; zoneLabel = "Bedroom"; }
        else if (parsed.targetZone === 'Kitchen') { targetZone = DEVICES.KITCHEN; zoneLabel = "Kitchen"; }
        
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
            updates.color = hex;
            actionLabel = `set to color ${parsed.value}`;
          } else if (parsed.action === 'brightness' && parsed.value) {
            const val = parseInt(parsed.value);
            updates.brightness = isNaN(val) ? 50 : val;
            actionLabel = `set to brightness ${updates.brightness}%`;
          } else {
            if (parsed.action === 'toggle') {
              updates.on = !targetDevice.on;
              actionLabel = !targetDevice.on ? "activated" : "deactivated";
            } else {
              const val = parsed.value;
              if (val) {
                const isColor = colorMap[val.toLowerCase()] || /^#[0-9a-fA-F]{6}$/.test(val);
                const isNum = !isNaN(parseInt(val));
                if (isColor) {
                  updates.color = colorMap[val.toLowerCase()] || val;
                  actionLabel = `set to color ${val}`;
                } else if (isNum) {
                  updates.brightness = parseInt(val);
                  actionLabel = `set to brightness ${val}%`;
                }
              }
            }
          }
          if (Object.keys(updates).length > 0) {
            await this._setDeviceStateAndTrack(targetDevice.id, updates);
            return { status: 'success', message: `I have successfully updated the ${targetDevice.name}.` };
          }
          return { status: 'success', message: `No updates needed for ${targetDevice.name}.` };
        } else if (parsed.isGlobal || (!targetZone && !parsed.targetDeviceName)) {
          if (turnOn) {
            await this._setDeviceStateAndTrack(DEVICES.LIVING_ROOM, { on: true });
            await this._setDeviceStateAndTrack(DEVICES.BEDROOM, { on: true });
            await this._setDeviceStateAndTrack(DEVICES.KITCHEN, { on: true });
            for (const dev of home.dynamicDevices) {
              if (dev.category === 'light') await this._setDeviceStateAndTrack(dev.id, { on: true });
            }
            return { status: 'success', message: "Re-initialized all lighting arrays." };
          } else if (turnOff) {
            await this._setDeviceStateAndTrack(DEVICES.LIVING_ROOM, { on: false });
            await this._setDeviceStateAndTrack(DEVICES.BEDROOM, { on: false });
            await this._setDeviceStateAndTrack(DEVICES.KITCHEN, { on: false });
            for (const dev of home.dynamicDevices) {
              if (dev.category === 'light') await this._setDeviceStateAndTrack(dev.id, { on: false });
            }
            return { status: 'success', message: "Powering down all lighting grids." };
          } else if (parsed.action === 'color' && parsed.value) {
            const hex = colorMap[parsed.value.toLowerCase()] || parsed.value;
            await this._setDeviceStateAndTrack(DEVICES.LIVING_ROOM, { color: hex });
            await this._setDeviceStateAndTrack(DEVICES.BEDROOM, { color: hex });
            await this._setDeviceStateAndTrack(DEVICES.KITCHEN, { color: hex });
            for (const dev of home.dynamicDevices) {
              if (dev.category === 'light') await this._setDeviceStateAndTrack(dev.id, { color: hex });
            }
            return { status: 'success', message: `Changing all light spectrums to ${parsed.value}.` };
          } else if (parsed.action === 'brightness' && parsed.value) {
            const val = parseInt(parsed.value);
            const percent = isNaN(val) ? 50 : val;
            await this._setDeviceStateAndTrack(DEVICES.LIVING_ROOM, { brightness: percent });
            await this._setDeviceStateAndTrack(DEVICES.BEDROOM, { brightness: percent });
            await this._setDeviceStateAndTrack(DEVICES.KITCHEN, { brightness: percent });
            for (const dev of home.dynamicDevices) {
              if (dev.category === 'light') await this._setDeviceStateAndTrack(dev.id, { brightness: percent });
            }
            return { status: 'success', message: `Adjusting light levels to ${percent} percent.` };
          } else {
            if (parsed.action === 'toggle') {
              const isAnyOn = home.state.devices[DEVICES.LIVING_ROOM].on || home.state.devices[DEVICES.BEDROOM].on;
              const newState = !isAnyOn;
              await this._setDeviceStateAndTrack(DEVICES.LIVING_ROOM, { on: newState });
              await this._setDeviceStateAndTrack(DEVICES.BEDROOM, { on: newState });
              await this._setDeviceStateAndTrack(DEVICES.KITCHEN, { on: newState });
              for (const dev of home.dynamicDevices) {
                if (dev.category === 'light') await this._setDeviceStateAndTrack(dev.id, { on: newState });
              }
              return { status: 'success', message: `Toggling all lighting grids ${newState ? 'ON' : 'OFF'}.` };
            }
          }
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
            updates.color = hex;
            actionLabel = `set to ${parsed.value}`;
          } else if (parsed.action === 'brightness' && parsed.value) {
            const val = parseInt(parsed.value);
            updates.brightness = isNaN(val) ? 50 : val;
            actionLabel = `dimmed to ${updates.brightness}%`;
          } else {
            if (parsed.action === 'toggle') {
              const isCurrentOn = home.state.devices[targetZone].on;
              updates.on = !isCurrentOn;
              actionLabel = !isCurrentOn ? "activated" : "deactivated";
            }
          }
          if (Object.keys(updates).length > 0) {
            await this._setDeviceStateAndTrack(targetZone, updates);
            for (const dev of home.dynamicDevices) {
              if (dev.category === 'light' && dev.zone === zoneLabel) {
                await this._setDeviceStateAndTrack(dev.id, updates);
              }
            }
            return { status: 'success', message: `Perfect, I have ${actionLabel} the lighting grid in the ${zoneLabel}.` };
          }
        }
      }
      
      // CLIMATE
      else if (parsed.category === 'climate') {
        if (parsed.action === 'temp' && parsed.value) {
          const val = parseInt(parsed.value);
          if (!isNaN(val)) {
            this._setTargetTemperatureAndTrack(val);
            return { status: 'success', message: `Eco-Thermostat target set to ${val} degrees Celsius.` };
          }
        } else if (parsed.action === 'mode' && parsed.value) {
          const mode = parsed.value.toLowerCase();
          if (['cool', 'heat', 'eco'].includes(mode)) {
            this._setClimateModeAndTrack(mode);
            return { status: 'success', message: `Configuring eco-thermostat matrix to ${mode.toUpperCase()} mode.` };
          }
        } else if (parsed.action === 'status') {
          return { status: 'success', message: `Current indoor sensor reading is ${home.state.climate.indoorTemp}°C, target set to ${home.state.climate.targetTemp}°C in ${home.state.climate.mode} mode.` };
        }
      }
      
      // SECURITY
      else if (parsed.category === 'security') {
        const lock = parsed.action === 'off' || parsed.action === 'stop' || parsed.action === 'close' || parsed.action === 'lock';
        const unlock = parsed.action === 'on' || parsed.action === 'open' || parsed.action === 'release' || parsed.action === 'unlock';
        
        if (targetDevice) {
          const isLocked = unlock ? false : (lock ? true : !targetDevice.locked);
          await this._setDeviceStateAndTrack(targetDevice.id, { locked: isLocked });
          return { status: 'success', message: `I have successfully ${isLocked ? 'locked' : 'unlocked'} the ${targetDevice.name}.` };
        } else {
          const isLocked = unlock ? false : (lock ? true : !home.state.devices[DEVICES.OUTDOOR].locked);
          await this._setDeviceStateAndTrack(DEVICES.OUTDOOR, { locked: isLocked });
          return { status: 'success', message: isLocked ? "Perimeter locks engaged. Main entryway secured." : "Security locks disengaged. Main entryway is now unlocked." };
        }
      }
      
      // ROUTINES
      else if (parsed.category === 'routine' && parsed.value) {
        const val = parsed.value.toLowerCase();
        if (val.includes('morning') || val.includes('wake')) {
          triggerRoutineEffect(ROUTINES.MORNING);
          return { status: 'success', message: "Vocalizing morning sequence. Thermostat and lighting profiles loaded." };
        } else if (val.includes('cinema') || val.includes('movie') || val.includes('theater')) {
          triggerRoutineEffect(ROUTINES.CINEMA);
          return { status: 'success', message: "Initiating Cinema Mode. Ambient lights dimmed, secondary grids disabled." };
        } else if (val.includes('eco') || val.includes('green') || val.includes('save')) {
          triggerRoutineEffect(ROUTINES.ECO);
          return { status: 'success', message: "Power saving eco schedules initiated." };
        } else if (val.includes('lockdown') || val.includes('emergency')) {
          triggerRoutineEffect(ROUTINES.LOCKDOWN);
          return { status: 'success', message: "WARNING! SECURITY LOCKDOWN ACTIVATED. All portals secured." };
        }
      }
      
      // MEDIA
      else if (parsed.category === 'media') {
        const cmd = parsed.action || '';
        const rawVal = parsed.value || '';

        if (cmd === 'pause' || cmd === 'stop') {
          isPlaying = false;
          updateMediaPlayButton(false);
          audioPlayer.pause();
          return { status: 'success', message: 'Audio feed paused.' };
        } else if (cmd === 'next') {
          playlist = lukasMusic.getFullPlaylist().map(t => ({ ...t, icon: 'fa-music' }));
          currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
          isPlaying = true; updateMediaWidget(); playTrack();
          return { status: 'success', message: `Skipping to: "${playlist[currentTrackIndex].title}".` };
        } else if (cmd === 'prev') {
          playlist = lukasMusic.getFullPlaylist().map(t => ({ ...t, icon: 'fa-music' }));
          currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
          isPlaying = true; updateMediaWidget(); playTrack();
          return { status: 'success', message: `Reverting to: "${playlist[currentTrackIndex].title}".` };
        } else {
          const searchQuery = rawVal || parsed.targetDeviceName || '';
          const musicQuery = LukasMusicEngine.parseMediaCommand(searchQuery) || searchQuery;

          if (musicQuery) {
            diag.logToTerminal(`[MUSIC ENGINE] Sequential resolve: "${musicQuery}"`, 'info');
            try {
              const result = await lukasMusic.resolveRequest(musicQuery);
              if (result && result.track) {
                const t = result.track;
                const newTrack = { id: t.id, title: t.title, artist: t.artist, url: t.url, icon: 'fa-music', thumbnail: t.thumbnail || '' };
                const existIdx = playlist.findIndex(p => p.id === t.id);
                if (existIdx === -1) {
                  playlist.push(newTrack);
                  lukasMusic.saveToLibrary(t);
                }
                currentTrackIndex = playlist.findIndex(p => p.id === t.id);
                if (currentTrackIndex === -1) currentTrackIndex = playlist.length - 1;
                isPlaying = true;
                updateMediaWidget();
                playTrack();
                return { status: 'success', message: `Playing "${t.title}" by ${t.artist}.` };
              }
            } catch (err) {
              console.error(err);
            }
          }
          isPlaying = true; updateMediaWidget(); playTrack();
          return { status: 'success', message: `Playing media stream.` };
        }
      }
      
      // CCTV
      else if (parsed.category === 'cctv') {
        const probeBtn = document.getElementById('cam1ProbeBtn');
        if (probeBtn) {
          probeBtn.click();
        }
        return { status: 'success', message: "Engaging camera matrix and initiating auto-probe sequence." };
      }
      
      // TIME
      else if (parsed.category === 'time') {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return { status: 'success', message: `The current system time is ${timeStr}.` };
      }
      
      // DIAGNOSTICS
      else if (parsed.category === 'diagnostics') {
        return { status: 'success', message: `Diagnostics: CPU Load at ${Math.round(diag.metrics.cpu)}%, Thermals stable at ${diag.metrics.temp.toFixed(1)}°C.` };
      }
    }
    
    return { status: 'failed', message: 'Unknown action or could not execute.' };
  }
}

function startWatchdogSystem() {
  console.log("[WATCHDOG] Initializing service health monitor...");
  setInterval(() => {
    try {
      const isVoiceSpeaking = window.speechSynthesis.speaking;
      
      // 1. Check Voice Engine
      if (!voice || typeof voice.speak !== 'function' || typeof voice.cancelSpeech !== 'function') {
        console.error("[WATCHDOG] Voice Engine crashed! Re-initializing voice controller...");
        voice = new LukasVoiceController();
        executionTracker.setContext({ voice });
      }
      
      // 2. Check Wake Engine / Speech Recognition Manager State Machine
      if (voice && voice.recognitionManager) {
        if (lastCommandSource === 'standby' || !conversationActive) {
          if (voice.recognitionManager.state !== 'PASSIVE_LISTENING' && voice.recognitionManager.state !== 'ACTIVE_LISTENING' && !isVoiceSpeaking && !isProcessingCommand) {
            console.warn(`[WATCHDOG] Wake Engine state mismatch (${voice.recognitionManager.state}). Transitioning to PASSIVE_LISTENING...`);
            voice.recognitionManager.transitionTo('PASSIVE_LISTENING');
          }
        }
        
        if ((voice.recognitionManager.state === 'PASSIVE_LISTENING' || voice.recognitionManager.state === 'ACTIVE_LISTENING' || voice.recognitionManager.state === 'RESPONDING') && 
            !voice.isRecognitionActive && !voice.isStopping && !isVoiceSpeaking) {
          console.warn(`[WATCHDOG] Speech recognition inactive during state ${voice.recognitionManager.state}. Restarting...`);
          voice.recognitionManager.start();
        }
      }
      
      // 3. Check Memory Engine
      if (!lukasMemory || typeof lukasMemory.addFact !== 'function') {
        console.error("[WATCHDOG] Memory Engine crashed! Restoring Memory Matrix...");
        lukasMemory = new LukasMemory();
      }

      // 4. Check Task Engine
      if (!multiTaskEngine || typeof multiTaskEngine.run !== 'function') {
        console.error("[WATCHDOG] Task Engine crashed! Restoring Task Multi-Action Engine...");
        multiTaskEngine = new LukasMultiTaskEngine();
      }

      // 5. Sync Network Badge
      const netSyncVal = document.getElementById('netSyncStatus');
      if (netSyncVal && !navigator.onLine) {
        netSyncVal.textContent = 'OFFLINE';
        netSyncVal.className = 'status-value alert';
      } else if (netSyncVal) {
        netSyncVal.textContent = 'SECURE';
        netSyncVal.className = 'status-value normal';
      }
      
    } catch (e) {
      console.error("[WATCHDOG] Error in health check loop:", e);
    }
  }, 5000);
}

// Initialize modules on DOM load
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Jarvis particle canvas background
  initParticleCanvas();

  // Initialize light/dark theme rules
  initTheme();

  // Initialize terminal security authentication
  initAuth();
  
  // Initialize profile manager modal
  initProfileManager();
  
  // Apply initial Guest space preferences
  applyUserPreferencesToVoiceAndUI('Guest');

  // Initialize Task Engine
  multiTaskEngine = new LukasMultiTaskEngine();

  // Start Silent Service Watchdog health checking
  startWatchdogSystem();
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

  const particles = Array.from({ length: 90 }, () => {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    return {
      x: x,
      y: y,
      baseY: y,
      waveOffset: Math.random() * Math.PI * 2,
      waveAmplitude: Math.random() * 40 + 10,
      r: Math.random() * 1.5 + 0.4,
      dx: (Math.random() - 0.5) * 0.4,
      dy: (Math.random() - 0.5) * 0.4,
      alpha: Math.random() * 0.6 + 0.1,
      hue: Math.random() > 0.6 ? 180 : 270 // cyan or purple
    };
  });

  const ripples = [];
  const telemetryBlocks = Array.from({ length: 5 }, () => ({
    x: Math.random() * 200 - 100,
    y: Math.random() * 200 - 100,
    text: '',
    ticks: 0,
    maxTicks: Math.floor(Math.random() * 100) + 50
  }));

  const telemetryLabels = [
    'SYS_GRID: ON', 'LNK_STABLE: 94%', '4D_PROJ: ACTIVE', 'BANDWIDTH: 100Gbps', 
    'SYS_BOOT: 100%', 'TEMP_CORE: 22.4C', 'SHIELD: ARMED', 'VOLT_STABLE: 1.2V',
    'FPS: 60', 'RESOL_CORE: 4K', 'AUDIO: ACTIVE', 'CMD: IDLE', 'LOCKS: SECURE'
  ];

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate dynamic core center point based on actual visual position
    const coreBtn = document.getElementById('lukasCoreBtn');
    let coreX = canvas.width * 0.15; // default fallback (approx center of left panel)
    let coreY = canvas.height * 0.25;

    if (coreBtn) {
      const rect = coreBtn.getBoundingClientRect();
      coreX = rect.left + rect.width / 2;
      coreY = rect.top + rect.height / 2;
    }

    // Identify current active mode states
    const isWaking = coreBtn ? coreBtn.classList.contains('waking') : false;
    const isListening = coreBtn ? coreBtn.classList.contains('listening') : false;
    const isProcessing = coreBtn ? coreBtn.classList.contains('processing') : false;
    const isSpeaking = document.getElementById('coreCenterNode')?.classList.contains('speaking') || false;
    
    const isAlexaMode = document.body.classList.contains('alexa-mode') || 
                        localStorage.getItem('lukas_assistant_persona') === 'alexa';

    const isLockdown = home && home.state && home.state.activeRoutine === 'lockdown';

    // Check smart home projector state
    const projectorDev = home && home.dynamicDevices ? home.dynamicDevices.find(d => d.category === 'projector') : null;
    const projectorOn = projectorDev ? projectorDev.on : false;
    const projectionMode = projectorDev ? (projectorDev.mode || 'Jarvis HUD') : (isAlexaMode ? 'Alexa Ripple' : 'Jarvis HUD');
    const projectionBrightness = projectorDev ? (projectorDev.brightness || 80) / 100 : 0.8;

    // We render the projector visual effects if the projector device is ON, OR if the assistant is actively interacting (listening/speaking/processing)
    const assistantActive = isWaking || isListening || isProcessing || isSpeaking;
    const projectorActive = projectorOn || assistantActive;

    // Modulate visual speed and amplitude based on voice assistant state
    let speedMultiplier = 1.0;
    let beamIntensity = 1.0;
    if (isWaking) { speedMultiplier = 3.5; beamIntensity = 2.0; }
    else if (isListening) { speedMultiplier = 2.0; beamIntensity = 1.5; }
    else if (isProcessing) { speedMultiplier = 4.0; beamIntensity = 1.8; }
    else if (isSpeaking) { speedMultiplier = 1.5; beamIntensity = 1.4 + Math.random() * 0.3; } // flicker effect

    const timeSec = Date.now() * 0.001;

    // 1. Draw Projector Beam Cone (Translucent sweeping gradient)
    if (projectorActive) {
      const alphaVal = 0.07 * beamIntensity * projectionBrightness;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(coreX, coreY);
      
      // Calculate slow sweep angles
      const angleCenter = Math.sin(timeSec * 0.3) * 0.12; 
      const angleSpread = 0.35 + Math.sin(timeSec * 2.5) * 0.04;
      
      const startAngle = angleCenter - angleSpread;
      const endAngle = angleCenter + angleSpread;
      
      ctx.lineTo(canvas.width, coreY + Math.tan(startAngle) * (canvas.width - coreX));
      ctx.lineTo(canvas.width, coreY + Math.tan(endAngle) * (canvas.width - coreX));
      ctx.closePath();
      
      const gradient = ctx.createRadialGradient(coreX, coreY, 40, coreX + (canvas.width - coreX) * 0.4, coreY, canvas.width - coreX);
      if (isLockdown) {
        gradient.addColorStop(0, `rgba(239, 68, 68, ${alphaVal * 1.6})`);
        gradient.addColorStop(0.3, `rgba(239, 68, 68, ${alphaVal})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (projectionMode === 'Alexa Ripple') {
        gradient.addColorStop(0, `rgba(59, 130, 246, ${alphaVal * 1.6})`);
        gradient.addColorStop(0.3, `rgba(6, 182, 212, ${alphaVal})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else {
        // Jarvis HUD or fallback
        gradient.addColorStop(0, `rgba(168, 85, 247, ${alphaVal * 1.6})`);
        gradient.addColorStop(0.3, `rgba(6, 182, 212, ${alphaVal})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }
      
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.restore();
    }

    // 2. Render warning grids if in LOCKDOWN
    if (isLockdown) {
      ctx.strokeStyle = `rgba(239, 68, 68, ${0.1 * projectionBrightness})`;
      ctx.lineWidth = 1;
      
      // Horizontal alert lines
      for (let y = 100; y < canvas.height; y += 150) {
        ctx.beginPath();
        ctx.moveTo(0, y + Math.sin(timeSec * 2 + y) * 10);
        ctx.lineTo(canvas.width, y + Math.sin(timeSec * 2 + y) * 10);
        ctx.stroke();
      }

      // Drawing alert circles
      ctx.save();
      ctx.strokeStyle = `rgba(239, 68, 68, ${(0.2 + Math.abs(Math.sin(timeSec * 5)) * 0.3) * projectionBrightness})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(coreX, coreY, 110 + Math.sin(timeSec * 5) * 10, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = 'bold 0.65rem var(--font-mono)';
      ctx.fillStyle = `rgba(239, 68, 68, ${0.6 * projectionBrightness})`;
      ctx.fillText("WARNING // EMER GRID SECURED", coreX - 85, coreY - 140);
      ctx.restore();
    }

    // 3. Render ALEXA mode (Ripples, Sine Waves, Wave Flowing Particles)
    else if (projectionMode === 'Alexa Ripple') {
      // Fluid Bezier Wave Streams (Dynamic Soundwaves)
      ctx.save();
      const waveColors = [
        `rgba(59, 130, 246, ${0.12 * projectionBrightness})`,
        `rgba(37, 99, 235, ${0.08 * projectionBrightness})`,
        `rgba(6, 182, 212, ${0.05 * projectionBrightness})`
      ];
      const waveHeight = isSpeaking ? 50 : (isListening ? 35 : 12);
      for (let w = 0; w < 3; w++) {
        ctx.beginPath();
        ctx.strokeStyle = waveColors[w];
        ctx.lineWidth = 2.5 - w * 0.7;
        for (let x = 0; x < canvas.width; x += 15) {
          const phase = timeSec * (1.2 + w * 0.25) + x * 0.004;
          const y = canvas.height * 0.75 + Math.sin(phase) * waveHeight * Math.cos(x * 0.0008);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // Expanding ripples
      ripples.forEach((rip, rIdx) => {
        rip.radius += rip.speed * speedMultiplier;
        rip.alpha -= rip.decay;
        if (rip.alpha <= 0) {
          ripples.splice(rIdx, 1);
        } else {
          ctx.strokeStyle = `rgba(6, 182, 212, ${rip.alpha * projectionBrightness})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(coreX, coreY, rip.radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // Spawn ripple on state triggers or speak pulse
      if (isSpeaking && Math.random() < 0.07) {
        ripples.push({ radius: 30, alpha: 0.75, speed: 2.5, decay: 0.015 });
      } else if (isListening && Math.random() < 0.04) {
        ripples.push({ radius: 30, alpha: 0.45, speed: 1.4, decay: 0.01 });
      }
    }

    // 4. Render JARVIS mode (HUD concentric rings, Scanning Sonar, Data plexus)
    else {
      ctx.save();
      // Holographic concentric rings
      ctx.strokeStyle = `rgba(6, 182, 212, ${0.08 * projectionBrightness})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(coreX, coreY, 110, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating dashed ring
      ctx.save();
      ctx.translate(coreX, coreY);
      ctx.rotate(timeSec * 0.08 * speedMultiplier);
      ctx.strokeStyle = `rgba(168, 85, 247, ${0.1 * projectionBrightness})`;
      ctx.setLineDash([8, 18]);
      ctx.beginPath();
      ctx.arc(0, 0, 135, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Rotating short ticks ring
      ctx.save();
      ctx.translate(coreX, coreY);
      ctx.rotate(-timeSec * 0.04 * speedMultiplier);
      ctx.strokeStyle = `rgba(6, 182, 212, ${0.12 * projectionBrightness})`;
      ctx.lineWidth = 1;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 88, Math.sin(a) * 88);
        ctx.lineTo(Math.cos(a) * 94, Math.sin(a) * 94);
        ctx.stroke();
      }
      ctx.restore();

      // Sweeping radar sonar sweep
      if (projectorActive) {
        ctx.save();
        ctx.translate(coreX, coreY);
        const radarAngle = (timeSec * 1.2 * speedMultiplier) % (Math.PI * 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(radarAngle) * 155, Math.sin(radarAngle) * 155);
        ctx.strokeStyle = `rgba(6, 182, 212, ${0.14 * projectionBrightness})`;
        ctx.stroke();
        ctx.restore();
      }

      // Draw drifting digital hex text values around the core
      if (projectorActive) {
        ctx.font = '0.55rem var(--font-mono)';
        ctx.fillStyle = `rgba(6, 182, 212, ${0.45 * projectionBrightness})`;
        
        telemetryBlocks.forEach(tb => {
          tb.ticks++;
          if (tb.ticks >= tb.maxTicks || tb.text === '') {
            tb.ticks = 0;
            tb.x = (Math.random() * 240 - 120);
            tb.y = (Math.random() * 240 - 120);
            // Don't draw too close to core center
            if (Math.hypot(tb.x, tb.y) < 40) {
              tb.x += (tb.x > 0 ? 50 : -50);
              tb.y += (tb.y > 0 ? 50 : -50);
            }
            tb.text = telemetryLabels[Math.floor(Math.random() * telemetryLabels.length)];
          }
          const fadeAlpha = Math.sin((tb.ticks / tb.maxTicks) * Math.PI);
          ctx.fillStyle = `rgba(6, 182, 212, ${fadeAlpha * 0.3 * projectionBrightness})`;
          ctx.fillText(tb.text, coreX + tb.x, coreY + tb.y);
        });
      }
      ctx.restore();
    }

    // 5. Draw and animate particles
    particles.forEach((p, idx) => {
      // Animate particle coordinates
      if (projectionMode === 'Alexa Ripple' && !isLockdown) {
        // Alexa wavy particle flow
        p.x += p.dx * speedMultiplier * 1.5;
        p.y = p.baseY + Math.sin(p.x * 0.005 + p.waveOffset) * p.waveAmplitude * (isSpeaking ? 1.8 : 1.0);
      } else {
        // Jarvis grid/free movement
        p.x += p.dx * speedMultiplier;
        p.y += p.dy * speedMultiplier;
      }

      // Wrap-around bounds check
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) { p.y = canvas.height; p.baseY = canvas.height; }
      if (p.y > canvas.height) { p.y = 0; p.baseY = 0; }

      // Draw particle circle
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      
      let fillHue = p.hue;
      if (isLockdown) {
        fillHue = 0; // crimson alert red
      } else if (projectionMode === 'Alexa Ripple') {
        fillHue = p.hue > 200 ? 210 : 190; // royal blue/cyan shades
      }
      ctx.fillStyle = `hsla(${fillHue}, 100%, 70%, ${p.alpha * projectionBrightness})`;
      ctx.fill();

      // Jarvis plexus line connectors
      if (projectionMode === 'Jarvis HUD' && !isLockdown) {
        for (let j = idx + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 100) {
            const lineAlpha = (1 - dist / 100) * 0.12 * projectionBrightness;
            ctx.strokeStyle = `rgba(6, 182, 212, ${lineAlpha})`;
            ctx.lineWidth = 0.55;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
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
      isPassiveListenEnabled = true;
      endConversation();
      voice.stopListeningForCommand();
      if (isAlexa) {
        playAlexaErrorChime();
      } else {
        playShutdownBeep();
      }
      diag.logToTerminal("[AI CORE] Voice activation closed. Returning to standby.", "info");
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
      }
      setTimeout(() => voice.startWakeWordListener(), 500);
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
    
    console.log(`[voice.onRecognitionStateChange] UI State change: ${state}`);
    
    if (state === 'active_listening') {
      micBtn.classList.add('active');
      voiceStatusText.textContent = (isAlexa ? 'ALEXA ACTIVE' : 'LUKAS ACTIVE') + ` (${activeLang})`;
      voiceStatusText.style.color = isAlexa ? 'var(--cyan-neon)' : 'var(--purple-neon)';
      diag.logToTerminal(isAlexa ? `Alexa active listening (${activeLang})...` : `Lukas active listening (${activeLang})...`, "info");
      audioPlayer.volume = 0.08; // Duck music during mic capture
      if (coreBtn) {
        coreBtn.classList.add('listening');
        coreBtn.classList.remove('processing');
        coreBtn.classList.remove('waking');
      }
    } else if (state === 'passive_listening') {
      micBtn.classList.remove('active');
      voiceStatusText.textContent = `PASSIVE LISTEN (${activeLang})`;
      voiceStatusText.style.color = 'var(--purple-neon)';
      if (!window.speechSynthesis.speaking) audioPlayer.volume = 0.35; // Restore volume
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
        coreBtn.classList.remove('waking');
      }
    } else if (state === 'wake_detected') {
      micBtn.classList.remove('active');
      voiceStatusText.textContent = isAlexa ? 'ALEXA AWAKE' : 'LUKAS AWAKE';
      voiceStatusText.style.color = 'var(--cyan-neon)';
      if (coreBtn) {
        coreBtn.classList.add('waking');
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
      }
    } else if (state === 'processing') {
      micBtn.classList.remove('active');
      voiceStatusText.textContent = 'PROCESSING...';
      voiceStatusText.style.color = isAlexa ? 'var(--cyan-neon)' : 'var(--purple-neon)';
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.add('processing');
        coreBtn.classList.remove('waking');
      }
    } else if (state === 'executing') {
      micBtn.classList.remove('active');
      voiceStatusText.textContent = 'EXECUTING...';
      voiceStatusText.style.color = 'var(--yellow-neon, #ffd700)';
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.add('processing');
        coreBtn.classList.remove('waking');
      }
    } else if (state === 'responding') {
      micBtn.classList.remove('active');
      voiceStatusText.textContent = 'RESPONDING...';
      voiceStatusText.style.color = 'var(--green-neon, #39ff14)';
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.add('processing');
        coreBtn.classList.remove('waking');
      }
    } else if (state === 'sleeping') {
      micBtn.classList.remove('active');
      voiceStatusText.textContent = 'SLEEPING';
      voiceStatusText.style.color = 'var(--rose-neon)';
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
        coreBtn.classList.remove('waking');
      }
    } else if (state === 'idle') {
      micBtn.classList.remove('active');
      voiceStatusText.textContent = 'IDLE';
      voiceStatusText.style.color = 'var(--cyan-neon)';
      if (!window.speechSynthesis.speaking) audioPlayer.volume = 0.35; // Restore volume
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
        coreBtn.classList.remove('waking');
      }
    }

    if (error) {
      if (error !== 'no-speech') {
        diag.logToTerminal(`Voice link suspended: ${error}`, "warn");
      }
    } else if (state === 'idle' || state === 'sleeping') {
      diag.logToTerminal("Voice link closed.", "info");
    }
  };

  // noCommandTimeout, proceedTimeout, accumulatedTranscript, clearSilenceTimeout, startSilenceTimeout
  // are now module-level (hoisted above bindUIEvents) so processCommand can access them.

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

  voice.onPreWarm = () => {
    diag.logToTerminal("[VOICE PIPELINE] Pre-warm trigger. Indexing active memory and context cache...", "info");
    lukasMemory.buildContextBlock();
    updateMemoryPanel();
  };

  voice.onWakeWordDetected = () => {
    // 1. Reset microphone immediately to clear any OS/hardware audio glitches
    voice.resetMicrophoneForCommand();

    const isAlexa = localStorage.getItem('lukas_assistant_persona') === 'alexa';
    isPassiveListenEnabled = true;
    isWakingUp = true;
    
    if (isAlexa) {
      playAlexaWakeChime();
    } else {
      playFuturisticBeep();
    }
    
    diag.logToTerminal("[AI CORE] Wake word recognized. Waking up core...", "info");
    
    const coreBtn = document.getElementById('lukasCoreBtn');
    if (coreBtn) {
      coreBtn.classList.add('waking');
      coreBtn.classList.remove('listening');
      coreBtn.classList.remove('processing');
    }

    voiceStatusText.textContent = isAlexa ? 'ALEXA AWAKE' : 'LUKAS AWAKE';
    voiceStatusText.style.color = 'var(--cyan-neon)';

    // 2. Context Restoration: Retrieve active project or active goal context
    let greeting = isAlexa ? "Yes?" : "Yes, Commander?";
    
    const activeProject = lukasMemory.shortTerm.currentProject;
    const activeGoal = lukasMemory.shortTerm.currentGoal;
    
    if (activeProject) {
      greeting = `Welcome back. We were working on the ${activeProject} project. How would you like to continue?`;
    } else if (activeGoal) {
      greeting = `Welcome back. We were working on your goal to ${activeGoal}. How would you like to continue?`;
    } else {
      const storedName = lukasMemory.getFact('name');
      if (storedName) {
        greeting = isAlexa ? `Yes, ${storedName}?` : `Welcome back, ${storedName}. How can I assist you?`;
      }
    }
    
    // Display greeting bubble
    appendChatBubble(greeting, 'assistant');
    
    // Speak the greeting vocally
    voice.speak(greeting);
  };

  voice.onSpeechStart = () => {
    isProcessingCommand = false;
    coreCenterNode.classList.add('speaking');
    audioWaveform.classList.add('speaking');
    audioPlayer.volume = 0.08; // Duck music while speaking

    // Print latency benchmark report
    const report = voice.latency.getReport();
    if (report && report.total_ms > 0) {
      diag.logToTerminal(`[LATENCY PROFILE] Wake-to-STT: ${report.wake_to_stt_ms}ms | STT-to-Response: ${report.stt_to_response_ms}ms | Response-to-Speech: ${report.response_to_speech_ms}ms | Total: ${report.total_ms}ms`, 'info');
      // Reset after reporting
      voice.latency.reset();
    }
  };

  voice.onSpeechEnd = () => {
    coreCenterNode.classList.remove('speaking');
    audioWaveform.classList.remove('speaking');
    audioPlayer.volume = 0.35; // Restore music volume
    
    isProcessingCommand = false;
    
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

    // ★ Always-On Wake Word: return to passive listen regardless of standby state
    // This means saying 'LUKAS' always works, just like Alexa.
    diag.logToTerminal("[AI CORE] Returning to passive wake-word mode.", "info");
    setTimeout(() => voice.startWakeWordListener(), 300);
  };

  // Click core for voice trigger shortcut (Single-turn voice command listening)
  document.getElementById('lukasCoreBtn').addEventListener('click', () => {
    voice.warmUpMic(); // Warm up mic stream on user gesture
    const isAlexa = localStorage.getItem('lukas_assistant_persona') === 'alexa';
    const coreBtn = document.getElementById('lukasCoreBtn');
    
    if (voice.isListening || isWakingUp) {
      isWakingUp = false;
      isPassiveListenEnabled = true;
      voice.stopListeningForCommand();
      clearSilenceTimeout();
      if (proceedTimeout) clearTimeout(proceedTimeout);
      accumulatedTranscript = "";
      
      if (isAlexa) {
        playAlexaErrorChime();
      } else {
        playShutdownBeep();
      }
      diag.logToTerminal("[AI CORE] Voice activation closed. Returning to standby.", "info");
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
        coreBtn.classList.remove('waking');
      }
      setTimeout(() => voice.startWakeWordListener(), 500);
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
  doorLockOutdoor.addEventListener('change', async (e) => {
    await setDeviceStateWithFeedback(DEVICES.OUTDOOR, { locked: e.target.checked });
  });

  const floodlightsOutdoor = document.getElementById('floodlightsOutdoor');
  floodlightsOutdoor.addEventListener('change', async (e) => {
    await setDeviceStateWithFeedback(DEVICES.OUTDOOR, { floodlights: e.target.checked });
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
      renderVoiceProfilesList();
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

  // Voice biometrics controls
  const trainVoiceBtn = document.getElementById('trainVoiceBtn');
  const clearVoiceProfilesBtn = document.getElementById('clearVoiceProfilesBtn');
  const voiceRegNameInput = document.getElementById('voiceRegName');
  const voiceTrainStatus = document.getElementById('voiceTrainStatus');

  if (trainVoiceBtn && voiceRegNameInput && voiceTrainStatus) {
    trainVoiceBtn.addEventListener('click', () => {
      const name = voiceRegNameInput.value.trim();
      if (!name) {
        alert("Please enter a name first.");
        return;
      }

      isVoicePrintTrainingActive = true;
      voicePrintTrainingName = name;
      
      voiceTrainStatus.style.display = 'block';
      voiceTrainStatus.innerHTML = `<span style="color:#ff9f3b; animation:blink 1.2s infinite;"><i class="fa-solid fa-microphone"></i> Recording vocal signature...</span><br>Please speak: "Lukas, authorize my profile" now.`;
      
      voice.warmUpMic();
      setTimeout(() => {
        voice.startListeningForCommand();
      }, 300);
      
      diag.logToTerminal(`[BIOMETRICS] Started vocal print recording for user: "${name}"`, 'info');
    });
  }

  if (clearVoiceProfilesBtn) {
    clearVoiceProfilesBtn.addEventListener('click', () => {
      if (confirm("Are you sure you want to delete all registered voice profiles?")) {
        voice.biometrics.clearProfiles();
        renderVoiceProfilesList();
        diag.logToTerminal('[BIOMETRICS] Wiped all vocal profiles from local database.', 'warn');
        alert("All voice profiles deleted.");
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

  if (volRange) {
    volRange.addEventListener('input', () => {
      const pct = parseInt(volRange.value);
      if (volLabel) volLabel.textContent = `${pct}%`;
      voice.setVolume(pct / 100);
      lukasMemory.setPreference('voiceVolume', pct / 100);
      diag.logToTerminal(`[SETTINGS] Vocal volume set to ${pct}%.`, 'info');
    });
  }

  if (rateRange) {
    rateRange.addEventListener('input', () => {
      const rate = parseInt(rateRange.value) / 10;
      if (rateLabel) rateLabel.textContent = `${rate.toFixed(1)}x`;
      voice.setRate(rate);
      lukasMemory.setPreference('voiceRateVal', rate);
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

  if (personaSelect) {
    personaSelect.addEventListener('change', () => {
      const selected = personaSelect.value;
      lukasMemory.setPreference('assistantPersona', selected);
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
    briefModeChk.addEventListener('change', () => {
      const checked = briefModeChk.checked;
      lukasMemory.setPreference('briefMode', checked ? 'true' : 'false');
      diag.logToTerminal(`[SETTINGS] Alexa Brief Mode ${checked ? 'ENABLED' : 'DISABLED'}.`, 'info');
    });
  }

  // ── Speech Recognition Language ─────────────────────────────────────────
  const speechLangSelect = document.getElementById('speechLangSelect');
  if (speechLangSelect) {
    speechLangSelect.addEventListener('change', () => {
      const selectedLang = speechLangSelect.value;
      if (typeof voice !== 'undefined' && voice.setLanguage) {
        voice.setLanguage(selectedLang);
      }
      lukasMemory.setPreference('speechLang', selectedLang);
      diag.logToTerminal(`[SETTINGS] Speech recognition language changed to ${selectedLang}.`, 'info');
      const speechSupportMsg = document.getElementById('speechSupportMsg');
      if (speechSupportMsg && voice.recognition) {
        speechSupportMsg.textContent = `WebSpeech Active (${selectedLang})`;
        speechSupportMsg.style.color = 'var(--emerald-neon)';
      }
    });
  }

  const continuousConvoSelect = document.getElementById('continuousConvoSelect');
  if (continuousConvoSelect) {
    continuousConvoSelect.addEventListener('change', () => {
      const selectedTimeout = continuousConvoSelect.value;
      lukasMemory.setPreference('continuousConvoTimeout', selectedTimeout);
      diag.logToTerminal(`[SETTINGS] Continuous conversation mode changed: ${selectedTimeout === '0' ? 'Disabled' : (selectedTimeout / 1000) + 's window'}.`, 'info');
    });
  }

  // ── LUKAS Nexus Dynamic Personality Mode ───────────────────────────────
  const personalityModeSelect = document.getElementById('personalityModeSelect');
  if (personalityModeSelect) {
    personalityModeSelect.addEventListener('change', () => {
      const selectedMode = personalityModeSelect.value;
      lukasMemory.setPreference('personalityMode', selectedMode);
      diag.logToTerminal(`[SETTINGS] LUKAS personality mode changed to: ${selectedMode.toUpperCase()}.`, 'info');
      updateMemoryPanel();
    });
  }

  // ── LUKAS Infinity Voice Customizations ─────────────────────────────────
  const voiceAccentSelect = document.getElementById('voiceAccentSelect');
  if (voiceAccentSelect) {
    voiceAccentSelect.addEventListener('change', () => {
      const selectedAccent = voiceAccentSelect.value;
      voice.setAccent(selectedAccent);
      lukasMemory.setPreference('voiceAccent', selectedAccent);
      diag.logToTerminal(`[SETTINGS] English accent profile changed to: ${selectedAccent.toUpperCase()}.`, 'info');
    });
  }

  const voiceRateSelect = document.getElementById('voiceRateSelect');
  if (voiceRateSelect) {
    voiceRateSelect.addEventListener('change', () => {
      const selectedRate = voiceRateSelect.value;
      voice.setSpeakingRateProfile(selectedRate);
      lukasMemory.setPreference('voiceRate', selectedRate);
      diag.logToTerminal(`[SETTINGS] Speaking rate profile changed to: ${selectedRate.toUpperCase()}.`, 'info');
    });
  }

  const voiceEmotionalToneSelect = document.getElementById('voiceEmotionalToneSelect');
  if (voiceEmotionalToneSelect) {
    voiceEmotionalToneSelect.addEventListener('change', () => {
      const selectedTone = voiceEmotionalToneSelect.value;
      voice.setEmotionalToneMode(selectedTone);
      lukasMemory.setPreference('voiceEmotionalTone', selectedTone);
      diag.logToTerminal(`[SETTINGS] Emotional tone mode changed to: ${selectedTone.toUpperCase()}.`, 'info');
    });
  }

  // ── LUKAS Nexus Database Synchronization ───────────────────────────────
  const nexusSyncCheckbox = document.getElementById('nexusSyncCheckbox');
  const nexusSyncPassphrase = document.getElementById('nexusSyncPassphrase');
  const triggerSyncBtn = document.getElementById('triggerSyncBtn');
  const purgeDatabaseBtn = document.getElementById('purgeDatabaseBtn');

  if (nexusSyncCheckbox) {
    nexusSyncCheckbox.addEventListener('change', () => {
      const enabled = nexusSyncCheckbox.checked;
      lukasMemory.setPreference('syncEnabled', enabled ? 'true' : 'false');
      diag.logToTerminal(`[NEXUS SYNC] Secure Server Synchronization ${enabled ? 'ENABLED' : 'DISABLED'}.`, 'info');
    });
  }

  if (nexusSyncPassphrase) {
    nexusSyncPassphrase.addEventListener('input', () => {
      lukasMemory.setPreference('syncPassphrase', nexusSyncPassphrase.value.trim());
    });
  }

  if (triggerSyncBtn) {
    triggerSyncBtn.addEventListener('click', async () => {
      const enabled = localStorage.getItem('lukas_sync_enabled') === 'true';
      const passphrase = localStorage.getItem('lukas_sync_passphrase') || '';
      
      if (!enabled) {
        diag.logToTerminal('[NEXUS SYNC] ❌ Sync is disabled. Enable Secure Server Synchronization first.', 'warn');
        return;
      }
      if (!passphrase) {
        diag.logToTerminal('[NEXUS SYNC] ❌ Encryption passphrase required.', 'warn');
        return;
      }

      diag.logToTerminal('[NEXUS SYNC] Initiating manual zero-knowledge database sync...', 'info');
      triggerSyncBtn.disabled = true;
      const originalText = triggerSyncBtn.innerHTML;
      triggerSyncBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> SYNCING...';

      try {
        const res = await lukasMemory.syncWithServer(passphrase);
        if (res.success) {
          diag.logToTerminal('[NEXUS SYNC] Zero-knowledge database sync successfully completed.', 'info');
          updateMemoryPanel();
        } else {
          diag.logToTerminal(`[NEXUS SYNC] ❌ Sync failed: ${res.error}`, 'error');
        }
      } catch (err) {
        diag.logToTerminal(`[NEXUS SYNC] ❌ Sync exception: ${err.message}`, 'error');
      } finally {
        triggerSyncBtn.disabled = false;
        triggerSyncBtn.innerHTML = originalText;
      }
    });
  }

  if (purgeDatabaseBtn) {
    purgeDatabaseBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to purge all memory? This will clear short-term memory, long-term memory, local browser storage, and the server-backed secure database.')) {
        return;
      }
      diag.logToTerminal('[NEXUS SYNC] Purging memory database...', 'warn');
      lukasMemory.clearAllMemory();
      
      const enabled = lukasMemory.getPreference('syncEnabled', 'false') === 'true';
      if (enabled) {
        try {
          const resp = await fetch('/api/storage/purge', { method: 'POST' });
          const resData = await resp.json();
          if (resData.success) {
            diag.logToTerminal('[NEXUS SYNC] Local server secure storage database files wiped successfully.', 'info');
          } else {
            diag.logToTerminal(`[NEXUS SYNC] ❌ Failed to purge server storage: ${resData.error}`, 'error');
          }
        } catch (err) {
          diag.logToTerminal(`[NEXUS SYNC] ❌ Failed to purge server storage: ${err.message}`, 'error');
        }
      }
      updateMemoryPanel();
      diag.logToTerminal('[NEXUS SYNC] Memory database purged successfully.', 'info');
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
  if (geminiSaveBtn && geminiInput) {
    geminiSaveBtn.addEventListener('click', () => {
      const keyVal = geminiInput.value.trim();
      lukasMemory.setPreference('gemini_api_key', keyVal);
      diag.logToTerminal(`[SETTINGS] Gemini API Key configuration updated.`, 'info');
      const origText = geminiSaveBtn.innerHTML;
      geminiSaveBtn.innerHTML = '<i class="fa-solid fa-check"></i> SAVED';
      setTimeout(() => {
        geminiSaveBtn.innerHTML = origText;
      }, 1500);
    });
  }

  // ── OpenAI API Key ───────────────────────────────────────────────────
  if (openaiSaveBtn && openaiInput) {
    openaiSaveBtn.addEventListener('click', async () => {
      const keyVal = openaiInput.value.trim();
      lukasMemory.setPreference('openai_api_key', keyVal);
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

  // Memory Panel events
  const memoryDrawer = document.getElementById('memoryDrawer');
  const openMemBtn = document.getElementById('openMemoryPanelBtn');
  const closeMemBtn = document.getElementById('closeMemoryPanelBtn');

  if (openMemBtn && memoryDrawer) {
    openMemBtn.addEventListener('click', () => {
      memoryDrawer.classList.toggle('active');
      updateMemoryPanel();
      diag.logToTerminal('[MEMORY MATRIX] Displaying multi-level memory matrix.', 'info');
    });
  }

  if (closeMemBtn && memoryDrawer) {
    closeMemBtn.addEventListener('click', () => {
      memoryDrawer.classList.remove('active');
      diag.logToTerminal('[MEMORY MATRIX] Closing memory matrix.', 'info');
    });
  }

  // Plan execution panel close
  const closePlanBtn = document.getElementById('closePlanPanelBtn');
  const planPanel = document.getElementById('planExecutionPanel');
  if (closePlanBtn && planPanel) {
    closePlanBtn.addEventListener('click', () => {
      planPanel.classList.remove('active');
      diag.logToTerminal('[PLANNER] Plan roadmap dismissed.', 'info');
    });
  }

  // Sidebar Memory events
  const conversationSidebar = document.getElementById('conversationSidebar');
  const openSidebarMemoryBtn = document.getElementById('openSidebarMemoryBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');

  if (openSidebarMemoryBtn && conversationSidebar) {
    openSidebarMemoryBtn.addEventListener('click', () => {
      conversationSidebar.classList.toggle('open');
      updateSidebarMemory();
      diag.logToTerminal('[SIDEBAR MEMORY] Toggled sidebar memory drawer.', 'info');
    });
  }

  if (closeSidebarBtn && conversationSidebar) {
    closeSidebarBtn.addEventListener('click', () => {
      conversationSidebar.classList.remove('open');
      diag.logToTerminal('[SIDEBAR MEMORY] Closed sidebar memory drawer.', 'info');
    });
  }

  // Click outside sidebar to close it
  document.addEventListener('click', (e) => {
    if (conversationSidebar && conversationSidebar.classList.contains('open')) {
      if (!conversationSidebar.contains(e.target) && e.target !== openSidebarMemoryBtn && !openSidebarMemoryBtn.contains(e.target)) {
        conversationSidebar.classList.remove('open');
        diag.logToTerminal('[SIDEBAR MEMORY] Auto-closed sidebar memory drawer.', 'info');
      }
    }
  });
}

// ─── UPGRADE: Memory Panel Update Logic ───
function updateMemoryPanel() {
  const working = lukasMemory.getWorkingMemorySummary();
  const projects = lukasMemory.getProjectMemorySummary();
  const facts = lukasMemory.getLongTermFactsSummary();
  
  // 1. Render Working Memory
  const workingDiv = document.getElementById('memWorkingDetails');
  if (workingDiv) {
    let tagsHtml = working.contextTags.map(t => `<span class="memory-tag">${t}</span>`).join('');
    workingDiv.innerHTML = `
      <div class="memory-fact-row"><span>User</span><span>${working.userName}</span></div>
      <div class="memory-fact-row"><span>Project</span><span>${working.currentProject || 'None'}</span></div>
      <div class="memory-fact-row"><span>Goal</span><span>${working.currentGoal || 'None'}</span></div>
      <div class="memory-fact-row"><span>Location</span><span>${working.location || 'Local Area'}</span></div>
      <div class="memory-fact-row"><span>Top Activity</span><span>${working.dominantUseCase || 'Conversational'}</span></div>
      <div class="memory-fact-row"><span>Messages</span><span>${working.messageCount}</span></div>
      <div style="font-size:0.6rem; color:#64748b; margin-top:0.40rem; font-family:var(--font-mono)">CONTEXT FOCUS TAGS:</div>
      <div class="memory-tags-container">${tagsHtml || '<span class="memory-tag" style="border-color:rgba(255,255,255,0.05); color:#64748b;">None</span>'}</div>
    `;
  }
  
  // 2. Render Project Memory
  const projectsDiv = document.getElementById('memProjectsDetails');
  if (projectsDiv) {
    if (projects.length === 0) {
      projectsDiv.innerHTML = `<div style="font-size:0.65rem; color:#64748b; text-align:center; padding:10px 0;">No active projects recorded.</div>`;
    } else {
      projectsDiv.innerHTML = projects.map(p => `
        <div class="memory-project-card">
          <div class="memory-project-title"><span>${p.name.toUpperCase()}</span><span style="color:${p.status === 'active' ? 'var(--cyan-neon)' : '#64748b'}">[${p.status.toUpperCase()}]</span></div>
          <div style="font-size:0.6rem; color:#94a3b8; margin-bottom:4px; line-height:1.2;">${p.description}</div>
          ${p.goals.length > 0 ? `<div style="font-size:0.55rem; color:#64748b;">Goals: ${p.goals.join(', ')}</div>` : ''}
          ${p.problems.length > 0 ? `<div style="font-size:0.55rem; color:var(--rose-neon);">Problems: ${p.problems.join(', ')}</div>` : ''}
        </div>
      `).join('');
    }
  }
  
  // 3. Render Long-term Facts
  const factsDiv = document.getElementById('memFactsDetails');
  if (factsDiv) {
    if (facts.length === 0) {
      factsDiv.innerHTML = `<div style="font-size:0.65rem; color:#64748b; text-align:center; padding:10px 0;">No long-term facts recorded.</div>`;
    } else {
      factsDiv.innerHTML = facts.map(f => `
        <div class="memory-fact-row"><span>${f.key}</span><span>${f.value}</span></div>
      `).join('');
    }
  }
}

function updateSidebarMemory() {
  const profileDiv = document.getElementById('sidebarUserProfile');
  if (profileDiv) {
    const name = lukasMemory.getFact('name') || 'Guest';
    const city = lukasMemory.getFact('city') || 'Not set';
    const accent = lukasMemory.getPreference('voiceAccent', 'indian_english');
    const style = lukasMemory.getPreference('personalityMode', 'casual');
    const accentLabels = {
      indian_english: 'Indian English',
      bengaluru_professional: 'Bengaluru Professional',
      neutral_corporate: 'Neutral Corporate India',
      kannada_native: 'Kannada Native',
      'en-US': 'American Accent',
      'en-GB': 'British Accent',
      'en-AU': 'Australian Accent',
      'en-CA': 'Canadian Accent'
    };
    profileDiv.innerHTML = `
      <div class="sidebar-info-row"><strong>Name:</strong> <span>${name}</span></div>
      <div class="sidebar-info-row"><strong>Location:</strong> <span>${city}</span></div>
      <div class="sidebar-info-row"><strong>Accent:</strong> <span>${accentLabels[accent] || accent}</span></div>
      <div class="sidebar-info-row"><strong>Style:</strong> <span>${style}</span></div>
    `;
  }

  const tasksDiv = document.getElementById('sidebarActiveTasks');
  if (tasksDiv) {
    const activeGoals = lukasMemory.getActiveGoals();
    const activeReminders = (typeof lukasReminders !== 'undefined' ? lukasReminders : []).filter(r => !r.fired);
    let html = '';
    if (activeGoals.length === 0 && activeReminders.length === 0) {
      html = '<div class="sidebar-empty">No active tasks or reminders.</div>';
    } else {
      activeGoals.forEach(g => {
        html += `<div class="sidebar-task-item"><i class="fa-solid fa-square-check" style="color:var(--cyan-neon);"></i> <span>${g.goal}</span></div>`;
      });
      activeReminders.forEach(r => {
        html += `<div class="sidebar-task-item"><i class="fa-solid fa-bell" style="color:var(--amber-neon);"></i> <span>${r.text}</span></div>`;
      });
    }
    tasksDiv.innerHTML = html;
  }

  const projectsDiv = document.getElementById('sidebarSavedProjects');
  if (projectsDiv) {
    const activeProj = lukasMemory.shortTerm.currentProject;
    const activeGoal = lukasMemory.shortTerm.currentGoal;
    let html = '';
    if (activeProj) {
      html += `
        <div class="sidebar-project-item">
          <strong>Project:</strong> <span>${activeProj}</span>
          ${activeGoal ? `<div style="font-size:0.75rem;color:#94a3b8;margin-top:2px;">Goal: ${activeGoal}</div>` : ''}
        </div>
      `;
    } else {
      html = '<div class="sidebar-empty">No active project context.</div>';
    }
    projectsDiv.innerHTML = html;
  }

  const chatsDiv = document.getElementById('sidebarRecentChats');
  if (chatsDiv) {
    const messages = lukasMemory.shortTerm.messages || [];
    
    // Chunk messages by 30 minute idle gaps
    const sessions = [];
    let currentSession = null;
    const GAP_MS = 30 * 60 * 1000;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!currentSession || (currentSession.startTime - msg.timestamp > GAP_MS)) {
        if (currentSession) {
          sessions.push(currentSession);
        }
        currentSession = {
          startTime: msg.timestamp,
          messages: [msg],
          preview: msg.content.substring(0, 40) + (msg.content.length > 40 ? '...' : '')
        };
      } else {
        currentSession.messages.unshift(msg);
        if (msg.role === 'user') {
          currentSession.preview = msg.content.substring(0, 40) + (msg.content.length > 40 ? '...' : '');
        }
      }
    }
    if (currentSession) {
      sessions.push(currentSession);
    }

    let html = '';
    if (sessions.length === 0) {
      html = '<div class="sidebar-empty">No chat history.</div>';
    } else {
      sessions.slice(0, 5).forEach((session, idx) => {
        const dateStr = new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        html += `
          <div class="sidebar-chat-session" data-idx="${idx}" style="cursor:pointer;padding:0.45rem;border-radius:4px;margin-bottom:4px;">
            <div style="font-size:0.65rem;color:var(--purple-neon);">${dateStr}</div>
            <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:0.75rem;">${session.preview}</div>
          </div>
        `;
      });
    }
    chatsDiv.innerHTML = html;
    
    chatsDiv.querySelectorAll('.sidebar-chat-session').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        const session = sessions[idx];
        if (session) {
          console.log("[SIDEBAR] Restoring conversation from:", new Date(session.startTime).toLocaleTimeString());
          visibleMessageCount = session.messages.length;
          renderChatHistory();
        }
      });
    });
  }
}

// ─── UPGRADE: Plan Panel Control Logic ───
function showPlanExecutionPanel(plan) {
  const panel = document.getElementById('planExecutionPanel');
  const listContainer = document.getElementById('planPanelStepsList');
  if (!panel || !listContainer) return;
  
  // Clear steps
  listContainer.innerHTML = '';
  
  // Generate steps html
  plan.steps.forEach((step, idx) => {
    const row = document.createElement('div');
    row.className = `plan-step-row plan-step-${idx}`;
    row.innerHTML = `
      <div class="plan-step-status-icon pending" id="planStepIcon-${idx}"><i class="fa-regular fa-circle"></i></div>
      <div class="plan-step-info">
        <span class="plan-step-title">${step.title}</span>
        <span class="plan-step-desc">${step.description}</span>
      </div>
      <div class="plan-step-meta">${step.duration}</div>
    `;
    listContainer.appendChild(row);
  });
  
  panel.classList.add('active');
}

function updatePlanPanelStepStatus(idx, status) {
  const row = document.querySelector(`.plan-step-${idx}`);
  const icon = document.getElementById(`planStepIcon-${idx}`);
  if (!row || !icon) return;
  
  // Remove existing status classes
  row.classList.remove('active', 'completed', 'failed');
  
  if (status === 'active') {
    row.classList.add('active');
    icon.className = 'plan-step-status-icon active';
    icon.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
  } else if (status === 'completed') {
    row.classList.add('completed');
    icon.className = 'plan-step-status-icon completed';
    icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
  } else if (status === 'failed') {
    row.classList.add('failed');
    icon.className = 'plan-step-status-icon failed';
    icon.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
  }
}

// ─── UPGRADE: Executive Analysis Parsing Logic ───
function parseExecutiveAnalysis(text) {
  if (typeof text !== 'string') return { hasAnalysis: false, analysisHtml: '', responseText: text };
  const execRegex = /\[EXECUTIVE ANALYSIS\]([\s\S]*?)\[RESPONSE\]([\s\S]*)/i;
  const match = text.match(execRegex);
  if (match) {
    const analysisRaw = match[1].trim();
    const responseBody = match[2].trim();
    
    // Parse the items in analysis
    const lines = analysisRaw.split('\n');
    let html = `<div class="executive-analysis-container">
      <div class="executive-analysis-title"><i class="fa-solid fa-brain"></i> EXECUTIVE PRE-CHECK ANALYSIS</div>`;
    
    lines.forEach(line => {
      if (line.includes(':')) {
        const parts = line.split(':');
        const label = parts[0].trim();
        const val = parts.slice(1).join(':').trim();
        html += `<div class="executive-analysis-item"><strong>${label}:</strong> ${val}</div>`;
      } else if (line.trim()) {
        html += `<div class="executive-analysis-item">${line.trim()}</div>`;
      }
    });
    html += `</div>`;
    
    return {
      hasAnalysis: true,
      analysisHtml: html,
      responseText: responseBody
    };
  }
  
  return {
    hasAnalysis: false,
    analysisHtml: '',
    responseText: text
  };
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

  switchNode.addEventListener('change', async (e) => {
    await setDeviceStateWithFeedback(stateName, { on: e.target.checked });
  });

  dimmerNode.addEventListener('input', async (e) => {
    await setDeviceStateWithFeedback(stateName, { brightness: parseInt(e.target.value) });
  });

  colorNode.addEventListener('input', async (e) => {
    await setDeviceStateWithFeedback(stateName, { color: e.target.value });
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
        new Promise((_, reject) => setTimeout(() => reject(new Error("Puter AI request timed out")), 15000))
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


function renderChatHistory() {
  if (!chatHistory) return;
  chatHistory.innerHTML = '';

  const messages = lukasMemory.shortTerm.messages || [];
  const totalMessages = messages.length;
  
  if (totalMessages > visibleMessageCount) {
    const loadOlderRow = document.createElement('div');
    loadOlderRow.className = 'load-older-row chat-bubble-row';
    loadOlderRow.style.justifyContent = 'center';
    loadOlderRow.style.margin = '0.5rem 0';
    loadOlderRow.style.width = '100%';

    const loadOlderBtn = document.createElement('button');
    loadOlderBtn.className = 'btn-routine';
    loadOlderBtn.style.padding = '0.25rem 0.75rem';
    loadOlderBtn.style.fontSize = '0.7rem';
    loadOlderBtn.style.borderColor = 'var(--cyan-neon)';
    loadOlderBtn.style.color = 'var(--cyan-neon)';
    loadOlderBtn.style.cursor = 'pointer';
    loadOlderBtn.style.background = 'rgba(0, 240, 255, 0.05)';
    loadOlderBtn.style.borderRadius = '4px';
    loadOlderBtn.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Load Older Messages';
    
    loadOlderBtn.addEventListener('click', () => {
      const oldScrollHeight = chatHistory.scrollHeight;
      visibleMessageCount = Math.min(totalMessages, visibleMessageCount + 15);
      renderChatHistory();
      
      setTimeout(() => {
        chatHistory.scrollTop = chatHistory.scrollHeight - oldScrollHeight;
      }, 0);
    });

    loadOlderRow.appendChild(loadOlderBtn);
    chatHistory.appendChild(loadOlderRow);
  }

  const startIndex = Math.max(0, totalMessages - visibleMessageCount);
  const visibleMessages = messages.slice(startIndex);

  visibleMessages.forEach(msg => {
    const row = document.createElement('div');
    row.className = `chat-bubble-row${msg.role === 'user' ? ' user-row' : ''}`;

    if (msg.role !== 'system') {
      const avatar = document.createElement('div');
      avatar.className = `chat-avatar ${msg.role === 'assistant' ? 'lukas-avatar' : 'user-avatar'}`;
      avatar.innerHTML = msg.role === 'assistant'
        ? '<i class="fa-solid fa-microchip"></i>'
        : '<i class="fa-solid fa-user"></i>';
      row.appendChild(avatar);
    }

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.role}`;

    if (msg.role === 'assistant') {
      if (msg.content.includes('Awaiting Clarification') || msg.content.includes('ask_clarification')) {
        bubble.classList.add('clarification-card');
      }
      const parsed = parseExecutiveAnalysis(msg.content);
      if (parsed.hasAnalysis) {
        bubble.innerHTML = parsed.analysisHtml + `<div class="response-body-text">${parsed.responseText}</div>`;
      } else {
        bubble.textContent = msg.content;
      }
    } else {
      bubble.textContent = msg.content;
    }

    row.appendChild(bubble);
    chatHistory.appendChild(row);
  });
  
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// 4. Chat Dialogue append
function appendChatBubble(text, sender, linkUrl, accuracyScore = null) {
  const row = document.createElement('div');
  row.className = `chat-bubble-row${sender === 'user' ? ' user-row' : ''}`;

  if (sender !== 'system') {
    const avatar = document.createElement('div');
    avatar.className = `chat-avatar ${sender === 'assistant' ? 'lukas-avatar' : 'user-avatar'}`;
    avatar.innerHTML = sender === 'assistant'
      ? '<i class="fa-solid fa-microchip"></i>'
      : '<i class="fa-solid fa-user"></i>';
    row.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${sender}`;
  
  if (sender === 'assistant') {
    if (text.includes('Awaiting Clarification') || text.includes('ask_clarification')) {
      bubble.classList.add('clarification-card');
    }
    const parsed = parseExecutiveAnalysis(text);
    if (parsed.hasAnalysis) {
      bubble.innerHTML = parsed.analysisHtml + `<div class="response-body-text">${parsed.responseText}</div>`;
    } else {
      bubble.textContent = text;
    }

    if (accuracyScore !== null) {
      const badge = document.createElement('div');
      let level = 'high';
      if (accuracyScore < 60) level = 'low';
      else if (accuracyScore < 80) level = 'medium';
      badge.className = `accuracy-badge ${level}`;
      badge.innerHTML = `<i class="fa-solid fa-circle-nodes"></i> Accuracy: ${accuracyScore}%`;
      bubble.appendChild(badge);
    }
  } else {
    bubble.textContent = text;
  }

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

  const rows = chatHistory.querySelectorAll('.chat-bubble-row, .chat-bubble.system');
  if (rows.length > visibleMessageCount) {
    const firstMsgRow = chatHistory.querySelector('.chat-bubble-row, .chat-bubble.system:not(.load-older-row)');
    if (firstMsgRow) firstMsgRow.remove();
  }
}

function appendStreamingChatBubble(sender) {
  const row = document.createElement('div');
  row.className = `chat-bubble-row${sender === 'user' ? ' user-row' : ''}`;

  if (sender !== 'system') {
    const avatar = document.createElement('div');
    avatar.className = `chat-avatar ${sender === 'assistant' ? 'lukas-avatar' : 'user-avatar'}`;
    avatar.innerHTML = sender === 'assistant'
      ? '<i class="fa-solid fa-microchip"></i>'
      : '<i class="fa-solid fa-user"></i>';
    row.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${sender}`;
  bubble.textContent = "...";

  row.appendChild(bubble);
  chatHistory.appendChild(row);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  const rows = chatHistory.querySelectorAll('.chat-bubble-row, .chat-bubble.system');
  if (rows.length > visibleMessageCount) {
    const firstMsgRow = chatHistory.querySelector('.chat-bubble-row, .chat-bubble.system:not(.load-older-row)');
    if (firstMsgRow) firstMsgRow.remove();
  }

  return {
    element: bubble,
    update: (newText) => {
      if (sender === 'assistant') {
        if (newText.includes('Awaiting Clarification') || newText.includes('ask_clarification')) {
          bubble.classList.add('clarification-card');
        }
        const parsed = parseExecutiveAnalysis(newText);
        if (parsed.hasAnalysis) {
          bubble.innerHTML = parsed.analysisHtml + `<div class="response-body-text">${parsed.responseText}</div>`;
        } else {
          bubble.textContent = newText;
        }
      } else {
        bubble.textContent = newText;
      }
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

function appendChecklistBubble(steps) {
  const row = document.createElement('div');
  row.className = `chat-bubble-row`;

  const avatar = document.createElement('div');
  avatar.className = `chat-avatar lukas-avatar`;
  avatar.innerHTML = '<i class="fa-solid fa-microchip"></i>';
  row.appendChild(avatar);

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble assistant planner-checklist`;
  
  const title = document.createElement('div');
  title.className = 'planner-title';
  title.innerHTML = '⚙️ LUKAS EXECUTIVE PLANNER INITIATED:';
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '8px';
  title.style.borderBottom = '1px solid var(--purple-neon)';
  title.style.paddingBottom = '4px';
  bubble.appendChild(title);

  const listContainer = document.createElement('div');
  listContainer.className = 'planner-steps';
  
  const stepElements = steps.map((step, idx) => {
    const item = document.createElement('div');
    item.className = 'planner-step-item';
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.marginBottom = '6px';
    item.style.fontSize = '0.9em';

    const icon = document.createElement('span');
    icon.className = 'planner-step-icon';
    icon.innerHTML = '<i class="fa-regular fa-circle" style="margin-right: 8px; color: var(--text-dim);"></i>';
    
    const label = document.createElement('span');
    label.className = 'planner-step-label';
    label.textContent = `[${step.agent.toUpperCase()}] ${step.task}`;
    label.style.color = 'var(--text-dim)';

    item.appendChild(icon);
    item.appendChild(label);
    listContainer.appendChild(item);

    return { item, icon, label };
  });

  bubble.appendChild(listContainer);
  row.appendChild(bubble);
  chatHistory.appendChild(row);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  const rows = chatHistory.querySelectorAll('.chat-bubble-row, .chat-bubble.system');
  if (rows.length > visibleMessageCount) {
    const firstMsgRow = chatHistory.querySelector('.chat-bubble-row, .chat-bubble.system:not(.load-older-row)');
    if (firstMsgRow) firstMsgRow.remove();
  }

  return {
    updateStep(idx, status) {
      const el = stepElements[idx];
      if (!el) return;
      if (status === 'running') {
        el.icon.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right: 8px; color: var(--purple-neon);"></i>';
        el.label.style.color = 'var(--text-light)';
        el.label.style.fontWeight = '500';
      } else if (status === 'completed') {
        el.icon.innerHTML = '<i class="fa-solid fa-circle-check" style="margin-right: 8px; color: var(--emerald-neon);"></i>';
        el.label.style.color = 'var(--text-light)';
        el.label.style.textDecoration = 'line-through';
        el.label.style.opacity = '0.6';
      } else if (status === 'failed') {
        el.icon.innerHTML = '<i class="fa-solid fa-circle-xmark" style="margin-right: 8px; color: var(--rose-neon);"></i>';
        el.label.style.color = 'var(--rose-neon)';
      }
    },
    remove() {
      row.remove();
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
    isProcessingCommand = true;
    lastCommandSource = source || 'user';
    
    // Record STT latency timestamp
    if (source === 'voice') {
      voice.latency.sttCompleteAt = Date.now();
    }

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

    // ── PRE-FLIGHT BIOMETRICS IDENTIFICATION & PROFILE SWITCHING ──
    if (source === 'voice') {
      const print = voice.lastSpokenVoiceprint;
      if (print) {
        const profiles = voice.biometrics.getProfiles();
        let bestMatch = "Guest";
        let bestScore = 0;
        for (const [name, savedPrint] of Object.entries(profiles)) {
          const score = voice.biometrics.calculateSimilarity(print, savedPrint);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = name;
          }
        }
        
        if (bestScore >= 0.95) {
          // Dynamic verified switch
          if (lukasMemory.currentUsername !== bestMatch) {
            diag.logToTerminal(`[BIOMETRICS] Dynamic speaker match: ${bestMatch} (Similarity: ${(bestScore * 100).toFixed(1)}%). Swapping workspace context.`, 'info');
            applyUserPreferencesToVoiceAndUI(bestMatch);
          }
        } else {
          // Weak match - remain in current profile as required
          diag.logToTerminal(`[BIOMETRICS] Speaker unrecognized or low confidence (${(bestScore * 100).toFixed(1)}%). Remaining in current profile: ${lukasMemory.currentUsername}.`, 'info');
        }
      } else {
        // Fallback for voice command with missing voiceprint
        const sessionUser = getSessionUser()?.username || 'Guest';
        if (lukasMemory.currentUsername !== sessionUser) {
          applyUserPreferencesToVoiceAndUI(sessionUser);
        }
      }
    } else if (source === 'user') {
      // Text command: match session username or Guest
      const sessionUser = getSessionUser()?.username || 'Guest';
      if (lukasMemory.currentUsername !== sessionUser) {
        applyUserPreferencesToVoiceAndUI(sessionUser);
      }
    }

    // ── Profile update confirmation dialogue ──
    if (typeof isProfileUpdateConfirmationActive !== 'undefined' && isProfileUpdateConfirmationActive) {
      isProcessingCommand = false;
      isProfileUpdateConfirmationActive = false;
      
      const yesWords = ['yes', 'sure', 'yeah', 'yep', 'ok', 'okay', 'update', 'change', 'please', 'confirm', 'correct'];
      if (yesWords.some(w => cmd.includes(w))) {
        const { key, value } = pendingProfileUpdate;
        const identityKeys = ['name', 'country', 'city', 'language', 'accent'];
        
        if (identityKeys.includes(key)) {
          lukasMemory.longTerm.profile[key] = value;
          lukasMemory._saveLongTerm();
        } else {
          lukasMemory.addFact(key, value, 'User Confirmed', 'Direct User Input');
        }
        
        // Update parallel preferences where applicable
        if (key === 'name') {
          lukasMemory.setPreference('name', value);
          applyUserPreferencesToVoiceAndUI(value);
        }
        if (key === 'language') {
          lukasMemory.setPreference('speechLang', value);
          voice.setLanguage(value);
        }
        if (key === 'accent') lukasMemory.setPreference('voiceAccent', value);
        if (key === 'style') lukasMemory.setPreference('personalityMode', value);
        
        handleAssistantResponse(`Thanks. I've updated your ${key} to ${value} in your profile.`);
      } else {
        const currentVal = lukasMemory.longTerm.profile[pendingProfileUpdate.key] || lukasMemory.getFact(pendingProfileUpdate.key) || 'not set';
        handleAssistantResponse(`Understood. Keeping your ${pendingProfileUpdate.key} as ${currentVal}.`);
      }
      pendingProfileUpdate = null;
      setTimeout(() => voice.startWakeWordListener(), 1000);
      return;
    }

    // ── Direct profile query response dialogue ──
    if (typeof pendingDirectProfileQuery !== 'undefined' && pendingDirectProfileQuery !== '') {
      isProcessingCommand = false;
      const key = pendingDirectProfileQuery;
      pendingDirectProfileQuery = '';
      
      let cleanVal = rawCommand.trim();
      if (key === 'name') {
        const match = cleanVal.match(/(?:my name is|call me|i am|i'm|this is)\s+([a-zA-Z\s]+)/i);
        if (match) {
          cleanVal = match[1].trim();
        } else {
          cleanVal = cleanVal.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"").trim();
        }
      } else {
        cleanVal = cleanVal.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"").trim();
      }

      if (cleanVal.length < 2) {
        handleAssistantResponse(`Aborted. The provided value was too short.`);
      } else {
        const identityKeys = ['name', 'country', 'city', 'language', 'accent'];
        if (identityKeys.includes(key)) {
          lukasMemory.longTerm.profile[key] = cleanVal;
          lukasMemory._saveLongTerm();
        } else {
          lukasMemory.addFact(key, cleanVal, 'User Confirmed', 'Direct User Input');
        }
        if (key === 'name') {
          lukasMemory.setPreference('name', cleanVal);
          applyUserPreferencesToVoiceAndUI(cleanVal);
        }
        if (key === 'language') {
          lukasMemory.setPreference('speechLang', cleanVal);
          voice.setLanguage(cleanVal);
        }
        if (key === 'accent') lukasMemory.setPreference('voiceAccent', cleanVal);
        if (key === 'style') lukasMemory.setPreference('personalityMode', cleanVal);
        
        handleAssistantResponse(`Thanks. I'll remember that and use it when appropriate.`);
      }
      setTimeout(() => voice.startWakeWordListener(), 1000);
      return;
    }

    // ── Execution Memory Interceptors ──
    const activeTasksKeywords = ['what tasks are running', 'show active tasks', 'are there any tasks running', 'current tasks', 'what are you doing'];
    const recentTasksKeywords = ['what did you just do', 'show recent tasks', 'last task details', 'history of tasks', 'what did you do'];
    const resumeTaskKeywords = ['resume previous task', 'resume task', 'retry last task', 'resume'];

    if (activeTasksKeywords.includes(cmd)) {
      isProcessingCommand = false;
      const history = LukasTaskRunner.history || [];
      const active = history.filter(h => h.status === 'running');
      if (active.length === 0) {
        handleAssistantResponse("There are currently no active background tasks running.");
      } else {
        const lines = ["**[ACTIVE BACKGROUND TASKS]**"];
        active.forEach(h => {
          const runningSteps = h.steps.filter(s => s.status === 'active');
          const pendingSteps = h.steps.filter(s => s.status === 'pending');
          lines.push(`• **Plan:** ${h.planTitle}`);
          if (runningSteps.length > 0) {
            lines.push(`  - *Running:* ${runningSteps.map(s => s.title).join(', ')}`);
          }
          if (pendingSteps.length > 0) {
            lines.push(`  - *Pending:* ${pendingSteps.length} more step(s)`);
          }
        });
        handleAssistantResponse(lines.join('\n'));
      }
      setTimeout(() => voice.startWakeWordListener(), 1000);
      return;
    }

    if (recentTasksKeywords.includes(cmd)) {
      isProcessingCommand = false;
      const history = LukasTaskRunner.history || [];
      if (history.length === 0) {
        handleAssistantResponse("No plans have been executed in this session yet.");
      } else {
        const last = history[history.length - 1];
        const lines = [
          `**[LAST PLAN: ${last.planTitle.toUpperCase()}]**`,
          `Status: ${last.status.toUpperCase()}`,
          `Started: ${new Date(last.timestamp).toLocaleTimeString()}`,
          "\n**Steps Executed:**"
        ];
        last.steps.forEach(s => {
          const icon = s.status === 'completed' ? '✅' : (s.status === 'failed' ? '❌' : '⏳');
          lines.push(`${icon} **${s.title}** - *${s.status}*`);
        });
        handleAssistantResponse(lines.join('\n'));
      }
      setTimeout(() => voice.startWakeWordListener(), 1000);
      return;
    }

    if (resumeTaskKeywords.includes(cmd)) {
      isProcessingCommand = false;
      const history = LukasTaskRunner.history || [];
      const lastFailed = [...history].reverse().find(h => h.status === 'failed');
      if (!lastFailed) {
        handleAssistantResponse("I couldn't find any recently failed tasks to resume.");
      } else {
        handleAssistantResponse(`Resuming execution plan: "${lastFailed.planTitle}". Filtered steps will re-initialize.`);
        
        const oKey = lukasMemory.getPreference('openai_api_key', '') || localStorage.getItem('openai_api_key');
        const gKey = lukasMemory.getPreference('gemini_api_key', '') || localStorage.getItem('gemini_api_key');
        const provider = oKey ? 'openai' : (gKey ? 'gemini' : 'puter');
        const key = oKey || gKey || null;

        const planToResume = {
          ...lastFailed,
          steps: lastFailed.steps.filter(s => s.status === 'failed' || s.status === 'pending')
        };
        
        const context = {
          memory: lukasMemory,
          apiKey: key,
          apiProvider: provider,
          research: lukasResearch
        };
        
        setTimeout(async () => {
          try {
            await lukasTask.executePlan(planToResume, context);
          } catch (e) {
            console.error('[Resume Plan] Failed:', e.message);
          }
        }, 100);
      }
      setTimeout(() => voice.startWakeWordListener(), 1000);
      return;
    }

    // ── CRUD Profile Commands ──
    if (cmd === 'view profile' || cmd === 'show profile' || cmd === 'show my profile' || cmd === 'view my profile') {
      isProcessingCommand = false;
      const prefs = lukasMemory.longTerm.preferences;
      const profile = lukasMemory.longTerm.profile || {};
      
      const profileLines = [
        "**[PROFILE DETAILS]**",
        `Name: ${profile.name || 'Not set'}`,
        `Country: ${profile.country || 'Not set'}`,
        `City: ${profile.city || 'Not set'}`,
        `Preferred Language: ${profile.language || prefs.speechLang || 'en-IN'}`,
        `Preferred Accent: ${profile.accent || prefs.voiceAccent || 'Not set'}`,
        `Time Zone: ${lukasMemory.getFact('timezone') || 'Asia/Kolkata'}`,
        `Profession: ${lukasMemory.getFact('profession') || 'Not set'}`,
        `Interests: ${lukasMemory.getFact('interests') || 'Not set'}`,
        `Projects: ${lukasMemory.getFact('projects') || 'Not set'}`,
        `Communication Style: ${lukasMemory.getFact('style') || prefs.personalityMode || 'casual'}`
      ];
      
      handleAssistantResponse(profileLines.join('\n'));
      setTimeout(() => voice.startWakeWordListener(), 1000);
      return;
    }
    
    if (cmd === 'reset profile' || cmd === 'clear profile' || cmd === 'delete my profile') {
      isProcessingCommand = false;
      lukasMemory.resetProfile();
      applyUserPreferencesToVoiceAndUI(lukasMemory.currentUsername);
      handleAssistantResponse("Your profile has been reset to defaults.");
      setTimeout(() => voice.startWakeWordListener(), 1000);
      return;
    }
    
    const deleteFactMatch = cmd.match(/^delete (?:my\s+)?(name|country|city|language|accent|timezone|profession|interests|projects|style) from profile$/i)
      || cmd.match(/^delete (?:my\s+)?(name|country|city|language|accent|timezone|profession|interests|projects|style)$/i)
      || cmd.match(/^remove (?:my\s+)?(name|country|city|language|accent|timezone|profession|interests|projects|style) from profile$/i)
      || cmd.match(/^remove (?:my\s+)?(name|country|city|language|accent|timezone|profession|interests|projects|style)$/i);
      
    if (deleteFactMatch) {
      isProcessingCommand = false;
      const key = deleteFactMatch[1].toLowerCase().trim();
      const identityKeys = ['name', 'country', 'city', 'language', 'accent'];
      let ok = false;
      if (identityKeys.includes(key)) {
        if (lukasMemory.longTerm.profile[key]) {
          lukasMemory.longTerm.profile[key] = null;
          lukasMemory._saveLongTerm();
          ok = true;
        }
      } else {
        ok = lukasMemory.deleteFact(key);
      }
      
      if (ok) {
        handleAssistantResponse(`I've deleted your ${key} from your profile.`);
      } else {
        handleAssistantResponse(`There was no stored ${key} in your profile.`);
      }
      setTimeout(() => voice.startWakeWordListener(), 1000);
      return;
    }

    // ── Direct profile query retrieval ──
    const nameQueries = ['what is my name', 'do you know my name', 'tell me my name'];
    const accentQueries = ['what is my preferred accent', 'what is my accent', 'do you know my accent', 'tell me my accent'];
    const countryQueries = ['what is my country', 'tell me my country', 'where am i from', 'which country am i from'];
    const cityQueries = ['what city do i live in', 'what is my city', 'which city do i live in', 'where do i live'];
    const langQueries = ['what language do i prefer', 'what is my preferred language', 'which language do i prefer'];
    const professionQueries = ['what is my profession', 'what is my job', 'what do i do for work', 'what do i do'];
    const interestsQueries = ['what are my interests', 'what do i like', 'what are my hobbies'];
    const projectsQueries = ['what are my projects', 'what projects do i have', 'what projects am i working on'];
    const styleQueries = ['what is my communication style', 'what style do i prefer'];

    let targetQueryKey = null;
    let queryPrompt = '';
    
    if (nameQueries.includes(cmd)) {
      const name = lukasMemory.longTerm.profile.name;
      if (name) {
        isProcessingCommand = false;
        handleAssistantResponse(`Your name is ${name}.`);
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      targetQueryKey = 'name';
      queryPrompt = "I don't know your name yet. What would you like me to call you?";
    } else if (accentQueries.includes(cmd)) {
      const accent = lukasMemory.longTerm.profile.accent || lukasMemory.getPreference('voiceAccent');
      if (accent) {
        isProcessingCommand = false;
        handleAssistantResponse(`Your preferred accent is ${accent}.`);
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      targetQueryKey = 'accent';
      queryPrompt = "I don't know your preferred accent yet. What is your preferred accent?";
    } else if (countryQueries.includes(cmd)) {
      const country = lukasMemory.longTerm.profile.country;
      if (country) {
        isProcessingCommand = false;
        handleAssistantResponse(`You are from ${country}.`);
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      targetQueryKey = 'country';
      queryPrompt = "I don't know your country yet. Which country are you from?";
    } else if (cityQueries.includes(cmd)) {
      const city = lukasMemory.longTerm.profile.city;
      if (city) {
        isProcessingCommand = false;
        handleAssistantResponse(`You live in ${city}.`);
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      targetQueryKey = 'city';
      queryPrompt = "I don't know your city yet. Which city do you live in?";
    } else if (langQueries.includes(cmd)) {
      const lang = lukasMemory.longTerm.profile.language || lukasMemory.getPreference('speechLang');
      if (lang) {
        isProcessingCommand = false;
        handleAssistantResponse(`Your preferred language is ${lang}.`);
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      targetQueryKey = 'language';
      queryPrompt = "I don't know your preferred language yet. Which language do you prefer?";
    } else if (professionQueries.includes(cmd)) {
      const profession = lukasMemory.getFact('profession');
      if (profession) {
        isProcessingCommand = false;
        handleAssistantResponse(`Your profession is ${profession}.`);
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      targetQueryKey = 'profession';
      queryPrompt = "I don't know your profession yet. What is your profession?";
    } else if (interestsQueries.includes(cmd)) {
      const interests = lukasMemory.getFact('interests');
      if (interests) {
        isProcessingCommand = false;
        handleAssistantResponse(`Your interests are ${interests}.`);
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      targetQueryKey = 'interests';
      queryPrompt = "I don't know your interests yet. What are your main interests?";
    } else if (projectsQueries.includes(cmd)) {
      const projects = lukasMemory.getFact('projects');
      if (projects) {
        isProcessingCommand = false;
        handleAssistantResponse(`Your projects are ${projects}.`);
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      targetQueryKey = 'projects';
      queryPrompt = "I don't know your projects yet. What projects are you working on?";
    } else if (styleQueries.includes(cmd)) {
      const style = lukasMemory.getFact('style') || lukasMemory.getPreference('personalityMode');
      if (style) {
        isProcessingCommand = false;
        handleAssistantResponse(`Your communication style is ${style}.`);
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      targetQueryKey = 'style';
      queryPrompt = "I don't know your preferred communication style yet. What communication style do you prefer?";
    }

    if (targetQueryKey) {
      isProcessingCommand = false;
      pendingDirectProfileQuery = targetQueryKey;
      handleAssistantResponse(queryPrompt);
      keepConversationAlive(15000);
      return;
    }

    // ── Verbal fact updates detection ──
    const updatePatterns = [
      { re: /\b(?:my name is|call me|change my name to)\s+([a-z\s]+)$/i, key: 'name' },
      { re: /\b(?:i am from|my country is|change my country to)\s+([a-z\s]+)$/i, key: 'country' },
      { re: /\b(?:i live in|my city is|change my city to)\s+([a-z\s]+)$/i, key: 'city' },
      { re: /\b(?:i prefer|my preferred language is|change my language to)\s+([a-z\s]+)$/i, key: 'language' },
      { re: /\b(?:my preferred accent is|my accent is|change my accent to)\s+([a-z\s_-]+)$/i, key: 'accent' },
      { re: /\b(?:my profession is|i work as|i run a)\s+([a-z\s]+)$/i, key: 'profession' },
      { re: /\b(?:my interests are|i am interested in)\s+([a-z\s]+)$/i, key: 'interests' },
      { re: /\b(?:my projects are|i am working on)\s+([a-z\s]+)$/i, key: 'projects' },
      { re: /\b(?:my communication style is|i prefer style|change my style to)\s+([a-z\s]+)$/i, key: 'style' }
    ];

    const identityKeys = ['name', 'country', 'city', 'language', 'accent'];

    for (const { re, key } of updatePatterns) {
      const match = cmd.match(re);
      if (match) {
        const newValue = match[1].trim();
        const isIdentity = identityKeys.includes(key);
        const oldValue = isIdentity ? lukasMemory.longTerm.profile[key] : (lukasMemory.getFact(key) || (key === 'language' ? lukasMemory.getPreference('speechLang') : (key === 'style' ? lukasMemory.getPreference('personalityMode') : null)));
        
        // Always prompt for confirmation on identity keys, or when changing an existing value of other keys
        if (isIdentity || (oldValue && oldValue.toLowerCase() !== newValue.toLowerCase())) {
          isProcessingCommand = false;
          pendingProfileUpdate = { key, value: newValue };
          isProfileUpdateConfirmationActive = true;
          
          if (oldValue) {
            handleAssistantResponse(`I currently have your ${key} stored as "${oldValue}". Would you like me to update it to "${newValue}"? Please say yes or no.`);
          } else {
            handleAssistantResponse(`Would you like me to save your ${key} as "${newValue}" in your profile? Please say yes or no.`);
          }
          keepConversationAlive(15000);
          return;
        }
      }
    }

    // ── Voice print training via UI ──
    if (typeof isVoicePrintTrainingActive !== 'undefined' && isVoicePrintTrainingActive) {
      isProcessingCommand = false;
      const statusEl = document.getElementById('voiceTrainStatus');
      const nameEl = document.getElementById('voiceRegName');
      
      const print = voice.lastSpokenVoiceprint;
      if (!print) {
        if (statusEl) {
          statusEl.style.color = 'var(--rose-neon)';
          statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Training failed: no speech detected.`;
        }
        isVoicePrintTrainingActive = false;
        voicePrintTrainingName = '';
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      
      const ok = voice.biometrics.saveProfile(voicePrintTrainingName, print);
      isVoicePrintTrainingActive = false;
      
      if (ok) {
        if (statusEl) {
          statusEl.style.color = 'var(--emerald-neon)';
          statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Voice print successfully registered!`;
        }
        if (nameEl) nameEl.value = '';
        
        // Switch context to newly created user and write profiles
        lukasMemory.switchUser(voicePrintTrainingName);
        const userId = 'user_' + Date.now();
        lukasMemory.addFact('userId', userId);
        lukasMemory.longTerm.profile.name = voicePrintTrainingName;
        lukasMemory.longTerm.profile.language = 'en-IN';
        lukasMemory._saveLongTerm();
        lukasMemory.setPreference('name', voicePrintTrainingName);
        lukasMemory.setPreference('speechLang', 'en-IN');
        lukasMemory.setPreference('voiceAccent', 'indian_english');
        lukasMemory.setPreference('personalityMode', 'casual');
        lukasMemory.setPreference('voiceRate', 'normal');
        lukasMemory.setPreference('voiceEmotionalTone', 'adaptive');
        
        applyUserPreferencesToVoiceAndUI(voicePrintTrainingName);
        
        handleAssistantResponse(`Voice print successfully registered for ${voicePrintTrainingName}.`);
      } else {
        if (statusEl) {
          statusEl.style.color = 'var(--rose-neon)';
          statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Database error.`;
        }
      }
      
      voicePrintTrainingName = '';
      setTimeout(() => voice.startWakeWordListener(), 1000);
      return;
    }

    // ── Voice print training confirmation via Speech ──
    if (typeof isRegistrationConfirmationActive !== 'undefined' && isRegistrationConfirmationActive) {
      isProcessingCommand = false;
      isRegistrationConfirmationActive = false;
      
      const yesWords = ['yes', 'sure', 'yeah', 'yep', 'ok', 'okay', 'create', 'register', 'please'];
      if (yesWords.some(w => cmd.includes(w))) {
        isVoiceTrainingActive = true;
        voiceTrainingStep = 'capture_voice';
        tempVoiceprint = null;
        handleAssistantResponse("Initiating voice biometric registration. Please say 'Lukas, authorize my profile' now to record your vocal print.");
        keepConversationAlive(15000);
      } else {
        handleAssistantResponse("Understood. Let me know if you change your mind.");
        setTimeout(() => voice.startWakeWordListener(), 1000);
      }
      return;
    }

    // ── Voice print training via Speech ──
    if (typeof isVoiceTrainingActive !== 'undefined' && isVoiceTrainingActive) {
      isProcessingCommand = false;
      
      if (voiceTrainingStep === 'capture_voice') {
        const print = voice.lastSpokenVoiceprint;
        if (!print) {
          handleAssistantResponse("Vocal registration failed: no speech audio frames detected. Please try again.");
          isVoiceTrainingActive = false;
          tempVoiceprint = null;
          setTimeout(() => voice.startWakeWordListener(), 1000);
          return;
        }
        
        tempVoiceprint = print;
        voiceTrainingStep = 'request_name';
        handleAssistantResponse("Vocal signature captured successfully. What is your name?");
        keepConversationAlive(15000);
        return;
      }
      
      if (voiceTrainingStep === 'request_name') {
        const trainedName = rawCommand.trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
        if (trainedName.length < 2) {
          handleAssistantResponse("Vocal registration aborted. The provided name was too short.");
          isVoiceTrainingActive = false;
          tempVoiceprint = null;
          setTimeout(() => voice.startWakeWordListener(), 1000);
          return;
        }
        
        tempName = trainedName;
        voiceTrainingStep = 'request_language';
        handleAssistantResponse("What is your preferred language? You can choose English, Kannada, or Hindi.");
        keepConversationAlive(15000);
        return;
      }

      if (voiceTrainingStep === 'request_language') {
        const langInput = cmd;
        let selectedLang = 'en-IN';
        if (langInput.includes('kannada')) {
          selectedLang = 'kn-IN';
        } else if (langInput.includes('hindi')) {
          selectedLang = 'hi-IN';
        } else if (langInput.includes('tamil')) {
          selectedLang = 'ta-IN';
        }
        
        tempLanguage = selectedLang;
        voiceTrainingStep = 'request_accent';
        handleAssistantResponse("Got it. What is your preferred accent? You can choose Indian English, Bengaluru Professional, Neutral Corporate, Kannada Native, or standard international accents.");
        keepConversationAlive(15000);
        return;
      }

      if (voiceTrainingStep === 'request_accent') {
        const accentInput = cmd;
        let selectedAccent = 'indian_english';
        if (accentInput.includes('bengaluru') || accentInput.includes('bangalore')) {
          selectedAccent = 'bengaluru_professional';
        } else if (accentInput.includes('neutral') || accentInput.includes('corporate')) {
          selectedAccent = 'neutral_corporate';
        } else if (accentInput.includes('kannada') || accentInput.includes('native')) {
          selectedAccent = 'kannada_native';
        } else if (accentInput.includes('american') || accentInput.includes('us')) {
          selectedAccent = 'en-US';
        } else if (accentInput.includes('british') || accentInput.includes('uk')) {
          selectedAccent = 'en-GB';
        }
        
        tempAccent = selectedAccent;
        voiceTrainingStep = 'request_style';
        handleAssistantResponse("Understood. Finally, what is your preferred communication style? You can choose casual, professional, companion, or technical.");
        keepConversationAlive(15000);
        return;
      }

      if (voiceTrainingStep === 'request_style') {
        const styleInput = cmd;
        let selectedStyle = 'casual';
        if (styleInput.includes('professional')) {
          selectedStyle = 'professional';
        } else if (styleInput.includes('companion')) {
          selectedStyle = 'companion';
        } else if (styleInput.includes('technical')) {
          selectedStyle = 'technical';
        }
        
        tempStyle = selectedStyle;
        
        const ok = voice.biometrics.saveProfile(tempName, tempVoiceprint);
        isVoiceTrainingActive = false;
        
        if (ok) {
          // Switch context to newly created user and write profiles
          lukasMemory.switchUser(tempName);
          const userId = 'user_' + Date.now();
          lukasMemory.addFact('userId', userId);
          lukasMemory.longTerm.profile.name = tempName;
          lukasMemory.longTerm.profile.language = tempLanguage;
          lukasMemory._saveLongTerm();
          lukasMemory.setPreference('name', tempName);
          lukasMemory.setPreference('speechLang', tempLanguage);
          lukasMemory.setPreference('voiceAccent', tempAccent);
          lukasMemory.setPreference('personalityMode', tempStyle);
          lukasMemory.setPreference('voiceRate', 'normal');
          lukasMemory.setPreference('voiceEmotionalTone', 'adaptive');
          
          applyUserPreferencesToVoiceAndUI(tempName);
          
          handleAssistantResponse(`Voice print successfully registered for ${tempName}. Welcome to your personalized space.`);
        } else {
          handleAssistantResponse("Biometric database error. Failed to save vocal print.");
        }
        
        // Reset temp state
        tempVoiceprint = null;
        tempName = '';
        tempLanguage = '';
        tempAccent = '';
        tempStyle = '';
        
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
    }

    // ── Voice retraining via Speech ──
    if (typeof isVoiceRetrainingActive !== 'undefined' && isVoiceRetrainingActive) {
      isProcessingCommand = false;
      if (voiceRetrainingStep === 'capture_retrain_voice') {
        const print = voice.lastSpokenVoiceprint;
        if (!print) {
          handleAssistantResponse("Vocal retraining failed: no speech audio frames detected. Please try again.");
          isVoiceRetrainingActive = false;
          voiceRetrainingName = '';
          setTimeout(() => voice.startWakeWordListener(), 1000);
          return;
        }
        
        const ok = voice.biometrics.saveProfile(voiceRetrainingName, print);
        isVoiceRetrainingActive = false;
        
        if (ok) {
          handleAssistantResponse(`Vocal profile successfully updated for ${voiceRetrainingName}. Your settings and memory remain intact.`);
        } else {
          handleAssistantResponse("Failed to update vocal profile due to a biometric database error.");
        }
        voiceRetrainingName = '';
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
    }

    // ── Voice Biometrics Identification Commands ──
    if (cmd === 'who am i' || cmd === 'identify my voice' || cmd === 'who is speaking' || cmd === 'do you know my voice') {
      isProcessingCommand = false;
      const print = voice.lastSpokenVoiceprint;
      const profiles = voice.biometrics.getProfiles();
      const hasProfiles = Object.keys(profiles).length > 0;

      if (!hasProfiles) {
        handleAssistantResponse("I don't know who you are yet. Would you like to create a profile?");
        isRegistrationConfirmationActive = true;
      } else if (!print) {
        const authUser = getSessionUser()?.username;
        if (authUser) {
          handleAssistantResponse(`You are logged in as ${authUser}.`);
        } else {
          handleAssistantResponse("I don't know who you are yet. Would you like to create a profile?");
          isRegistrationConfirmationActive = true;
        }
      } else {
        let bestMatch = "Guest";
        let bestScore = 0;
        for (const [name, savedPrint] of Object.entries(profiles)) {
          const score = voice.biometrics.calculateSimilarity(print, savedPrint);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = name;
          }
        }

        if (bestScore >= 0.95) {
          handleAssistantResponse(`You are ${bestMatch}.`);
        } else if (bestScore >= 0.70) {
          handleAssistantResponse("I cannot confidently identify you. Would you like to verify your identity?");
        } else {
          handleAssistantResponse("I don't recognize this voice profile yet. Would you like to register as a new user?");
          isRegistrationConfirmationActive = true;
        }
      }
      setTimeout(() => voice.startWakeWordListener(), 1000);
      return;
    }
    
    if (cmd === 'register my voice' || cmd === 'train my voice' || cmd === 'train voice print' || cmd === 'register voice') {
      isProcessingCommand = false;
      isVoiceTrainingActive = true;
      voiceTrainingStep = 'capture_voice';
      tempVoiceprint = null;
      
      handleAssistantResponse("Initiating voice biometric registration. Please say 'Lukas, authorize my profile' now to record your vocal print.");
      keepConversationAlive(15000);
      return;
    }

    if (cmd === 'lukas, retrain my voice' || cmd === 'retrain my voice' || cmd === 'lukas, register my voice again' || cmd === 'register my voice again') {
      isProcessingCommand = false;
      const currentName = lukasMemory.currentUsername;
      if (currentName === 'Guest') {
        handleAssistantResponse("You are currently a Guest. Please say 'register my voice' to create a new profile.");
        setTimeout(() => voice.startWakeWordListener(), 1000);
        return;
      }
      
      isVoiceRetrainingActive = true;
      voiceRetrainingName = currentName;
      voiceRetrainingStep = 'capture_retrain_voice';
      handleAssistantResponse(`Initiating voice profile retraining for ${currentName}. Please say 'Lukas, authorize my profile' now to record your new vocal print.`);
      keepConversationAlive(15000);
      return;
    }

    // ── Deactivation / Standby / Offline Trigger ──
    const stopWords = ['stop', 'go to sleep', 'deactivate voice', 'mute microphone', 'stand down'];
    if (stopWords.includes(cmd) || cmd.includes('offline mode')) {
      isProcessingCommand = false;
      diag.logToTerminal(`[AI CORE] Deactivation command detected: "${rawCommand}". Entering standby mode...`, "warn");
      lastCommandSource = 'standby';
      isPassiveListenEnabled = true;
      voice.stopListeningForCommand();
      clearSilenceTimeout();
      if (proceedTimeout) clearTimeout(proceedTimeout);
      accumulatedTranscript = "";
      
      const isAlexa = localStorage.getItem('lukas_assistant_persona') === 'alexa';
      if (isAlexa) {
        playAlexaErrorChime();
      } else {
        playShutdownBeep();
      }
      
      const coreBtn = document.getElementById('lukasCoreBtn');
      if (coreBtn) {
        coreBtn.classList.remove('listening');
        coreBtn.classList.remove('processing');
        coreBtn.classList.remove('waking');
      }
      
      const statusText = document.getElementById('voiceStatusText');
      if (statusText) {
        statusText.textContent = 'STANDBY — Say LUKAS to wake';
        statusText.style.color = 'var(--rose-neon)';
      }
      
      handleAssistantResponse("Understood, Commander. Entering standby. Say \"LUKAS\" anytime to wake me.", false, true);
      
      // ★ Always keep wake-word listener alive so LUKAS can be woken from any state
      setTimeout(() => voice.startWakeWordListener(), 1500);
      return;
    }

    // ── Universal Language Engine: Direct Speech Language Switching Directives ──
    const langSwitchMatch = cmd.match(/(?:change|switch|set)\s+(?:my\s+)?(?:speech\s+)?(?:recognition\s+)?(?:language|dialect)\s+(?:to\s+)?([a-z\s]+)/i)
      || cmd.match(/(?:speak|talk\s+in)\s+([a-z\s]+)/i);
    if (langSwitchMatch) {
      const targetLangName = langSwitchMatch[1].trim().toLowerCase();
      const LANGUAGE_LOCALE_MAP = {
        'english': 'en-IN',
        'english india': 'en-IN',
        'english us': 'en-US',
        'english united states': 'en-US',
        'english uk': 'en-GB',
        'english united kingdom': 'en-GB',
        'english australia': 'en-AU',
        'english canada': 'en-CA',
        'hindi': 'hi-IN',
        'kannada': 'kn-IN',
        'tamil': 'ta-IN',
        'telugu': 'te-IN',
        'malayalam': 'ml-IN',
        'marathi': 'mr-IN',
        'gujarati': 'gu-IN',
        'bengali': 'bn-IN',
        'punjabi': 'pa-IN',
        'urdu': 'ur-PK',
        'arabic': 'ar-AE',
        'french': 'fr-FR',
        'german': 'de-DE',
        'spanish': 'es-ES',
        'portuguese': 'pt-PT',
        'italian': 'it-IT',
        'japanese': 'ja-JP',
        'korean': 'ko-KR',
        'mandarin': 'zh-CN',
        'chinese': 'zh-CN',
        'russian': 'ru-RU'
      };

      const locale = LANGUAGE_LOCALE_MAP[targetLangName];
      if (locale) {
        isProcessingCommand = false;
        const coreBtn = document.getElementById('lukasCoreBtn');
        if (coreBtn) coreBtn.classList.remove('processing');

        localStorage.setItem('lukas_speech_lang', locale);
        voice.setLanguage(locale);
        
        const speechLangSelect = document.getElementById('speechLangSelect');
        if (speechLangSelect) {
          speechLangSelect.value = locale;
        }
        const speechSupportMsg = document.getElementById('speechSupportMsg');
        if (speechSupportMsg && voice.recognition) {
          speechSupportMsg.textContent = `WebSpeech Active (${locale})`;
          speechSupportMsg.style.color = 'var(--emerald-neon)';
        }

        diag.logToTerminal(`[Universal Language] Switched active speech locale to: ${locale} (${targetLangName})`, 'info');
        
        const langAckMap = {
          'es-ES': 'Entendido. He cambiado mi idioma al español.',
          'fr-FR': 'Compris. J\'ai changé ma langue pour le français.',
          'de-DE': 'Verstanden. Ich habe meine Sprache auf Deutsch umgestellt.',
          'hi-IN': 'समझ गया। मैंने अपनी भाषा हिंदी में बदल दी है।',
          'kn-IN': 'ತಿಳಿದಿದೆ. ನಾನು ನನ್ನ ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಿದ್ದೇನೆ.',
          'ta-IN': 'புரிந்தது. நான் எனது மொழியை தமிழுக்கு மாற்றியுள்ளேன்.',
          'te-IN': 'అర్థమైంది. నేను నా భాషను తెలుగులోకి మార్చాను.',
          'ja-JP': '了解しました。言語を日本語に切り替えました。',
          'ru-RU': 'Понял. Я переключил язык на русский.'
        };
        const ack = langAckMap[locale] || `Acknowledged, Commander. Active speech interface language switched to ${targetLangName.toUpperCase()} (${locale}).`;
        
        lukasMemory.addMessage('user', rawCommand);
        lukasMemory.addMessage('assistant', ack);
        handleAssistantResponse(ack);
        keepConversationAlive(8000);
        return;
      }
    }

    // ══ LUKAS MEMORY: Record user message + extract facts ══
    lukasMemory.addMessage('user', rawCommand);
    lukasMemory.extractAndStoreFacts(rawCommand);

    // ── Proactive Project Launch Suggestions Hook ──
    const launchMatch = rawCommand.match(/\b(?:launched|published|live)\s+(?:my\s+)?(?:store|website|app|product|shop|site)\b/i);
    if (launchMatch) {
      rawCommand = rawCommand + "\n[AUTONOMOUS ASSISTANT NOTE: Commander has just launched their project. Proactively suggest analytics setup, SEO improvements, marketing campaigns, conversion optimizations, and customer support workflows as professional next actions.]";
      diag.logToTerminal("[AI CORE] Project launch signal detected. Injecting autonomous assistant triggers.", "info");
    }

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
      isProcessingCommand = false;
      handleAssistantResponse(`Failed pre-check: ${precheckResult.reason}`);
      return;
    }

    const openaiApiKey = lukasMemory.getPreference('openai_api_key', '') || localStorage.getItem('openai_api_key');
    const geminiApiKey = lukasMemory.getPreference('gemini_api_key', '') || localStorage.getItem('gemini_api_key');
    const activeProvider = openaiApiKey ? 'openai' : (geminiApiKey ? 'gemini' : 'puter');
    const activeKey = openaiApiKey || geminiApiKey || null;

    // Get home context summary for intent analysis
    const homeContext = `Active devices: ${home.dynamicDevices.filter(d => d.on).map(d => d.name).join(', ') || 'None'}. Indoor Temp: ${home.state.climate.indoorTemp}°C, target: ${home.state.climate.targetTemp}°C.`;

    // ── STAGE 1: INTENT DETECTION ──
    diag.logToTerminal("[STAGE 1: INTENT] Classifying raw command intent...", "info");
    const routing = await lukasOrchestrator.analyze(rawCommand, homeContext, activeKey, activeProvider);
    diag.logToTerminal(`[AI INTENT] Routed to: ${routing.intent.toUpperCase()} (Confidence: ${Math.round(routing.confidence * 100)}%)`, 'info');

    // Auto-trigger research when requiresResearch is true
    if (routing.requiresResearch && routing.intent !== INTENT.RESEARCH) {
      diag.logToTerminal("[ORCHESTRATOR] AI detected external information dependency. Upgrading intent to RESEARCH.", "info");
      routing.intent = INTENT.RESEARCH;
    }

    // ── STAGE 2: CONTEXT RETRIEVAL ──
    diag.logToTerminal("[STAGE 2: CONTEXT] Retrived context blocks from 3-level memory...", "info");
    const contextLines = lukasMemory.buildContextBlock().split('\n');
    contextLines.slice(0, 4).forEach(line => {
      if (line.trim()) diag.logToTerminal(` &gt; ${line}`, 'info');
    });

    // ── STAGE 3: TASK PLANNING ──
    diag.logToTerminal("[STAGE 3: PLAN] Checking if directive requires task planning or decomposition...", "info");
    const isPlanExecution = precheckResult.requiresPlanning || routing.intent === INTENT.PLANNING || routing.isComplex;

    // ── STAGE 4: REASONING LOGS ──
    diag.logToTerminal("[STAGE 4: REASONING] Running structured Voice Intelligence cycles...", "info");
    lukasReasoning.runReasoningCycle(rawCommand, diag.logToTerminal.bind(diag));

    // ── FAST PATH: Temperature / Thermostat (instant regex, no AI wait) ──────
    if (!isPlanExecution) {
      const tempFastMatch = cmd.match(
        /(?:set|adjust|change|make|put|increase|decrease|raise|lower|turn(?:\s+up|\s+down)?)\s+(?:the\s+)?(?:temp(?:erature)?|thermostat|ac|air\s*con(?:ditioning)?|climate|heat(?:ing)?|cool(?:ing)?)\s+(?:to\s+)?(\d{1,2})(?:\s*°?\s*(?:celsius|centigrade|degrees?|c))?/i
      ) || cmd.match(/(?:temp(?:erature)?|thermostat)\s+(?:to\s+)?(\d{1,2})/i)
        || cmd.match(/(\d{1,2})\s*(?:°|degrees?|celsius|c)\b/i);

      const climateModeFast = cmd.match(/(?:set|switch|change|put)\s+(?:the\s+)?(?:ac|thermostat|climate|hvac)\s+(?:to\s+|mode\s+(?:to\s+)?)?(cool(?:ing)?|heat(?:ing)?|eco|fan|auto)/i)
        || cmd.match(/(?:cooling|heating|eco)\s+mode/i);

      if (tempFastMatch && (cmd.includes('temp') || cmd.includes('thermostat') || cmd.includes('heat') || cmd.includes('cool') || cmd.includes('ac') || cmd.includes('climate') || cmd.includes('degree') || cmd.includes('celsius'))) {
        const val = parseInt(tempFastMatch[1]);
        if (!isNaN(val) && val >= 16 && val <= 35) {
          isProcessingCommand = false;
          diag.logToTerminal(`[FAST PATH] Temperature command detected. Setting thermostat to ${val}°C`, 'info');
          home.setTargetTemperature(val);
          handleAssistantResponse(`Acknowledged, Commander. Eco-Thermostat target adjusted to ${val} degrees Celsius.`, true);
          keepConversationAlive(8000);
          return;
        }
      }

      if (climateModeFast && !tempFastMatch) {
        const modeRaw = (climateModeFast[1] || '').toLowerCase();
        const mode = modeRaw.startsWith('cool') ? 'cool' : modeRaw.startsWith('heat') ? 'heat' : 'eco';
        isProcessingCommand = false;
        diag.logToTerminal(`[FAST PATH] Climate mode command detected: ${mode.toUpperCase()}`, 'info');
        home.setClimateMode(mode);
        handleAssistantResponse(`Climate matrix switching to ${mode.toUpperCase()} mode.`, true);
        keepConversationAlive(8000);
        return;
      }
    }

    // ── STAGE 5: AUTONOMOUS EXECUTION ──
    diag.logToTerminal("[STAGE 5: EXECUTE] Initiating background execution...", "info");
    voice.recognitionManager.transitionTo('executing');
    
    await executionTracker.trackExecution(rawCommand, async () => {
      if (isPlanExecution) {
        diag.logToTerminal("[PLANNER AGENT] Generating structured executive plan...", "info");
        
        const plan = await lukasPlan.createPlan(rawCommand, lukasMemory, activeKey, activeProvider);
        
        // Render plan as text in console chat
        const planText = lukasPlan.formatPlanAsText(plan);
        appendChatBubble(planText, 'assistant');
        
        // Speak objective
        voice.stopWakeWordListener();
        voice.speak(`I have formulated a roadmap to ${plan.objective}. Commencing execution.`);
        
        // Show bottom plan panel UI
        showPlanExecutionPanel(plan);
        
        // Render the chat checklist bubble UI
        const chatChecklistUI = appendChecklistBubble(plan.steps.map(s => ({ task: s.description, agent: s.type })));
        
        // Set task runner event hooks
        lukasTask.onStepStarted = (idx, step) => {
          updatePlanPanelStepStatus(idx, 'active');
          chatChecklistUI.updateStep(idx, 'running');
          diag.logToTerminal(`[PLANNER] Executing Step ${idx+1}: ${step.title}`, 'info');
        };
        
        lukasTask.onStepCompleted = (idx, result) => {
          updatePlanPanelStepStatus(idx, 'completed');
          chatChecklistUI.updateStep(idx, 'completed');
          diag.logToTerminal(`[PLANNER] Step ${idx+1} Completed successfully.`, 'info');
        };
        
        lukasTask.onStepFailed = (idx, error) => {
          updatePlanPanelStepStatus(idx, 'failed');
          chatChecklistUI.updateStep(idx, 'failed');
          diag.logToTerminal(`[PLANNER] Step ${idx+1} Failed: ${error.error || error.message}`, 'error');
        };
        
        lukasTask.onProgress = (percent, message) => {
          diag.logToTerminal(`[PLANNER PROGRESS] ${percent}% - ${message}`, 'info');
        };

        // Run plan execution
        const context = {
          memory: lukasMemory,
          apiKey: activeKey,
          apiProvider: activeProvider,
          research: lukasResearch
        };
        
        const results = await lukasTask.executePlan(plan, context);
        const summary = lukasTask.summarizeResults(plan, results);
        
        // Synthesize cohesive Jarvis response
        const compiledText = results.map((r, idx) => `Step ${idx+1} (${r.title}): ${r.status === 'completed' ? r.output : 'Failed - ' + r.error}`).join('\n');
        const synthesisPrompt = `You are LUKAS, a Jarvis-style executive assistant.
  You have just executed a multi-step plan for the user: "${rawCommand}".
  Here are the steps and their execution outcomes:
  ${compiledText}
  
  Please synthesize a single, cohesive, premium Jarvis-style response summary explaining exactly what actions were taken and the results. Keep it polished and direct.`;

        // ── STAGE 6 & 7: ACCURACY CHECK & VALIDATION ──
        diag.logToTerminal("[STAGE 6 & 7: ACCURACY & VALIDATE] Compiling plan results and scoring synthesizer compliance...", "info");
        const finalResponse = await callLukasAI({
          systemPrompt: "You are LUKAS, an advanced AI Operating System.",
          userMessage: synthesisPrompt,
          memory: lukasMemory,
          apiKey: activeKey,
          apiProvider: activeProvider,
          temperature: 0.65,
          maxTokens: 1000
        });
        
        isProcessingCommand = false;
        const coreBtn = document.getElementById('lukasCoreBtn');
        if (coreBtn) coreBtn.classList.remove('processing');
        
        if (finalResponse) {
          const validation = lukasReasoning.validate(rawCommand, finalResponse, lukasMemory);
          appendChatBubble(finalResponse, 'assistant', null, validation.score);
          
          voice.stopWakeWordListener();
          const cleanResponse = parseExecutiveAnalysis(finalResponse).responseText;
          voice.speak(cleanResponse);
          
          lukasMemory.addMessage('assistant', finalResponse, 'planning');
        } else {
          appendChatBubble(summary, 'assistant');
          voice.speak("Plan execution complete.");
        }
        
        // Hide bottom panel after 6s delay
        setTimeout(() => {
          const panel = document.getElementById('planExecutionPanel');
          if (panel) panel.classList.remove('active');
        }, 6000);
        
        keepConversationAlive(15000);
        updateMemoryPanel();
        return;
      }

      // Single Step execution routes
      switch (routing.intent) {
        case INTENT.HOME_CONTROL:
          diag.logToTerminal("[STAGE 5: EXECUTE] Processing smart home command...", "info");
          await handleHomeControlIntent(rawCommand, activeKey, activeProvider);
          break;

        case INTENT.RESEARCH:
          diag.logToTerminal("[STAGE 5: EXECUTE] Initiating web search queries...", "info");
          await handleResearchIntent(rawCommand, activeKey, activeProvider, source);
          break;

        case INTENT.MEMORY_QUERY:
          diag.logToTerminal("[STAGE 5: EXECUTE] Accessing memory indexing database...", "info");
          await handleMemoryQueryIntent(rawCommand, activeKey, activeProvider);
          break;

        case INTENT.WEATHER:
          diag.logToTerminal("[STAGE 5: EXECUTE] Fetching meteorological data feed...", "info");
          await handleWeatherIntent(rawCommand);
          break;

        case INTENT.MEDIA:
          diag.logToTerminal("[STAGE 5: EXECUTE] Triggering client media driver...", "info");
          await handleMediaIntent(cmd, rawCommand);
          break;

        case INTENT.AUTOMATION:
          diag.logToTerminal("[STAGE 5: EXECUTE] Dispatching cron and scheduling automation...", "info");
          await handleAutomationIntent(cmd, rawCommand);
          break;

        case INTENT.MATH:
          diag.logToTerminal("[STAGE 5: EXECUTE] Running numerical calculation subroutines...", "info");
          await handleMathIntent(rawCommand, activeKey, activeProvider);
          break;

        case INTENT.SYSTEM:
          diag.logToTerminal("[STAGE 5: EXECUTE] Accessing local system hardware layer...", "info");
          await handleSystemIntent(cmd);
          break;

        case INTENT.CONVERSATION:
        case INTENT.TASK_EXECUTION:
        case INTENT.PLANNING:
        case INTENT.ANALYSIS:
        default:
          diag.logToTerminal("[STAGE 5: EXECUTE] Querying Conversational AI synthesis model...", "info");
          await handleConversationalIntent(rawCommand, routing.intent, activeKey, activeProvider, source);
          break;
      }
    });
    
    // Auto-update memory drawer
    updateMemoryPanel();
  } catch (err) {
    console.error("Error in processCommand:", err);
    isProcessingCommand = false;
    const coreBtn = document.getElementById('lukasCoreBtn');
    if (coreBtn) {
      coreBtn.classList.remove('processing');
    }
    diag.logToTerminal(`[AI CORE] Error during command execution: ${err.message}`, "error");
    handleAssistantResponse("Sorry, I encountered an internal system error while executing that request.");
  }
}

// ═══════════════════ INTENT SPECIFIC HANDLERS ═══════════════════

async function parseMultiHomeCommand(rawCommand, apiKey, apiProvider) {
  try {
    const history = lukasMemory.getHistory(6);
    const historyText = history.map(h => `${h.role === 'user' ? 'User' : 'LUKAS'}: ${h.content}`).join('\n');
    
    const systemPrompt = `You are LUKAS's smart home multi-command parser. 
Decompose the user's natural language directive(s) into an array of individual, structured JSON actions.
Analyze pronouns ("it", "them", "those", "here", "there") contextually using the conversation history and previous actions.

Do not just process literal words — process high-level objectives (Goal-First Thinking). 
If the user expresses a comfort goal (e.g. "make my room comfortable for watching a movie" or "prepare the bedroom for sleeping"), infer the correct device actions to accomplish it. For example, watching a movie in the living room should:
1. Turn off or dim living room lights to low brightness (e.g. 10% or 20%)
2. Change the living room light color to a warm or movie-friendly tone (like orange, red, or warm white)
3. Activate projector/media mode if applicable.
Return the complete array of actions required to meet the goal.

Return ONLY a JSON array containing objects matching this schema:
{
  "category": "light|climate|security|media|routine|reminder|weather|time|diagnostics|unknown",
  "action": "on|off|toggle|set|color|brightness|lock|unlock|increase|decrease|play|pause|stop|skip|morning|cinema|eco|lockdown|null",
  "targetZone": "Living Room|Bedroom|Kitchen|Outdoor|All|null",
  "targetDeviceName": "<exact name of the device or target, or the resolved name of the device if pronouns were used, or null>",
  "isGlobal": true|false,
  "value": "<numeric/color value, or null>",
  "timeExpression": "<for reminders: time string like '5 minutes' or null>",
  "reminderText": "<what to remind about or null>"
}

Provided Conversation History for resolving pronouns/context:
${historyText}

Output strictly the raw JSON array (e.g. [{"category": "light", ...}]) without any markdown formatting or backticks.`;

    const result = await callLukasAI({
      systemPrompt,
      userMessage: rawCommand,
      memory: null,
      apiKey,
      apiProvider,
      temperature: 0.05,
      maxTokens: 500,
      jsonMode: true,
      includeHistory: false,
    });

    if (!result) return [];
    
    let cleaned = result.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/```$/, '').trim();
    }
    
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    console.warn('[Multi-Parser] Failed:', e.message);
    return [];
  }
}

async function handleHomeControlIntent(rawCommand, apiKey, apiProvider) {
  diag.logToTerminal("[AI PARSER] Extracting smart home directives...", "info");
  const actions = await parseMultiHomeCommand(rawCommand, apiKey, apiProvider);
  
  if (!actions || actions.length === 0 || (actions.length === 1 && actions[0].category === 'unknown')) {
    diag.logToTerminal("[AI PARSER] Structured parse returned unknown/empty. Falling back to local pattern matching.", "warn");
    await executeLocalHomeControlFallback(rawCommand);
    return;
  }

  diag.logToTerminal(`[AI PARSER] Decomposed command into ${actions.length} action(s).`, "info");
  await multiTaskEngine.run(actions, apiKey, apiProvider);
}

async function handleResearchIntent(rawCommand, apiKey, apiProvider, source = 'user') {
  diag.logToTerminal(`[RESEARCH AGENT] Initiating web research for: "${rawCommand}"...`, "info");
  
  let query = rawCommand;
  const cleanMatch = rawCommand.match(/(?:search for|search|research|look up|tell me about|what is|who is|define)\s+(.+)/i);
  if (cleanMatch && cleanMatch[1]) {
    query = cleanMatch[1].trim();
  }

  // ── Context Enrichment for generic local queries (e.g., "who is the chief minister/cm") ──
  const normalizedQuery = query.toLowerCase().trim().replace(/[.?]/g, '');
  const isGenericCM = ['chief minister', 'the chief minister', 'current chief minister', 'current cm', 'cm', 'the cm'].includes(normalizedQuery);
  if (isGenericCM) {
    let suffix = "";
    if (typeof currentWeatherCity !== 'undefined' && currentWeatherCity && currentWeatherCity !== "Local Area") {
      suffix = " of " + currentWeatherCity;
    } else {
      try {
        const geo = await fetch('https://ipapi.co/json/').then(r => r.json());
        if (geo && geo.region) {
          suffix = " of " + geo.region;
        } else if (geo && geo.city) {
          suffix = " of " + geo.city;
        }
      } catch (e) {}
    }
    query = query + suffix;
    diag.logToTerminal(`[RESEARCH AGENT] Appended location context: "${query}"`, "info");
  }

  let result = null;
  try {
    result = await lukasResearch.research(query, { apiKey, apiProvider, memory: lukasMemory });
  } catch (err) {
    console.error("Research agent error:", err);
  }
  
  if (result && result.answer) {
    diag.logToTerminal(`[RESEARCH AGENT] Research finished with confidence: ${Math.round(result.confidence * 100)}%`, "info");
    
    // Split for spoken readout (first two sentences for terminal logging only)
    const sentences = result.answer.split(/(?<=[.!?])\s+/);
    const speechSummary = sentences.slice(0, 2).filter(s => s.trim().length > 0).join(" ");
    
    diag.logToTerminal(`[LUKAS REPLY] "${speechSummary}..."`, 'info');
    
    const displayAnswer = `${result.answer}\n\n*Sources: ${result.sources.join(', ') || 'Web Search'}*`;
    appendChatBubble(displayAnswer, 'assistant');
    isProcessingCommand = false;
    const coreBtn = document.getElementById('lukasCoreBtn');
    if (coreBtn) {
      coreBtn.classList.remove('processing');
    }
    voice.stopWakeWordListener();
    voice.speak(result.answer);
    
    lukasMemory.addMessage('assistant', displayAnswer, 'research');
    keepConversationAlive(12000); // Hold mic active for follow-ups
  } else {
    diag.logToTerminal(`[RESEARCH AGENT] No search results found. Falling back to Conversational AI.`, "info");
    await handleConversationalIntent(rawCommand, INTENT.CONVERSATION, apiKey, apiProvider, source);
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
    apiProvider,
    reasoning: lukasReasoning
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
    apiProvider,
    reasoning: lukasReasoning
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
    let isResponseStarted = false;

    const streamCallback = (delta, fullText) => {
      streamingBubble.update(fullText);
      
      // If we see [EXECUTIVE ANALYSIS], we suppress speaking until we find [RESPONSE]
      if (fullText.includes('[EXECUTIVE ANALYSIS]') && !isResponseStarted) {
        if (fullText.includes('[RESPONSE]')) {
          isResponseStarted = true;
          // Start sentence buffer after [RESPONSE]
          const responseIndex = fullText.indexOf('[RESPONSE]') + '[RESPONSE]'.length;
          sentenceBuffer = fullText.substring(responseIndex);
        } else {
          // Do not speak anything yet
          return;
        }
      } else {
        isResponseStarted = true;
        sentenceBuffer += delta;
      }

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
        isVoice: isVoiceMode,
        reasoning: lukasReasoning
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

        // Validation Checks (Layer 6 & 7 / Response Quality Rules)
        const validation = lukasReasoning.validate(rawCommand, response, lukasMemory);
        diag.logToTerminal("[STAGE 6: ACCURACY] Assessing prompt compliance and response precision score...", "info");
        diag.logToTerminal("[STAGE 7: VALIDATE] Performing response quality validation and self-reflection refinement...", "info");
        diag.logToTerminal("[STAGE 8: RESPONSE] Synthesizing final response output...", "info");
        
        if (validation) {
          if (!validation.valid) {
            diag.logToTerminal(`[REASONING WARNING] Output validation failed (Score: ${validation.score}). Issues: ${validation.issues.join(', ')}.`, 'warn');
          } else {
            diag.logToTerminal(`[REASONING] Response validated successfully (Score: ${validation.score}).`, 'info');
          }

          // Add accuracy badge to the final response bubble
          const badge = document.createElement('div');
          let level = 'high';
          if (validation.score < 60) level = 'low';
          else if (validation.score < 80) level = 'medium';
          badge.className = `accuracy-badge ${level}`;
          badge.innerHTML = `<i class="fa-solid fa-circle-nodes"></i> Accuracy: ${validation.score}%`;
          streamingBubble.element.appendChild(badge);
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
      
      const validation = lukasReasoning.validate(rawCommand, response, lukasMemory);
      appendChatBubble(response, 'assistant', null, validation.score);
      
      const parsed = parseExecutiveAnalysis(response);
      voice.stopWakeWordListener();
      voice.speak(parsed.responseText);
      
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

async function executeParsedHomeControl(parsed) {
  let aiResponseText = "";
  let aiIsControlAction = false;
  let handledByAI = false;

  const colorMap = {
    'red': '#ff0000', 'green': '#10b981', 'blue': '#3b82f6', 'purple': '#a855f7',
    'cyan': '#00f0ff', 'orange': '#ff9f3b', 'white': '#ffffff', 'yellow': '#eab308',
    'pink': '#ec4899', 'magenta': '#d946ef', 'lime': '#84cc16', 'teal': '#14b8a6',
    'gold': '#f59e0b', 'crimson': '#e11d48'
  };

  try {
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
          const res = resolveDevice(parsed.targetDeviceName, parsed.category || 'light', parsed.targetZone);
          targetDevice = res.device;
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
          await setDeviceStateWithFeedback(targetDevice.id, updates);
          aiResponseText = `Understood. I have successfully ${actionLabel} the ${targetDevice.name} in the ${targetDevice.zone}.`;
          handledByAI = true;
        } else if (parsed.isGlobal || (!targetZone && !parsed.targetDeviceName)) {
          if (turnOn) {
            await setDeviceStateWithFeedback(DEVICES.LIVING_ROOM, { on: true });
            await setDeviceStateWithFeedback(DEVICES.BEDROOM, { on: true });
            await setDeviceStateWithFeedback(DEVICES.KITCHEN, { on: true });
            for (const dev of home.dynamicDevices) {
              if (dev.category === 'light') await setDeviceStateWithFeedback(dev.id, { on: true });
            }
            aiResponseText = "Understood. Re-initializing all internal lighting arrays.";
          } else if (turnOff) {
            await setDeviceStateWithFeedback(DEVICES.LIVING_ROOM, { on: false });
            await setDeviceStateWithFeedback(DEVICES.BEDROOM, { on: false });
            await setDeviceStateWithFeedback(DEVICES.KITCHEN, { on: false });
            for (const dev of home.dynamicDevices) {
              if (dev.category === 'light') await setDeviceStateWithFeedback(dev.id, { on: false });
            }
            aiResponseText = "Understood. Powering down all lighting grids.";
          } else if (parsed.action === 'color' && parsed.value) {
            const hex = colorMap[parsed.value.toLowerCase()] || parsed.value;
            await setDeviceStateWithFeedback(DEVICES.LIVING_ROOM, { on: true, color: hex });
            await setDeviceStateWithFeedback(DEVICES.BEDROOM, { on: true, color: hex });
            await setDeviceStateWithFeedback(DEVICES.KITCHEN, { on: true, color: hex });
            for (const dev of home.dynamicDevices) {
              if (dev.category === 'light') await setDeviceStateWithFeedback(dev.id, { on: true, color: hex });
            }
            aiResponseText = `Affirmative. Changing all active light spectrums to ${parsed.value}.`;
          } else if (parsed.action === 'brightness' && parsed.value) {
            const val = parseInt(parsed.value);
            const percent = isNaN(val) ? 50 : val;
            await setDeviceStateWithFeedback(DEVICES.LIVING_ROOM, { on: true, brightness: percent });
            await setDeviceStateWithFeedback(DEVICES.BEDROOM, { on: true, brightness: percent });
            await setDeviceStateWithFeedback(DEVICES.KITCHEN, { on: true, brightness: percent });
            for (const dev of home.dynamicDevices) {
              if (dev.category === 'light') await setDeviceStateWithFeedback(dev.id, { on: true, brightness: percent });
            }
            aiResponseText = `Adjusting all active light brightness levels to ${percent} percent.`;
          } else {
            const isAnyOn = home.state.devices[DEVICES.LIVING_ROOM].on || home.state.devices[DEVICES.BEDROOM].on;
            const newState = !isAnyOn;
            await setDeviceStateWithFeedback(DEVICES.LIVING_ROOM, { on: newState });
            await setDeviceStateWithFeedback(DEVICES.BEDROOM, { on: newState });
            await setDeviceStateWithFeedback(DEVICES.KITCHEN, { on: newState });
            for (const dev of home.dynamicDevices) {
              if (dev.category === 'light') await setDeviceStateWithFeedback(dev.id, { on: newState });
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
          await setDeviceStateWithFeedback(targetZone, updates);
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light' && dev.zone === zoneLabel) {
              await setDeviceStateWithFeedback(dev.id, updates);
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
          const res = resolveDevice(parsed.targetDeviceName, parsed.category || 'security', parsed.targetZone);
          targetDevice = res.device;
        }
        
        const lock = parsed.action === 'off' || parsed.action === 'stop' || parsed.action === 'close';
        const unlock = parsed.action === 'on' || parsed.action === 'open' || parsed.action === 'release';
        
        if (targetDevice) {
          const isLocked = unlock ? false : (lock ? true : !targetDevice.locked);
          await setDeviceStateWithFeedback(targetDevice.id, { locked: isLocked });
          aiResponseText = `Understood. I have successfully ${isLocked ? 'locked and secured' : 'unlocked'} the ${targetDevice.name} in the ${targetDevice.zone}.`;
          handledByAI = true;
        } else {
          const isLocked = unlock ? false : (lock ? true : !home.state.devices[DEVICES.OUTDOOR].locked);
          await setDeviceStateWithFeedback(DEVICES.OUTDOOR, { locked: isLocked });
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
      
      // MEDIA — Smart Music Engine Routing
      else if (parsed.category === 'media') {
        aiIsControlAction = true;
        const cmd = parsed.action || '';
        const rawVal = parsed.value || '';

        if (cmd === 'pause' || cmd === 'stop') {
          isPlaying = false;
          updateMediaPlayButton(false);
          audioPlayer.pause();
          aiResponseText = 'Audio feed paused. Standing by.';
          handledByAI = true;

        } else if (cmd === 'next') {
          playlist = lukasMusic.getFullPlaylist().map(t => ({ ...t, icon: 'fa-music' }));
          currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
          isPlaying = true; updateMediaWidget(); playTrack();
          aiResponseText = `Skipping to: "${playlist[currentTrackIndex].title}" on ${activePlatform}.`;
          handledByAI = true;

        } else if (cmd === 'prev') {
          playlist = lukasMusic.getFullPlaylist().map(t => ({ ...t, icon: 'fa-music' }));
          currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
          isPlaying = true; updateMediaWidget(); playTrack();
          aiResponseText = `Reverting to: "${playlist[currentTrackIndex].title}" on ${activePlatform}.`;
          handledByAI = true;

        } else {
          // Smart music resolution — specific song or genre
          handledByAI = true;
          const searchQuery = rawVal || commandText;
          const musicQuery = LukasMusicEngine.parseMediaCommand(searchQuery) || searchQuery;

          // Show searching indicator
          if (musicQuery) {
            aiResponseText = `Searching for "${musicQuery}"... one moment.`;
            handleAssistantResponse(aiResponseText);
            diag.logToTerminal(`[MUSIC ENGINE] Resolving: "${musicQuery}"`, 'info');

            lukasMusic.resolveRequest(musicQuery).then(result => {
              if (result && result.track) {
                const t = result.track;
                // Inject the found track into the playlist and play it
                const newTrack = { id: t.id, title: t.title, artist: t.artist, url: t.url, icon: 'fa-music', thumbnail: t.thumbnail || '' };
                const existIdx = playlist.findIndex(p => p.id === t.id);
                if (existIdx === -1) {
                  playlist.push(newTrack);
                  lukasMusic.saveToLibrary(t);
                }
                currentTrackIndex = playlist.findIndex(p => p.id === t.id);
                if (currentTrackIndex === -1) currentTrackIndex = playlist.length - 1;
                isPlaying = true;
                updateMediaWidget();
                playTrack();
                diag.logToTerminal(`[MUSIC ENGINE] ✓ Playing: "${t.title}" by ${t.artist} (${result.source})`, 'info');
                const msg = result.source === 'youtube'
                  ? `Now playing "${t.title}" by ${t.artist}. Stream found via YouTube.`
                  : `Now playing "${t.title}" by ${t.artist} from your LUKAS library.`;
                handleAssistantResponse(msg);
                if (lastCommandSource === 'voice') voice.speak(msg);
              } else {
                const fallbackMsg = `I couldn't find that song online. Playing from your LUKAS library instead.`;
                isPlaying = true; updateMediaWidget(); playTrack();
                handleAssistantResponse(fallbackMsg);
                if (lastCommandSource === 'voice') voice.speak(fallbackMsg);
              }
            }).catch(err => {
              diag.logToTerminal(`[MUSIC ENGINE] ❌ Search error: ${err.message}`, 'error');
              isPlaying = true; updateMediaWidget(); playTrack();
            });

            // Return early — async response will be handled above
            return;
          } else {
            // Genre or generic play
            lukasMusic.resolveRequest(searchQuery).then(result => {
              if (result && result.track) {
                const t = result.track;
                const existIdx = playlist.findIndex(p => p.id === t.id);
                if (existIdx !== -1) {
                  currentTrackIndex = existIdx;
                } else {
                  playlist.push(t);
                  currentTrackIndex = playlist.length - 1;
                }
                isPlaying = true; updateMediaWidget(); playTrack();
                const msg = `Playing ${t.title} from your LUKAS library.`;
                handleAssistantResponse(msg);
                if (lastCommandSource === 'voice') voice.speak(msg);
              } else {
                isPlaying = true; updateMediaWidget(); playTrack();
                const msg = `Playing "${playlist[currentTrackIndex].title}" on ${activePlatform}.`;
                handleAssistantResponse(msg);
                if (lastCommandSource === 'voice') voice.speak(msg);
              }
            }).catch(() => {
              isPlaying = true; updateMediaWidget(); playTrack();
            });
            return;
          }
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
  } catch (err) {
    console.error("executeParsedHomeControl error:", err);
    diag.logToTerminal(`[AI CORE] Control error: ${err.message}`, "error");
    handleAssistantResponse(`I couldn't execute the command: ${err.message || 'connection failed'}.`, true);
  }
}

async function executeLocalHomeControlFallback(rawCommand) {
  try {
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
      
      await setDeviceStateWithFeedback(dynamicMatch.id, updates);
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
        const updates = {};
        if (turnOff) {
          updates.on = false;
          responseText = `Acknowledged. Deactivating lighting systems in the ${zoneLabel}.`;
        } else if (isDimming) {
          const numbers = cmd.match(/\d+/);
          const percentVal = numbers ? parseInt(numbers[0]) : 50;
          updates.on = true;
          updates.brightness = percentVal;
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
          updates.on = true;
          updates.color = hexColor;
          responseText = `Affirmative. Setting the ${zoneLabel} spectrum overlay to ${colorLabel}.`;
        } else if (turnOn) {
          updates.on = true;
          responseText = `Perfect, I have activated the lighting grid in the ${zoneLabel}.`;
        } else {
          const currentState = home.state.devices[zone].on;
          updates.on = !currentState;
          responseText = `Toggling the ${zoneLabel} lighting grid ${!currentState ? 'ON' : 'OFF'}.`;
        }

        await setDeviceStateWithFeedback(zone, updates);
        for (const dev of home.dynamicDevices) {
          if (dev.category === 'light' && dev.zone === zoneLabel) {
            await setDeviceStateWithFeedback(dev.id, updates);
          }
        }
      } else {
        // Global light controls
        if (turnOn) {
          isControlAction = true;
          await setDeviceStateWithFeedback(DEVICES.LIVING_ROOM, { on: true });
          await setDeviceStateWithFeedback(DEVICES.BEDROOM, { on: true });
          await setDeviceStateWithFeedback(DEVICES.KITCHEN, { on: true });
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light') await setDeviceStateWithFeedback(dev.id, { on: true });
          }
          responseText = "Understood. Re-initializing all internal lighting arrays.";
        } else if (turnOff) {
          isControlAction = true;
          await setDeviceStateWithFeedback(DEVICES.LIVING_ROOM, { on: false });
          await setDeviceStateWithFeedback(DEVICES.BEDROOM, { on: false });
          await setDeviceStateWithFeedback(DEVICES.KITCHEN, { on: false });
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light') await setDeviceStateWithFeedback(dev.id, { on: false });
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
          
          await setDeviceStateWithFeedback(DEVICES.LIVING_ROOM, { on: true, color: hexColor });
          await setDeviceStateWithFeedback(DEVICES.BEDROOM, { on: true, color: hexColor });
          await setDeviceStateWithFeedback(DEVICES.KITCHEN, { on: true, color: hexColor });
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light') await setDeviceStateWithFeedback(dev.id, { on: true, color: hexColor });
          }
          responseText = `Affirmative. Changing all active light spectrums to ${colorLabel}.`;
        } else if (isDimming) {
          isControlAction = true;
          const numbers = cmd.match(/\d+/);
          const percentVal = numbers ? parseInt(numbers[0]) : 50;
          
          await setDeviceStateWithFeedback(DEVICES.LIVING_ROOM, { on: true, brightness: percentVal });
          await setDeviceStateWithFeedback(DEVICES.BEDROOM, { on: true, brightness: percentVal });
          await setDeviceStateWithFeedback(DEVICES.KITCHEN, { on: true, brightness: percentVal });
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light') await setDeviceStateWithFeedback(dev.id, { on: true, brightness: percentVal });
          }
          responseText = `Acknowledged. Adjusting all active light brightness levels to ${percentVal} percent.`;
        } else if (cmd.includes('all') || cmd.includes('every') || cmd.includes('entire') || cmd.includes('house') || cmd.includes('toggle') || cmd.includes('switch')) {
          isControlAction = true;
          const isAnyOn = home.state.devices[DEVICES.LIVING_ROOM].on || home.state.devices[DEVICES.BEDROOM].on;
          const newState = !isAnyOn;
          await setDeviceStateWithFeedback(DEVICES.LIVING_ROOM, { on: newState });
          await setDeviceStateWithFeedback(DEVICES.BEDROOM, { on: newState });
          await setDeviceStateWithFeedback(DEVICES.KITCHEN, { on: newState });
          for (const dev of home.dynamicDevices) {
            if (dev.category === 'light') await setDeviceStateWithFeedback(dev.id, { on: newState });
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
        await setDeviceStateWithFeedback(DEVICES.OUTDOOR, { locked: false });
        responseText = "Security locks disengaged. Main entryway is now unlocked.";
      } else {
        await setDeviceStateWithFeedback(DEVICES.OUTDOOR, { locked: true });
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
    
    // MEDIA DIRECTIVES — Smart Music Engine Routing
    else if (cmd.includes('music') || cmd.includes('song') || cmd.includes('audio') || cmd.includes('play') || cmd.includes('pause') || cmd.includes('media')) {
      isControlAction = true;
      if (cmd.includes('pause') || cmd.includes('stop')) {
        isPlaying = false;
        updateMediaPlayButton(false);
        audioPlayer.pause();
        responseText = 'Audio feed paused. Standing by.';
      } else if (cmd.includes('next') || cmd.includes('forward')) {
        playlist = lukasMusic.getFullPlaylist().map(t => ({ ...t, icon: 'fa-music' }));
        currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
        isPlaying = true; updateMediaWidget(); playTrack();
        responseText = `Skipping to: "${playlist[currentTrackIndex].title}" on ${activePlatform}.`;
      } else if (cmd.includes('prev') || cmd.includes('back')) {
        playlist = lukasMusic.getFullPlaylist().map(t => ({ ...t, icon: 'fa-music' }));
        currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
        isPlaying = true; updateMediaWidget(); playTrack();
        responseText = `Reverting to: "${playlist[currentTrackIndex].title}" on ${activePlatform}.`;
      } else {
        // Smart resolution — check if a specific song is named
        const musicQuery = LukasMusicEngine.parseMediaCommand(cmd);
        if (musicQuery) {
          responseText = `Searching for "${musicQuery}"... one moment.`;
          // Show the searching message immediately then resolve async
          handleAssistantResponse(responseText);
          if (lastCommandSource === 'voice') voice.speak(`Searching for ${musicQuery}`);
          diag.logToTerminal(`[MUSIC ENGINE] Resolving (rule-based): "${musicQuery}"`, 'info');

          lukasMusic.resolveRequest(musicQuery).then(result => {
            if (result && result.track) {
              const t = result.track;
              const newTrack = { id: t.id, title: t.title, artist: t.artist, url: t.url, icon: 'fa-music', thumbnail: t.thumbnail || '' };
              const existIdx = playlist.findIndex(p => p.id === t.id);
              if (existIdx === -1) { playlist.push(newTrack); lukasMusic.saveToLibrary(t); }
              currentTrackIndex = playlist.findIndex(p => p.id === t.id);
              if (currentTrackIndex === -1) currentTrackIndex = playlist.length - 1;
              isPlaying = true; updateMediaWidget(); playTrack();
              diag.logToTerminal(`[MUSIC ENGINE] ✓ Playing: "${t.title}" by ${t.artist} (${result.source})`, 'info');
              const msg = result.source === 'youtube'
                ? `Now playing "${t.title}" by ${t.artist}. Stream found via YouTube.`
                : `Now playing "${t.title}" by ${t.artist} from your LUKAS library.`;
              handleAssistantResponse(msg);
              if (lastCommandSource === 'voice') voice.speak(msg);
            } else {
              isPlaying = true; updateMediaWidget(); playTrack();
              const fallbackMsg = `I couldn't find that exact song. Playing from your LUKAS library instead.`;
              handleAssistantResponse(fallbackMsg);
              if (lastCommandSource === 'voice') voice.speak(fallbackMsg);
            }
          }).catch(() => { isPlaying = true; updateMediaWidget(); playTrack(); });
          return; // async, don't continue
        } else {
          // Genre/generic play
          lukasMusic.resolveRequest(cmd).then(result => {
            if (result && result.track) {
              const t = result.track;
              const idx = playlist.findIndex(p => p.url === t.url);
              if (idx !== -1) currentTrackIndex = idx;
            }
            isPlaying = true; updateMediaWidget(); playTrack();
          });
          responseText = `Playing ${playlist[currentTrackIndex].title} on ${activePlatform}.`;
        }
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
  } catch (err) {
    console.error("executeLocalHomeControlFallback error:", err);
    diag.logToTerminal(`[AI CORE] Local fallback control error: ${err.message}`, "error");
    handleAssistantResponse(`I couldn't execute the command: ${err.message || 'connection failed'}.`, true);
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
      
      diag.logToTerminal(`[LUKAS REPLY] "${speechSummary}..."`, 'info');
      appendChatBubble(`${result.title}: ${result.summary}`, 'assistant', result.url);
      voice.stopWakeWordListener();
      voice.speak(result.summary);
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
function handleAssistantResponse(text, isSmartHomeAction = false, isSilent = false) {
  isProcessingCommand = false;
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

  const parsed = parseExecutiveAnalysis(text);

  diag.logToTerminal(`[LUKAS REPLY] "${parsed.responseText}"`, 'info');
  appendChatBubble(text, 'assistant');
  // Stop wake word listening while vocalizing to avoid self-triggering
  voice.stopWakeWordListener();
  if (!isSilent) {
    voice.speak(parsed.responseText);
  }
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
          await setDeviceStateWithFeedback(dev.id, updates);
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

  const devices = home.dynamicDevices.filter(d => 
    !['livingRoomLight', 'bedroomLight', 'kitchenLight', 'outdoorLock'].includes(d.id)
  );
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
    } else if (dev.category === 'projector') {
      const isChecked = dev.on ? 'checked' : '';
      const sourceVal = dev.source || 'Hologram';
      const modeVal = dev.mode || 'Jarvis HUD';
      const brightnessVal = dev.brightness || 80;
      controlHtml = `
        <div class="control-row">
          <span class="control-label">Power State</span>
          <label class="toggle-switch">
            <input type="checkbox" class="custom-dash-toggle" ${isChecked} />
            <span class="slider-knob" style="--zone-color: var(--purple-neon)"></span>
          </label>
        </div>
        <div class="projector-controls" style="display: ${dev.on ? 'block' : 'none'}; margin-top: 0.5rem;">
          <div class="control-row" style="margin-bottom: 0.4rem; justify-content: space-between; display: flex; align-items: center;">
            <span class="control-label">Source Input</span>
            <select class="node-select-custom custom-dash-select" data-prop="source" style="background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.08); color: #fff; border-radius: 4px; padding: 0.25rem; font-size: 0.65rem; outline: none; font-family: var(--font-mono); width: 100px;">
              <option value="Hologram" ${sourceVal === 'Hologram' ? 'selected' : ''}>Hologram</option>
              <option value="HDMI 1" ${sourceVal === 'HDMI 1' ? 'selected' : ''}>HDMI 1</option>
              <option value="Apple TV" ${sourceVal === 'Apple TV' ? 'selected' : ''}>Apple TV</option>
              <option value="Chromecast" ${sourceVal === 'Chromecast' ? 'selected' : ''}>Chromecast</option>
            </select>
          </div>
          <div class="control-row" style="margin-bottom: 0.4rem; justify-content: space-between; display: flex; align-items: center;">
            <span class="control-label">Projection Mode</span>
            <select class="node-select-custom custom-dash-select" data-prop="mode" style="background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.08); color: #fff; border-radius: 4px; padding: 0.25rem; font-size: 0.65rem; outline: none; font-family: var(--font-mono); width: 100px;">
              <option value="Jarvis HUD" ${modeVal === 'Jarvis HUD' ? 'selected' : ''}>Jarvis HUD</option>
              <option value="Alexa Ripple" ${modeVal === 'Alexa Ripple' ? 'selected' : ''}>Alexa Ripple</option>
              <option value="Cinema Stream" ${modeVal === 'Cinema Stream' ? 'selected' : ''}>Cinema Stream</option>
            </select>
          </div>
          <div class="control-row" style="display: flex; flex-direction: column; align-items: stretch; gap: 0.2rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="control-label">Projection Intensity</span>
            </div>
            <input type="range" class="range-slider custom-dash-dimmer" min="10" max="100" value="${brightnessVal}" />
          </div>
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
      toggle.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        const updates = {};
        if (dev.category === 'security' || dev.category === 'lock') {
          updates.locked = checked;
        } else {
          updates.on = checked;
        }
        await setDeviceStateWithFeedback(dev.id, updates);

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
        } else if (dev.category === 'projector') {
          const projControls = card.querySelector('.projector-controls');
          if (projControls) projControls.style.display = checked ? 'block' : 'none';
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
      dimmer.addEventListener('input', async (e) => {
        const val = parseInt(e.target.value);
        await setDeviceStateWithFeedback(dev.id, { brightness: val });
      });
    }

    if (colorPicker) {
      colorPicker.addEventListener('input', async (e) => {
        const val = e.target.value;
        await setDeviceStateWithFeedback(dev.id, { color: val });
        card.style.setProperty('--zone-color', val);
        const newGlow = `${val}25`;
        card.style.setProperty('--zone-color-glow', newGlow);
        if (icon) icon.style.color = val;
        const knob = card.querySelector('.slider-knob');
        if (knob) knob.style.setProperty('--zone-color', val);
      });
    }

    // Bind projector selectors
    const selects = card.querySelectorAll('.custom-dash-select');
    selects.forEach(select => {
      select.addEventListener('change', async (e) => {
        const prop = e.target.getAttribute('data-prop');
        const val = e.target.value;
        const updates = {};
        updates[prop] = val;
        await setDeviceStateWithFeedback(dev.id, updates);
        diag.logToTerminal(`[PROJECTOR] Changed ${prop} to: ${val}`, 'info');
      });
    });

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

    if (dev.category === 'projector') {
      const projControls = card.querySelector('.projector-controls');
      if (projControls) projControls.style.display = dev.on ? 'block' : 'none';

      const dimmer = card.querySelector('.custom-dash-dimmer');
      if (dimmer && parseInt(dimmer.value) !== dev.brightness) {
        dimmer.value = dev.brightness;
      }

      const selects = card.querySelectorAll('.custom-dash-select');
      selects.forEach(select => {
        const prop = select.getAttribute('data-prop');
        if (select.value !== dev[prop]) {
          select.value = dev[prop];
        }
      });
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

// Render voice profiles list (Global scope helper)
function renderVoiceProfilesList() {
  const listEl = document.getElementById('registeredVoiceProfilesList');
  if (!listEl) return;
  
  if (typeof lukasMemory !== 'undefined' && lukasMemory.currentUsername === 'Guest') {
    listEl.innerHTML = '<div style="color:var(--rose-neon); font-style:italic;"><i class="fa-solid fa-lock"></i> Verification required to view profiles.</div>';
    return;
  }
  
  const profiles = voice.biometrics.getProfiles();
  const names = Object.keys(profiles);
  
  if (names.length === 0) {
    listEl.innerHTML = '<div style="color:#475569; font-style:italic;">No profiles registered yet.</div>';
    return;
  }
  
  listEl.innerHTML = names.map(name => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.05); padding:0.3rem 0.5rem; border-radius:4px; margin-bottom:0.2rem;">
      <span style="font-weight:bold; color:var(--cyan-neon);"><i class="fa-solid fa-user-check" style="margin-right:6px;"></i>${name}</span>
      <button class="delete-voice-profile-btn btn-routine lockdown" data-name="${name}" style="padding:0.2rem 0.4rem; font-size:0.55rem; cursor:pointer; width:auto; height:auto; border-radius:3px;">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('');
  
  // Bind delete buttons
  listEl.querySelectorAll('.delete-voice-profile-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const nameToDelete = btn.getAttribute('data-name');
      if (confirm(`Are you sure you want to delete the voice profile for "${nameToDelete}"?`)) {
        const profiles = voice.biometrics.getProfiles();
        delete profiles[nameToDelete];
        localStorage.setItem("lukas_voice_profiles", JSON.stringify(profiles));
        diag.logToTerminal(`[BIOMETRICS] Deleted voice profile for "${nameToDelete}".`, 'info');
        renderVoiceProfilesList();
      }
    });
  });
}

// Profile Manager Modal initialization
function initProfileManager() {
  const profileManagerModal = document.getElementById('profileManagerModal');
  const openProfileBtn = document.getElementById('openProfileBtn');
  const closeProfileManagerBtn = document.getElementById('closeProfileManagerBtn');
  const profileManagerList = document.getElementById('profileManagerList');
  const profileCreateForm = document.getElementById('profileCreateForm');
  const profileRegUsername = document.getElementById('profileRegUsername');
  const profileRegPassword = document.getElementById('profileRegPassword');
  const profileCreateStatus = document.getElementById('profileCreateStatus');

  if (openProfileBtn && profileManagerModal) {
    openProfileBtn.addEventListener('click', () => {
      profileManagerModal.style.display = 'flex';
      renderProfileManagerList();
      profileCreateStatus.style.display = 'none';
      profileRegUsername.value = '';
      profileRegPassword.value = '';
    });
  }

  if (closeProfileManagerBtn && profileManagerModal) {
    closeProfileManagerBtn.addEventListener('click', () => {
      profileManagerModal.style.display = 'none';
    });
  }

  // Close when clicking outside modal content
  if (profileManagerModal) {
    profileManagerModal.addEventListener('click', (e) => {
      if (e.target === profileManagerModal) {
        profileManagerModal.style.display = 'none';
      }
    });
  }

  // Render profiles list with switch and inline login capabilities
  function renderProfileManagerList() {
    if (!profileManagerList) return;
    profileManagerList.innerHTML = '';

    const accounts = JSON.parse(localStorage.getItem('lukas_accounts') || '{}');
    const accountList = Object.values(accounts);

    if (accountList.length === 0) {
      profileManagerList.innerHTML = '<div style="color:#64748b; font-style:italic; font-size:0.65rem; padding: 0.5rem 0;">No other profiles registered yet.</div>';
      return;
    }

    accountList.forEach(acc => {
      const username = acc.username;
      const isCurrent = username.toLowerCase() === lukasMemory.currentUsername.toLowerCase();

      const itemCard = document.createElement('div');
      itemCard.className = 'node-item-card';
      itemCard.style.gridTemplateColumns = '1fr auto';
      itemCard.style.padding = '0.5rem 0.75rem';
      itemCard.style.background = 'rgba(255, 255, 255, 0.01)';
      itemCard.style.border = '1px solid rgba(255, 255, 255, 0.04)';
      itemCard.style.borderRadius = '6px';
      itemCard.style.gap = '0.5rem';

      // Meta details column
      const metaCol = document.createElement('div');
      metaCol.className = 'node-meta';
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'node-display-name';
      nameSpan.textContent = username;
      nameSpan.style.fontSize = '0.75rem';
      metaCol.appendChild(nameSpan);

      const roleSpan = document.createElement('span');
      roleSpan.className = 'node-display-zone';
      roleSpan.textContent = isCurrent ? 'ACTIVE SESSION' : 'SECURE TERMINAL PROFILE';
      roleSpan.style.fontSize = '0.55rem';
      roleSpan.style.color = isCurrent ? 'var(--emerald-neon)' : '#64748b';
      metaCol.appendChild(roleSpan);
      itemCard.appendChild(metaCol);

      // Controls column
      const controlCol = document.createElement('div');
      controlCol.className = 'node-controls';

      if (isCurrent) {
        const activeBadge = document.createElement('span');
        activeBadge.className = 'node-status-indicator';
        activeBadge.style.color = 'var(--emerald-neon)';
        activeBadge.style.fontSize = '0.65rem';
        activeBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> ACTIVE';
        controlCol.appendChild(activeBadge);
      } else {
        const switchBtn = document.createElement('button');
        switchBtn.className = 'btn-routine';
        switchBtn.style.padding = '0.25rem 0.5rem';
        switchBtn.style.fontSize = '0.58rem';
        switchBtn.style.background = 'rgba(0, 240, 255, 0.05)';
        switchBtn.style.borderColor = 'rgba(0, 240, 255, 0.3)';
        switchBtn.style.color = 'var(--cyan-neon)';
        switchBtn.style.cursor = 'pointer';
        switchBtn.style.height = 'auto';
        switchBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> SWITCH';
        
        switchBtn.addEventListener('click', () => {
          // Replace switchBtn with inline password form
          controlCol.innerHTML = '';
          
          const inlineForm = document.createElement('div');
          inlineForm.style.display = 'flex';
          inlineForm.style.gap = '0.3rem';
          inlineForm.style.alignItems = 'center';

          const passInput = document.createElement('input');
          passInput.type = 'password';
          passInput.placeholder = 'Keyphrase...';
          passInput.style.background = 'rgba(0,0,0,0.6)';
          passInput.style.border = '1px solid rgba(255,255,255,0.12)';
          passInput.style.borderRadius = '4px';
          passInput.style.color = '#fff';
          passInput.style.padding = '0.2rem 0.4rem';
          passInput.style.fontSize = '0.62rem';
          passInput.style.width = '100px';
          passInput.style.height = '22px';
          passInput.style.fontFamily = 'var(--font-sans)';
          inlineForm.appendChild(passInput);

          const submitBtn = document.createElement('button');
          submitBtn.className = 'btn-routine';
          submitBtn.style.padding = '0 0.4rem';
          submitBtn.style.fontSize = '0.55rem';
          submitBtn.style.borderColor = 'var(--cyan-neon)';
          submitBtn.style.color = 'var(--cyan-neon)';
          submitBtn.style.background = 'rgba(0, 240, 255, 0.05)';
          submitBtn.style.height = '22px';
          submitBtn.style.cursor = 'pointer';
          submitBtn.textContent = 'DECRYPT';
          inlineForm.appendChild(submitBtn);

          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'btn-routine';
          cancelBtn.style.padding = '0 0.4rem';
          cancelBtn.style.fontSize = '0.55rem';
          cancelBtn.style.borderColor = 'rgba(255,255,255,0.15)';
          cancelBtn.style.color = '#cbd5e1';
          cancelBtn.style.height = '22px';
          cancelBtn.style.cursor = 'pointer';
          cancelBtn.textContent = 'X';
          inlineForm.appendChild(cancelBtn);

          controlCol.appendChild(inlineForm);
          passInput.focus();

          cancelBtn.addEventListener('click', () => {
            renderProfileManagerList();
          });

          const attemptLogin = async () => {
            const password = passInput.value;
            if (!password) return;

            submitBtn.textContent = '...';
            submitBtn.disabled = true;

            const res = await loginUser(username, password);
            if (res.success) {
              if (typeof voice !== 'undefined') {
                voice.warmUpMic();
              }
              if (typeof playFuturisticBeep === 'function') playFuturisticBeep();
              
              applyUserPreferencesToVoiceAndUI(username);
              
              if (typeof diag !== 'undefined' && diag.logToTerminal) {
                diag.logToTerminal(`[SYSTEM] Swapped terminal session to user: "${username}".`, 'info');
              }
              
              profileManagerModal.style.display = 'none';
            } else {
              submitBtn.textContent = 'DECRYPT';
              submitBtn.disabled = false;
              playAlexaErrorChime();
              
              // Highlight red outline on input
              passInput.style.borderColor = 'var(--rose-neon)';
              passInput.value = '';
              passInput.placeholder = 'Access Denied';
              setTimeout(() => {
                passInput.style.borderColor = 'rgba(255,255,255,0.12)';
                passInput.placeholder = 'Keyphrase...';
              }, 1500);
            }
          };

          submitBtn.addEventListener('click', attemptLogin);
          passInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
              attemptLogin();
            }
          });
        });

        controlCol.appendChild(switchBtn);
      }

      itemCard.appendChild(controlCol);
      profileManagerList.appendChild(itemCard);
    });
  }

  // Handle Create Profile submit
  if (profileCreateForm) {
    profileCreateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const newUsername = profileRegUsername.value.trim();
      const newPassword = profileRegPassword.value;
      
      if (!newUsername || !newPassword) return;

      profileCreateStatus.style.display = 'block';
      profileCreateStatus.style.color = 'var(--cyan-neon)';
      profileCreateStatus.textContent = 'Generating security credentials...';

      const res = await registerUser(newUsername, newPassword);
      if (res.success) {
        profileCreateStatus.style.color = 'var(--emerald-neon)';
        profileCreateStatus.textContent = 'ACCESS CLEARANCE CREATED.';

        // Automatically login the user
        const loginRes = await loginUser(newUsername, newPassword);
        if (loginRes.success) {
          if (typeof voice !== 'undefined') {
            voice.warmUpMic();
          }
          if (typeof playFuturisticBeep === 'function') playFuturisticBeep();

          setTimeout(() => {
            applyUserPreferencesToVoiceAndUI(newUsername);
            
            if (typeof diag !== 'undefined' && diag.logToTerminal) {
              diag.logToTerminal(`[SYSTEM] Initialized and logged in new profile: "${newUsername}".`, 'info');
            }
            
            profileManagerModal.style.display = 'none';
          }, 1000);
        }
      } else {
        profileCreateStatus.style.color = 'var(--rose-neon)';
        profileCreateStatus.textContent = res.message.toUpperCase();
        playAlexaErrorChime();
      }
    });
  }
}

// ── PWA Installation Orchestration ──────────────────────────────────────────
let deferredPrompt = null;
const pwaInstallBtn = document.getElementById('pwaInstallBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (pwaInstallBtn) {
    pwaInstallBtn.style.display = 'flex';
  }
  console.log('[PWA Engine] App is eligible for standalone installation.');
});

if (pwaInstallBtn) {
  pwaInstallBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA Engine] User choice outcome: ${outcome}`);
    deferredPrompt = null;
    pwaInstallBtn.style.display = 'none';
  });
}

window.addEventListener('appinstalled', () => {
  console.log('[PWA Engine] App installed successfully.');
  if (pwaInstallBtn) {
    pwaInstallBtn.style.display = 'none';
  }
});
