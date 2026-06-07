// voice.js - LUKAS voice communication sub-module
// Integrates HTML5 Web Speech API (SpeechRecognition & SpeechSynthesis)
import LukasVoiceprintAnalyzer from './ai/voiceprint.js';

class SpeechRecognitionManager {
  constructor(controller) {
    this.controller = controller;
    this.state = 'STANDBY'; // IDLE, STANDBY, LISTENING, PROCESSING, SPEAKING
    this.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = null;
    this.init();
  }

  init() {
    if (!this.SpeechRecognition) {
      console.warn("Speech Recognition not supported in this browser.");
      return;
    }
    this.recognition = new this.SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = localStorage.getItem('lukas_speech_lang') || 'en-IN';

    this.recognition.onstart = () => {
      this.controller.isRecognitionActive = true;
      this.controller.consecutiveErrors = 0;
      this.controller.lastStartTime = Date.now();
      console.log(`[SpeechRecognitionManager] Recognition started (State: ${this.state})`);
      if (this.controller.onRecognitionStateChange) {
        this.controller.onRecognitionStateChange(this.state.toLowerCase());
      }
    };

    this.recognition.onend = () => {
      this.controller.isRecognitionActive = false;
      this.controller.isStopping = false;
      console.log(`[SpeechRecognitionManager] Recognition ended (State: ${this.state})`);

      // Recovery restart or standby restart logic
      if (this.state === 'STANDBY' || this.state === 'LISTENING') {
        const delay = this.controller.consecutiveErrors > 3 ? 2000 : 200;
        setTimeout(() => {
          if (this.state === 'STANDBY' || this.state === 'LISTENING') {
            this.start();
          }
        }, delay);
      } else {
        if (this.controller.onRecognitionStateChange) {
          this.controller.onRecognitionStateChange(this.state.toLowerCase());
        }
      }
    };

    this.recognition.onerror = (event) => {
      console.error(`[SpeechRecognitionManager] Error: ${event.error}`);
      this.controller.lastError = event.error;

      if (event.error === 'not-allowed') {
        if (this.controller.onMicPermissionBlocked) {
          this.controller.onMicPermissionBlocked();
        }
        this.transitionTo('IDLE');
        return;
      }

      if (event.error === 'no-speech') {
        this.controller.consecutiveErrors = 0;
        return;
      }

      if (event.error === 'aborted') {
        this.controller.consecutiveErrors++;
        return;
      }

      this.controller.consecutiveErrors++;
    };

    this.recognition.onresult = (event) => {
      let fullTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        fullTranscript += event.results[i][0].transcript + " ";
      }
      fullTranscript = fullTranscript.trim();
      const isFinal = event.results[event.resultIndex].isFinal;

      this.controller.handleSpeechResult(fullTranscript, isFinal);
    };
  }

  transitionTo(newState) {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    console.log(`[SpeechRecognitionManager] Transition: ${oldState} -> ${newState}`);

    if (newState === 'STANDBY') {
      this.controller.isListeningForWakeWord = true;
      this.controller.isCommandListeningActive = false;
      this.controller.isLongConversation = false;
      this.start();
    } else if (newState === 'LISTENING') {
      this.controller.isListeningForWakeWord = false;
      this.controller.isCommandListeningActive = true;
      this.start();
    } else if (newState === 'PROCESSING') {
      this.controller.isListeningForWakeWord = false;
      this.controller.isCommandListeningActive = false;
      this.stop();
    } else if (newState === 'SPEAKING') {
      this.controller.isListeningForWakeWord = false;
      this.controller.isCommandListeningActive = false;
      // Restart speech recognition to clear old transcript context and allow fresh speech interruption
      this.restart();
    } else if (newState === 'IDLE') {
      this.controller.isListeningForWakeWord = false;
      this.controller.isCommandListeningActive = false;
      this.controller.isLongConversation = false;
      this.stop();
    }

    if (this.controller.onRecognitionStateChange) {
      this.controller.onRecognitionStateChange(newState.toLowerCase());
    }
  }

  start() {
    if (!this.recognition) return;
    if (this.controller.isRecognitionActive) return;
    
    // Prevent starting too fast
    const timeSinceLastStart = Date.now() - (this.controller.lastStartTime || 0);
    if (timeSinceLastStart < 600) {
      setTimeout(() => this.start(), 600 - timeSinceLastStart);
      return;
    }

    try {
      this.recognition.start();
      this.controller.isRecognitionActive = true;
      this.controller.lastStartTime = Date.now();
    } catch (e) {
      console.warn("[SpeechRecognitionManager] Start error:", e.message);
    }
  }

  stop() {
    if (!this.recognition) return;
    if (!this.controller.isRecognitionActive) return;
    try {
      this.recognition.stop();
      this.controller.isRecognitionActive = false;
      this.controller.isStopping = true;
    } catch (e) {
      console.warn("[SpeechRecognitionManager] Stop error:", e.message);
    }
  }

  abort() {
    if (!this.recognition) return;
    try {
      this.recognition.abort();
      this.controller.isRecognitionActive = false;
    } catch (e) {
      console.warn("[SpeechRecognitionManager] Abort error:", e.message);
    }
  }

  restart() {
    this.abort();
    setTimeout(() => this.start(), 150);
  }
}

class LukasVoiceController {
  constructor() {
    this.biometrics = new LukasVoiceprintAnalyzer();
    this.lastSpokenVoiceprint = null;
    this.synth = window.speechSynthesis;
    this.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = null;
    this.queuedUtterances = [];
    
    this.isMuted = localStorage.getItem('lukas_muted') === 'true';
    const storedVol  = parseFloat(localStorage.getItem('lukas_vocal_volume'));
    const storedRate = parseFloat(localStorage.getItem('lukas_vocal_rate'));
    this.vocalVolume = isNaN(storedVol)  ? 1.0 : storedVol;
    this.vocalRate   = isNaN(storedRate) ? 1.0 : storedRate;
    
    // Infinity OS Custom Voice Parameters
    this.preferredAccent = localStorage.getItem('lukas_voice_accent') || 'en-US';
    this.speakingRateProfile = localStorage.getItem('lukas_voice_rate') || 'normal';
    this.emotionalToneMode = localStorage.getItem('lukas_voice_emotional_tone') || 'adaptive';
    this.speechQueue = [];
    this.currentSegmentIndex = 0;
    this.activeUtterance = null;
    this.activeTimeout = null;
    this.currentSpeechEmotion = null;

    this.isListeningForWakeWord = false;
    this.isLongConversation = false;
    this.speakingText = '';
    this.spokenTextAccumulated = '';
    this.wakeWordTimeout = null;
    this.isWakeLocked = false;
    
    // safe start/stop state machine variables
    this.isRecognitionActive = false;
    this.isStopping = false;
    this.pendingStart = false;
    this.consecutiveErrors = 0;
    this.lastError = null;
    this.lastStartTime = 0;
    this.retryStartTimeout = null;
    this.isTransitioning = false;  // Prevents rapid mode-switch loops on mobile
    
    // Robust command listening variables
    this.isCommandListeningActive = false;
    this.accumulatedSpeechText = "";
    this.lastSessionTranscript = "";

    this.onSpeechStart = null;
    this.onSpeechEnd = null;
    this.onCommandRecognized = null;
    this.onRecognitionStateChange = null;
    this.onWakeWordDetected = null;
    this.onSpeechDetected = null;
    this.onMicPermissionBlocked = null;
    this.onPreWarm = null;  // NEW: fires as soon as wake word detected, before user finishes speaking
    
    // Latency tracker — records timestamps at each pipeline stage
    this.latency = {
      wakeDetectedAt: 0,
      sttCompleteAt: 0,
      responseStartAt: 0,
      speechStartAt: 0,
      getReport() {
        if (!this.wakeDetectedAt) return null;
        return {
          wake_to_stt_ms: this.sttCompleteAt ? this.sttCompleteAt - this.wakeDetectedAt : null,
          stt_to_response_ms: this.responseStartAt && this.sttCompleteAt ? this.responseStartAt - this.sttCompleteAt : null,
          response_to_speech_ms: this.speechStartAt && this.responseStartAt ? this.speechStartAt - this.responseStartAt : null,
          total_ms: this.speechStartAt ? this.speechStartAt - this.wakeDetectedAt : null,
        };
      },
      reset() { this.wakeDetectedAt = 0; this.sttCompleteAt = 0; this.responseStartAt = 0; this.speechStartAt = 0; }
    };
    
    this.preferredVoice = null;
    this.dummyStream = null; // Keeps browser microphone hardware warm on mobile
    
    this.wakeWords = [
      'hey lukas', 'train lukas', 'tren lukas', 'turn lukas', 'then lukas', 
      'ten lukas', 'tell lukas', 'hi lukas', 'dear lukas', 'hello lukas', 
      'ok lukas', 'okay lukas', 'wake up lukas', 'look us', 'wake up', 
      'lukas', 'lucas', 'lookas', 'locus', 'luca', 'luka', 'lucus', 'jarvis', 'alexa'
    ];
    
    this.initSpeechSynthesis();
    this.initSpeechRecognition();
  }

  get isListening() {
    return this.recognitionManager ? this.recognitionManager.state === 'LISTENING' : false;
  }

  getVoiceForLanguage(langCode) {
    if (!this.synth) return null;
    const voices = this.synth.getVoices();
    if (voices.length === 0) return null;

    let targetLang = (langCode || 'en-IN').toLowerCase();
    const langPrefix = targetLang.split('-')[0];

    // If target language is general English, map to preferred accent profile
    if (langPrefix === 'en') {
      const accent = this.preferredAccent || 'en-US';
      if (accent === 'kannada_native') {
        targetLang = 'kn-in';
      } else if (['indian_english', 'bengaluru_professional', 'neutral_corporate'].includes(accent)) {
        targetLang = 'en-in';
      } else {
        targetLang = accent.toLowerCase();
      }
    }

    // Filter exact match (e.g. 'en-us')
    let matchedVoices = voices.filter(v => v.lang.toLowerCase() === targetLang);

    // Fallback to language prefix matching (e.g. 'en')
    if (matchedVoices.length === 0) {
      matchedVoices = voices.filter(v => v.lang.toLowerCase().startsWith(langPrefix));
    }

    // Fallback to any English voice
    if (matchedVoices.length === 0) {
      matchedVoices = voices.filter(v => v.lang.toLowerCase().startsWith('en'));
    }

    // Ultimate fallback to whatever is available
    if (matchedVoices.length === 0) {
      matchedVoices = voices;
    }

    // Keywords prioritizing premium vocal engines (Microsoft Natural, Google TTS, Siri, Alexa, etc.)
    const premiumKeywords = [
      'natural', 'google', 'neural', 'premium', 'siri', 'aria', 'guy', 'danny', 
      'ravi', 'heera', 'david', 'zira', 'hazel', 'mark', 'george', 'susan', 
      'ashley', 'karen', 'karan', 'neerja', 'linda', 'heather', 'catherine'
    ];
    
    matchedVoices.sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();
      
      const scoreA = premiumKeywords.findIndex(kw => nameA.includes(kw));
      const scoreB = premiumKeywords.findIndex(kw => nameB.includes(kw));
      
      const valA = scoreA === -1 ? 999 : scoreA;
      const valB = scoreB === -1 ? 999 : scoreB;
      
      return valA - valB;
    });

    return matchedVoices[0] || null;
  }

  // Find a suitable futuristic/clean voice
  initSpeechSynthesis() {
    if (!this.synth) return;
    
    // Voices are loaded asynchronously
    const loadVoices = () => {
      const activeLang = this.speechLang || localStorage.getItem('lukas_speech_lang') || 'en-IN';
      this.preferredVoice = this.getVoiceForLanguage(activeLang);
      console.log(`[voice.js] Speech Synthesis voice initialized: ${this.preferredVoice?.name || 'Default'} (${this.preferredVoice?.lang || 'unknown'})`);
    };
    
    loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = loadVoices;
    }
  }

  // Initialize Speech-to-Text Recognition via Manager
  initSpeechRecognition() {
    this.recognitionManager = new SpeechRecognitionManager(this);
    this.recognition = this.recognitionManager.recognition;
  }

  handleSpeechResult(fullTranscript, isFinal) {
    const state = this.recognitionManager.state;
    const cmd = fullTranscript.toLowerCase().trim();

    // ── INTERRUPTION CHECK ──
    if (state === 'SPEAKING' || (this.synth && this.synth.speaking)) {
      const userSpeech = fullTranscript.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
      
      const stopWords = ['stop', 'cancel', 'shut up', 'quiet', 'stop talking', 'stop listening', 'stand down', 'go to sleep'];
      
      // Check for stop words
      const isStopCommand = stopWords.some(word => {
        const hasWord = userSpeech === word || userSpeech.startsWith(word + ' ') || userSpeech.endsWith(' ' + word) || userSpeech.includes(' ' + word + ' ');
        if (hasWord) {
          // If LUKAS spoke the word too, it's just an echo
          if (!this._isWordInSpokenText(word, this.spokenTextAccumulated)) {
            return true;
          }
        }
        return false;
      });
      
      if (isStopCommand) {
        console.log(`[INTERRUPT] Stop command detected during speech: "${userSpeech}"`);
        this.cancelSpeech();
        this.speakingText = '';
        this.spokenTextAccumulated = '';
        if (this.onSpeechEnd) this.onSpeechEnd();
        
        this.recognitionManager.transitionTo('STANDBY');
        
        if (this.onCommandRecognized) {
          this.onCommandRecognized('stop');
        }
        return;
      }
      
      // Check for wake words
      const isWakeCommand = this.wakeWords.some(word => {
        const hasWord = userSpeech === word || userSpeech.startsWith(word + ' ') || userSpeech.endsWith(' ' + word) || userSpeech.includes(' ' + word + ' ');
        if (hasWord) {
          // If LUKAS spoke the word too, it's just an echo
          if (!this._isWordInSpokenText(word, this.spokenTextAccumulated)) {
            return true;
          }
        }
        return false;
      });

      if (isWakeCommand) {
        console.log(`[INTERRUPT] Wake word detected during speech: "${userSpeech}"`);
        this.cancelSpeech();
        this.speakingText = '';
        this.spokenTextAccumulated = '';
        if (this.onSpeechEnd) this.onSpeechEnd();
        
        // INTERRUPTION FLOW: Cancel TTS -> wait 100ms -> release audio focus -> enable recognition -> listen
        this.recognitionManager.abort();
        setTimeout(() => {
          this.recognitionManager.transitionTo('LISTENING');
          if (this.onWakeWordDetected) this.onWakeWordDetected();
        }, 100);
        return;
      }
      
      return; // ignore echoes/noise during synthesis
    }

    // Keep track of the current session's latest transcript
    this.lastSessionTranscript = fullTranscript;

    let displayTranscript = fullTranscript;
    if (state === 'LISTENING' && this.accumulatedSpeechText) {
      displayTranscript = (this.accumulatedSpeechText + " " + fullTranscript).trim();
    }

    // Trigger real-time interim speech detection callback
    if (this.onSpeechDetected) {
      let textToDisplay = displayTranscript;
      if (state === 'STANDBY') {
        const lowerText = displayTranscript.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
        let matchedWakeWord = this._detectWakeWord(lowerText);
        if (matchedWakeWord) {
          const originalLower = displayTranscript.toLowerCase();
          const originalWakeIndex = originalLower.indexOf(matchedWakeWord);
          if (originalWakeIndex !== -1) {
            textToDisplay = displayTranscript.substring(originalWakeIndex + matchedWakeWord.length).trim();
          }
        } else {
          textToDisplay = "";
        }
      }
      if (textToDisplay) {
        this.onSpeechDetected(textToDisplay);
      }
    }

    // ── STANDBY STATE: WAKE WORD DETECTION ──
    if (state === 'STANDBY' && !this.isWakeLocked) {
      const lowerText = displayTranscript.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
      let matchedWakeWord = this._detectWakeWord(lowerText);
      
      if (matchedWakeWord) {
        const wakeWordIndex = lowerText.indexOf(matchedWakeWord);
        const commandAfterWakeWord = lowerText.substring(wakeWordIndex + matchedWakeWord.length).trim();
        const isJustWakeWord = commandAfterWakeWord.length === 0;

        console.log(`Wake word matched: "${matchedWakeWord}"`);
        this.latency.reset();
        this.latency.wakeDetectedAt = Date.now();
        if (this.onPreWarm) this.onPreWarm();

        // SINGLE ATTEMPT WAKE WORD FLOW:
        // Wake Word Detected -> Lock Wake Engine -> Stop Existing Session -> Wait 100ms -> Start Listening Mode
        this.isWakeLocked = true;
        setTimeout(() => { this.isWakeLocked = false; }, 2000);

        this.recognitionManager.abort();
        
        setTimeout(() => {
          this.recognitionManager.transitionTo('LISTENING');
          if (this.onWakeWordDetected) this.onWakeWordDetected();

          if (!isJustWakeWord) {
            // It was an inline command!
            const originalLower = displayTranscript.toLowerCase();
            const originalWakeIndex = originalLower.indexOf(matchedWakeWord);
            let command = displayTranscript.substring(originalWakeIndex + matchedWakeWord.length).trim();
            command = command.replace(/^[^a-zA-Z0-9]+/, '').trim();
            
            if (isFinal) {
              this.recognitionManager.transitionTo('PROCESSING');
              this.latency.sttCompleteAt = Date.now();
              if (this.onCommandRecognized) {
                this.onCommandRecognized(command);
              }
            } else {
              this.accumulatedSpeechText = command;
            }
          }
        }, 100);
        return;
      } else if (lowerText === 'stop' || lowerText === 'stop listening' || lowerText === 'go to sleep' || lowerText === 'stand down' || lowerText === 'deactivate voice' || lowerText === 'mute microphone') {
        console.log("Stop command detected during standby.");
        this.recognitionManager.transitionTo('IDLE');
        if (this.onCommandRecognized) {
          this.onCommandRecognized(displayTranscript);
        }
        return;
      }
    }

    // ── LISTENING STATE: FINAL COMMAND CAPTURING ──
    if (state === 'LISTENING') {
      if (isFinal) {
        console.log(`Speech recognized (final command): "${displayTranscript}"`);
        this.recognitionManager.transitionTo('PROCESSING');
        this.accumulatedSpeechText = "";
        this.lastSessionTranscript = "";
        if (this.onCommandRecognized) {
          this.onCommandRecognized(displayTranscript);
        }
      }
    }
  }

  _detectWakeWord(text) {
    for (const w of this.wakeWords) {
      const index = text.indexOf(w);
      if (index !== -1) {
        const charBefore = index > 0 ? text[index - 1] : ' ';
        const charAfter = index + w.length < text.length ? text[index + w.length] : ' ';
        const isWordIsolated = /[^a-z]/.test(charBefore) && /[^a-z]/.test(charAfter);
        if (isWordIsolated) {
          return w;
        }
      }
    }
    return null;
  }

  _isWordInSpokenText(word, spokenText) {
    if (!spokenText) return false;
    const cleanWord = word.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
    const cleanSpoken = spokenText.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
    
    const words = cleanSpoken.split(/\s+/);
    return words.some(w => w === cleanWord || w.startsWith(cleanWord) || cleanWord.startsWith(w));
  }

  cancelSpeech() {
    this.speechQueue = [];
    this.currentSegmentIndex = 0;
    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }
    if (this.activeUtterance) {
      this.activeUtterance.onstart = null;
      this.activeUtterance.onend = null;
      this.activeUtterance.onerror = null;
      this.activeUtterance = null;
    }
    this.queuedUtterances = [];
    if (this.synth) {
      this.synth.cancel();
    }
  }

  // Safe wrapper to prevent duplicate starts
  startRecognitionInternal() {
    if (!this.recognition) {
      console.warn("[voice.js] Speech recognition is not supported or blocked in this context.");
      if (this.onRecognitionStateChange) {
        this.onRecognitionStateChange('off', 'unsupported_origin_or_browser');
      }
      return;
    }
    if (this.isRecognitionActive) return;
    // Allow starting recognition while speaking to support wake word or stop interrupts

    // Prevent hot-looping if started too recently (throttling)
    const now = Date.now();
    const timeSinceLastStart = now - (this.lastStartTime || 0);
    const minInterval = 600; // Minimum 600ms between starts (reduced for responsiveness)
    if (timeSinceLastStart < minInterval) {
      const waitTime = minInterval - timeSinceLastStart;
      console.log(`[voice.js] Throttling speech recognition start, waiting ${waitTime}ms...`);
      if (this.retryStartTimeout) clearTimeout(this.retryStartTimeout);
      this.retryStartTimeout = setTimeout(() => this.startRecognitionInternal(), waitTime);
      return;
    }

    try {
      this.recognition.start();
      this.isRecognitionActive = true;
      this.lastStartTime = Date.now();
      this.isTransitioning = false; // Clear transition lock on successful start
    } catch (e) {
      console.warn("Failed to start speech recognition:", e);
      this.isTransitioning = false;
    }
  }

  // Safe wrapper to avoid overlap requests
  stopRecognitionInternal() {
    if (this.retryStartTimeout) {
      clearTimeout(this.retryStartTimeout);
      this.retryStartTimeout = null;
    }
    this.pendingStart = false;
    if (this.isRecognitionActive && !this.isStopping) {
      this.isStopping = true;
      try {
        this.recognition.stop();
      } catch (e) {}
    }
  }

  async warmUpMic() {
    if (this.dummyStream) return;
    try {
      this.dummyStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[voice.js] Microphone stream warmed up successfully.");
      if (this.isCommandListeningActive && this.biometrics) {
        this.biometrics.startAnalysis(this.dummyStream);
      }
    } catch (e) {
      console.warn("[voice.js] Failed to warm up microphone:", e);
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || e.message?.includes('Permission denied') || e.message?.includes('Permission dismissed')) {
        if (this.onMicPermissionBlocked) {
          this.onMicPermissionBlocked();
        }
      }
    }
  }

  // Continuous background listener for "Lukas" / "Alexa"
  startWakeWordListener() {
    if (!this.recognition) return;
    this.warmUpMic(); // Keep hardware mic warm
    
    this.isListeningForWakeWord = true;
    this.isCommandListeningActive = false;
    
    if (this.isRecognitionActive) {
      this.isTransitioning = false;
      if (this.onRecognitionStateChange) {
        this.onRecognitionStateChange('wakeword');
      }
      return;
    }
    
    this.isTransitioning = true;
    this.cancelSpeech();
    
    if (this.isStopping) {
      this.pendingStart = true;
    } else {
      this.startRecognitionInternal();
    }
  }

  // Stop background listener
  stopWakeWordListener() {
    this.isListeningForWakeWord = false;
    // Do NOT stop recognition here to keep mic active for speech interrupts
  }

  // Toggle vocal feedback output
  toggleMute(state) {
    if (state !== undefined) {
      this.isMuted = state;
    } else {
      this.isMuted = !this.isMuted;
    }
    localStorage.setItem('lukas_muted', this.isMuted);
    
    if (this.isMuted) {
      this.cancelSpeech(); // Mute immediately stops active vocalization
    }
    return this.isMuted;
  }

  // Dynamic segments parser
  _parseSpeechSegments(text) {
    const segments = [];
    const regex = /\[(EMOTION|PAUSE):\s*([^\]]+)\]/gi;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const textSegment = text.slice(lastIndex, match.index).trim();
      if (textSegment) {
        segments.push({ type: 'text', content: textSegment });
      }

      const tagType = match[1].toUpperCase();
      const tagValue = match[2].trim();

      if (tagType === 'EMOTION') {
        segments.push({ type: 'emotion', value: tagValue.toLowerCase() });
      } else if (tagType === 'PAUSE') {
        const duration = parseInt(tagValue, 10);
        segments.push({ type: 'pause', duration: isNaN(duration) ? 200 : duration });
      }

      lastIndex = regex.lastIndex;
    }

    const remainingText = text.slice(lastIndex).trim();
    if (remainingText) {
      segments.push({ type: 'text', content: remainingText });
    }

    return segments;
  }

  // Vocalize responses — progressive sentence chunking for low latency with prosody
  speak(text) {
    this.lastSpokenText = text;
    this.latency.speechStartAt = Date.now();
    this.cancelSpeech();
    this.spokenTextAccumulated = "";

    // Set temporary speaking emotion based on configuration
    this.currentSpeechEmotion = this.emotionalToneMode === 'adaptive' ? null : this.emotionalToneMode;

    const segments = this._parseSpeechSegments(text);
    const finalSegments = [];

    for (const seg of segments) {
      if (seg.type === 'text') {
        const sentences = this._splitIntoSentences(seg.content);
        for (let i = 0; i < sentences.length; i++) {
          finalSegments.push({ type: 'text', content: sentences[i] });
          // Inject a soft breathing/comma pause between sentences (180ms-250ms)
          if (i < sentences.length - 1) {
            finalSegments.push({ type: 'pause', duration: 200 });
          }
        }
      } else {
        finalSegments.push(seg);
      }
    }

    this.speechQueue = finalSegments;
    this.currentSegmentIndex = 0;

    if (this.onSpeechStart && this.speechQueue.length > 0) {
      this.onSpeechStart();
    }

    this._processNextSpeechSegment();
  }

  _processNextSpeechSegment() {
    if (this.currentSegmentIndex >= this.speechQueue.length) {
      this.speakingText = '';
      if (this.onSpeechEnd) this.onSpeechEnd();
      return;
    }

    const seg = this.speechQueue[this.currentSegmentIndex];
    this.currentSegmentIndex++;

    if (seg.type === 'emotion') {
      this.currentSpeechEmotion = seg.value.toLowerCase();
      this._processNextSpeechSegment();
    } else if (seg.type === 'pause') {
      this.activeTimeout = setTimeout(() => {
        this._processNextSpeechSegment();
      }, seg.duration);
    } else if (seg.type === 'text') {
      this.speakSegmentText(seg.content);
    }
  }

  _applyIndianPronunciations(text) {
    if (!text) return text;
    
    // Custom pronunciation dictionary mapping Indian names, cities, and brands
    const dict = {
      'karthik': 'Kaarthik',
      'raghav': 'Raaghav',
      'srinivas': 'Shreenivaas',
      'lakshmi': 'Lakshmee',
      'shankar': 'Shankara',
      'bengaluru': 'Bengalooroo',
      'mysuru': 'Mysooroo',
      'hubballi': 'Hoobballi',
      'mangalis': 'Mangalooroo',
      'mangaluru': 'Mangalooroo',
      'shivamogga': 'Shivamoagha',
      'swiggy': 'Swiggy',
      'zomato': 'Zomaato',
      'flipkart': 'Flipkart',
      'wzatco': 'Wee-Zatco'
    };

    let processed = text;
    for (const [key, replacement] of Object.entries(dict)) {
      const regex = new RegExp(`\\b${key}\\b`, 'gi');
      processed = processed.replace(regex, replacement);
    }
    return processed;
  }

  speakSegmentText(cleanedText) {
    if (!cleanedText || !cleanedText.trim()) {
      this._processNextSpeechSegment();
      return;
    }

    if (!this.synth || this.isMuted) {
      this._processNextSpeechSegment();
      return;
    }

    // Accumulate the spoken text for robust echo detection
    const normalizedSegment = cleanedText.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
    this.spokenTextAccumulated = (this.spokenTextAccumulated ? this.spokenTextAccumulated + " " : "") + normalizedSegment;

    // Apply phonetic substitution dictionary to spoken text, keeping cleanedText intact for tracking
    const spokenText = this._applyIndianPronunciations(cleanedText);
    const utterance = new SpeechSynthesisUtterance(spokenText);
    this.activeUtterance = utterance;

    // Dynamic language detection
    const detectedLang = this.detectLanguageOfText(cleanedText);
    const speechLang = detectedLang || this.speechLang || 'en-IN';
    const activeVoice = this.getVoiceForLanguage(speechLang);
    if (activeVoice) {
      utterance.voice = activeVoice;
      utterance.lang = activeVoice.lang;
    } else {
      utterance.lang = speechLang;
    }
    
    // Determine dynamic speaking rate
    let baseRate = 1.0;
    if (this.speakingRateProfile === 'slow') {
      baseRate = 0.82;
    } else if (this.speakingRateProfile === 'fast') {
      baseRate = 1.25;
    } else {
      baseRate = this.vocalRate || 1.0;
    }

    // Apply custom Indian Accent cadence shifts
    if (this.preferredAccent === 'bengaluru_professional') {
      baseRate *= 0.92; // Deliberate, slower rhythm with mild Kannada-esque pauses
    } else if (this.preferredAccent === 'kannada_native') {
      baseRate *= 0.95; // Steady, native stress patterns
    }

    let pitch = 0.95;
    let rateMultiplier = 1.0;

    const emotion = this.currentSpeechEmotion || 'normal';
    if (emotion === 'excited' || emotion === 'enthusiastic') {
      pitch = 1.08;
      rateMultiplier = 1.15;
    } else if (emotion === 'calm' || emotion === 'empathy' || emotion === 'empathetic') {
      pitch = 0.92;
      rateMultiplier = 0.88;
    } else if (emotion === 'confident' || emotion === 'professional') {
      pitch = 0.98;
      rateMultiplier = 1.0;
    } else if (emotion === 'urgency' || emotion === 'urgent') {
      pitch = 1.05;
      rateMultiplier = 1.25;
    } else if (emotion === 'encouragement' || emotion === 'encouraging') {
      pitch = 1.02;
      rateMultiplier = 1.05;
    }

    utterance.pitch = pitch;
    utterance.rate = baseRate * rateMultiplier;
    utterance.volume = this.vocalVolume;

    this.speakingText = cleanedText.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");

    if (this.recognitionManager) {
      this.recognitionManager.transitionTo('SPEAKING');
    }

    utterance.onend = () => {
      this.activeUtterance = null;
      this._processNextSpeechSegment();
    };

    utterance.onerror = (err) => {
      console.error("Speech Synthesis Utterance Error:", err);
      this.activeUtterance = null;
      this._processNextSpeechSegment();
    };

    this.synth.speak(utterance);
  }

  // Redirect legacy calls
  speakSentence(text) {
    this.speak(text);
  }

  // Split text on sentence boundaries for progressive TTS
  _splitIntoSentences(text) {
    const clean = text.replace(/[*_`]/g, '').replace(/\[.*?\]/g, '').trim();
    const parts = clean.match(/[^.!?]+[.!?](?:\s|$)|[^.!?]+$/g) || [clean];
    return parts.map(s => s.trim()).filter(s => s.length > 1);
  }

  // Detect language based on unicode script blocks and signature words
  detectLanguageOfText(text) {
    if (!text) return null;
    
    // Japanese (Hiragana/Katakana / Kanji)
    if (/[\u3040-\u309f\u30a0-\u30ff]/i.test(text)) return 'ja-JP';
    // Korean (Hangul)
    if (/[\uac00-\ud7af\u1100-\u11ff]/i.test(text)) return 'ko-KR';
    // Chinese Hanzi (without Japanese kana)
    if (/[\u4e00-\u9fff]/i.test(text)) return 'zh-CN';
    // Russian / Cyrillic
    if (/[\u0400-\u04ff]/i.test(text)) return 'ru-RU';
    // Arabic / Urdu
    if (/[\u0600-\u06ff]/i.test(text)) return 'ar-AE';
    
    // Indic scripts
    if (/[\u0900-\u097f]/i.test(text)) return 'hi-IN'; // Hindi / Marathi
    if (/[\u0980-\u09ff]/i.test(text)) return 'bn-IN'; // Bengali
    if (/[\u0a00-\u0a7f]/i.test(text)) return 'pa-IN'; // Punjabi
    if (/[\u0a80-\u0aff]/i.test(text)) return 'gu-IN'; // Gujarati
    if (/[\u0b80-\u0bff]/i.test(text)) return 'ta-IN'; // Tamil
    if (/[\u0c00-\u0c7f]/i.test(text)) return 'te-IN'; // Telugu
    if (/[\u0c80-\u0cff]/i.test(text)) return 'kn-IN'; // Kannada
    if (/[\u0d00-\u0d7f]/i.test(text)) return 'ml-IN'; // Malayalam
    
    // Check for signature European language markers
    const lower = text.toLowerCase();
    
    // French
    if (/\b(le|la|les|un|une|des|et|en|que|est|dans|pour|qui|avec|sur|plus|nous|vous|elle|elles|oui|non|bonjour|merci)\b/i.test(lower) || /[éàèùâêîôûëïüçœÆ]/i.test(text)) {
      if (lower.includes('oui') || lower.includes('bonjour') || lower.includes('merci') || lower.includes('s\'il') || lower.includes('l\'h')) return 'fr-FR';
    }
    // Spanish
    if (/\b(el|la|los|las|un|una|unos|unas|y|en|que|es|con|por|para|como|pero|este|esta|todo|todos|hola|gracias|sí|no)\b/i.test(lower) || /[áéíóúüñ¿¡]/i.test(text)) {
      if (lower.includes('hola') || lower.includes('gracias') || lower.includes('sí') || lower.includes('por favor')) return 'es-ES';
    }
    // German
    if (/\b(der|die|das|und|ist|ich|nicht|zu|es|in|mit|den|von|für|dass|sind|wir|ihr|sie|ja|nein|hallo|danke)\b/i.test(lower) || /[äöüßÄÖÜ]/i.test(text)) {
      if (lower.includes('ja') || lower.includes('hallo') || lower.includes('bitte') || lower.includes('danke') || lower.includes('guten')) return 'de-DE';
    }
    // Portuguese
    if (/\b(o|a|os|as|um|uma|e|em|que|é|com|por|para|como|mas|este|esta|tudo|todos|olá|obrigado|sim|não)\b/i.test(lower) || /[ãõáéíóúçêô]/i.test(text)) {
      if (lower.includes('olá') || lower.includes('obrigado') || lower.includes('sim') || lower.includes('por favor')) return 'pt-PT';
    }
    // Italian
    if (/\b(il|la|i|gli|le|un|una|e|in|che|è|con|per|come|ma|questo|questa|tutto|tutti|ciao|grazie|sì|no)\b/i.test(lower) || /[àèìòùéóí]/i.test(text)) {
      if (lower.includes('ciao') || lower.includes('grazie') || lower.includes('sì') || lower.includes('prego')) return 'it-IT';
    }
    
    return null;
  }

  // Toggle listening recognition process
  toggleListening() {
    if (!this.recognitionManager) {
      return false;
    }

    if (this.isListening) {
      this.stopListeningForCommand();
      return false;
    }

    this.cancelSpeech();
    this.startListeningForCommand();
    return true;
  }

  setVolume(vol) {
    this.vocalVolume = Math.max(0.0, Math.min(1.0, vol));
    localStorage.setItem('lukas_vocal_volume', this.vocalVolume);
  }

  setRate(rate) {
    this.vocalRate = Math.max(0.5, Math.min(2.0, rate));
    localStorage.setItem('lukas_vocal_rate', this.vocalRate);
  }

  setLanguage(lang) {
    this.speechLang = lang;
    localStorage.setItem('lukas_speech_lang', lang);
    if (this.recognitionManager) {
      if (this.recognitionManager.recognition) {
        this.recognitionManager.recognition.lang = lang;
      }
      if (this.isRecognitionActive) {
        console.log(`[voice.js] Speech recognition language changed to ${lang}. Restarting recognition engine...`);
        this.recognitionManager.restart();
      }
    }
    if (this.synth) {
      this.preferredVoice = this.getVoiceForLanguage(lang);
      console.log(`[voice.js] Speech Synthesis voice updated: ${this.preferredVoice?.name || 'Default'} (${this.preferredVoice?.lang || 'unknown'})`);
    }
  }

  setAccent(accent) {
    this.preferredAccent = accent;
    localStorage.setItem('lukas_voice_accent', accent);
    
    // Automatically switch speech recognition language to match accent modes
    if (accent === 'kannada_native') {
      this.setLanguage('kn-IN');
    } else if (['indian_english', 'bengaluru_professional', 'neutral_corporate'].includes(accent)) {
      this.setLanguage('en-IN');
    } else if (accent.startsWith('en-')) {
      this.setLanguage(accent);
    }

    if (this.synth) {
      this.preferredVoice = this.getVoiceForLanguage(this.speechLang || 'en-IN');
      console.log(`[voice.js] Speech Synthesis voice updated for accent: ${this.preferredVoice?.name || 'Default'}`);
    }
  }

  setSpeakingRateProfile(rateProfile) {
    this.speakingRateProfile = rateProfile;
    localStorage.setItem('lukas_voice_rate', rateProfile);
  }

  setEmotionalToneMode(toneMode) {
    this.emotionalToneMode = toneMode;
    localStorage.setItem('lukas_voice_emotional_tone', toneMode);
  }

  startListeningForCommand() {
    this.warmUpMic(); // Keep hardware mic warm
    if (this.recognitionManager) {
      this.recognitionManager.transitionTo('LISTENING');
    }
  }

  stopListeningForCommand() {
    if (this.recognitionManager) {
      this.recognitionManager.transitionTo('STANDBY');
    }
    if (this.biometrics) {
      const voiceprint = this.biometrics.stopAnalysis();
      if (voiceprint) {
        this.lastSpokenVoiceprint = voiceprint;
      }
    }
  }

  resetMicrophoneForCommand() {
    console.log("[voice.js] Wake Recovery: Resetting microphone and starting Conversation Engine...");
    
    // Lock wake system for 2 seconds to prevent double triggers
    this.isWakeLocked = true;
    setTimeout(() => { this.isWakeLocked = false; }, 2000);

    this.accumulatedSpeechText = "";
    this.lastSessionTranscript = "";

    if (this.recognitionManager) {
      this.recognitionManager.restart();
      this.recognitionManager.transitionTo('LISTENING');
    }
  }
}

export default LukasVoiceController;
