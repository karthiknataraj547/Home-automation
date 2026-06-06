// voice.js - LUKAS voice communication sub-module
// Integrates HTML5 Web Speech API (SpeechRecognition & SpeechSynthesis)

class LukasVoiceController {
  constructor() {
    this.synth = window.speechSynthesis;
    this.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = null;
    this.queuedUtterances = [];
    
    this.isMuted = localStorage.getItem('lukas_muted') === 'true';
    const storedVol  = parseFloat(localStorage.getItem('lukas_vocal_volume'));
    const storedRate = parseFloat(localStorage.getItem('lukas_vocal_rate'));
    this.vocalVolume = isNaN(storedVol)  ? 1.0 : storedVol;
    this.vocalRate   = isNaN(storedRate) ? 1.0 : storedRate;
    this.isListening = false;
    this.isListeningForWakeWord = false;
    this.isLongConversation = false;
    this.speakingText = '';
    this.wakeWordTimeout = null;
    
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

  // Find a suitable futuristic/clean voice
  initSpeechSynthesis() {
    if (!this.synth) return;
    
    // Voices are loaded asynchronously
    const loadVoices = () => {
      const voices = this.synth.getVoices();
      // Search for high-quality English voices
      // Prefer Google US English, Microsoft David, or general English male/female
      this.preferredVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Natural') || v.name.includes('David')) || 
                           voices.find(v => v.lang.startsWith('en-')) || 
                           voices[0];
    };
    
    loadVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = loadVoices;
    }
  }

  // Initialize Speech-to-Text Recognition
  initSpeechRecognition() {
    if (!this.SpeechRecognition) {
      console.warn("Web Speech Recognition API is not supported in this browser.");
      return;
    }

    try {
      this.recognition = new this.SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true; // Enabled interim results for fast interruption!
      this.speechLang = localStorage.getItem('lukas_speech_lang') || 'en-IN';
      this.recognition.lang = this.speechLang;

      this.recognition.onstart = () => {
        this.isRecognitionActive = true;
        this.consecutiveErrors = 0; // Reset consecutive errors on successful start
        this.isListening = this.isLongConversation || this.isCommandListeningActive || !this.isListeningForWakeWord;
        if (this.onRecognitionStateChange) {
          if (this.isListeningForWakeWord) {
            this.onRecognitionStateChange('wakeword');
          } else if (this.isListening || this.isCommandListeningActive || this.isLongConversation) {
            this.onRecognitionStateChange('command');
          } else {
            this.onRecognitionStateChange('off');
          }
        }
      };

      this.recognition.onend = () => {
        this.isRecognitionActive = false;
        this.isStopping = false;
        
        // Prevent infinite restart-fail loops on mobile/Safari
        if (this.consecutiveErrors >= 4) {
          const isFatal = this.lastError === 'not-allowed' || this.lastError === 'service-not-allowed';
          if (!isFatal && (this.isListeningForWakeWord || this.isCommandListeningActive || this.isLongConversation)) {
            console.warn(`[voice.js] Encountered ${this.consecutiveErrors} consecutive errors (${this.lastError || 'unknown'}). Backing off for 6 seconds before retrying...`);
            this.consecutiveErrors = 0; // reset counter
            setTimeout(() => {
              if (this.isListeningForWakeWord || this.isCommandListeningActive || this.isLongConversation) {
                this.startRecognitionInternal();
              }
            }, 6000);
            return;
          }

          console.warn("[voice.js] Halting recognition restarts due to fatal error or permission denial (lastError=" + this.lastError + ").");
          this.isListeningForWakeWord = false;
          this.isCommandListeningActive = false;
          this.isLongConversation = false;
          this.isListening = false;
          this.pendingStart = false;
          if (this.onRecognitionStateChange) {
            this.onRecognitionStateChange('off', 'mic_suspended');
          }
          return;
        }

        // If we are transitioning to a new mode, let the transition handle the restart
        if (this.isTransitioning) {
          console.log("[voice.js] Recognition ended during transition — deferring to transition handler.");
          return;
        }

        // Dynamically increase delay if we are hitting consecutive errors or aborts
        const delay = this.consecutiveErrors > 3 ? 2500 : (this.consecutiveErrors > 1 ? 1000 : 200);
        if (this.consecutiveErrors > 1) {
          console.warn(`[voice.js] Backing off recognition restart delay to ${delay}ms due to consecutive errors (${this.consecutiveErrors}).`);
        }
        
        // Handle pending state-machine start actions cleanly
        if (this.pendingStart) {
          this.pendingStart = false;
          setTimeout(() => this.startRecognitionInternal(), delay);
        } else if (this.isCommandListeningActive) {
          // Save the current session's last transcript before restarting
          if (this.lastSessionTranscript) {
            this.accumulatedSpeechText = (this.accumulatedSpeechText + " " + this.lastSessionTranscript).trim();
            this.lastSessionTranscript = "";
          }
          setTimeout(() => this.startRecognitionInternal(), delay);
        } else if (this.isListeningForWakeWord || this.isLongConversation) {
          setTimeout(() => this.startRecognitionInternal(), delay);
        } else {
          this.isListening = false;
          if (this.onRecognitionStateChange) {
            this.onRecognitionStateChange('off');
          }
        }
      };

      this.recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        this.lastError = event.error;
        
        if (event.error === 'not-allowed') {
          if (this.onMicPermissionBlocked) {
            this.onMicPermissionBlocked();
          }
        }
        
        // Ignore noise/no-speech errors to avoid breaking loops
        if (event.error === 'no-speech' && (this.isListeningForWakeWord || this.isLongConversation || this.isCommandListeningActive)) {
          this.consecutiveErrors = 0; // Reset on normal silence
          return; 
        }

        if (event.error === 'aborted') {
          console.warn("Speech recognition aborted. Will attempt restart if active.");
          this.consecutiveErrors++;
          return;
        }

        // For other serious errors (blocked mic, no permission, etc.), stop everything to prevent infinite loops
        this.isCommandListeningActive = false;
        this.isListening = false;
        this.isListeningForWakeWord = false;
        this.isLongConversation = false;
        this.pendingStart = false;
        this.consecutiveErrors++;
        
        if (this.onRecognitionStateChange) {
          this.onRecognitionStateChange('off', event.error);
        }
      };

      this.recognition.onresult = (event) => {
        let fullTranscript = "";
        for (let i = 0; i < event.results.length; i++) {
          fullTranscript += event.results[i][0].transcript + " ";
        }
        fullTranscript = fullTranscript.trim();
        
        const isFinal = event.results[event.resultIndex].isFinal;
        
        // Interrupt check while speaking
        if (this.synth && this.synth.speaking) {
          const userSpeech = fullTranscript.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
          const isEcho = this.speakingText && (this.speakingText.includes(userSpeech) || userSpeech.includes(this.speakingText));
          if (!isEcho && userSpeech.length > 2) {
            console.log(`[INTERRUPT] User spoke during vocalization: "${userSpeech}"`);
            this.synth.cancel();
            this.speakingText = '';
            
            // Trigger speech end animations
            if (this.onSpeechEnd) this.onSpeechEnd();
            
            // Transition to active command listening instead of wake word
            this.isListeningForWakeWord = false;
            this.isCommandListeningActive = true;
            this.accumulatedSpeechText = "";
            this.lastSessionTranscript = "";
            
            // Stop and restart recognition to reset state
            try { this.recognition.stop(); } catch(e) {}
            setTimeout(() => {
              try { this.recognition.start(); } catch(e) {}
              if (this.onWakeWordDetected) this.onWakeWordDetected(); // Wake up LUKAS UI!
            }, 100);
            return;
          }
          return; // Ignore other sounds/echoes while LUKAS is speaking
        }

        // Keep track of the current session's latest transcript
        this.lastSessionTranscript = fullTranscript;

        // If we are accumulating transcripts across restarts
        let displayTranscript = fullTranscript;
        if (this.isCommandListeningActive && this.accumulatedSpeechText) {
          displayTranscript = (this.accumulatedSpeechText + " " + fullTranscript).trim();
        }

        // Trigger real-time interim speech detection callback
        if (this.onSpeechDetected) {
          let textToDisplay = displayTranscript;
          if (this.isListeningForWakeWord) {
            const lowerText = displayTranscript.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
            const wakeWords = this.wakeWords;
            
            let matchedWakeWord = null;
            let wakeWordIndex = -1;
            for (const w of wakeWords) {
              const index = lowerText.indexOf(w);
              if (index !== -1) {
                const charBefore = index > 0 ? lowerText[index - 1] : ' ';
                const charAfter = index + w.length < lowerText.length ? lowerText[index + w.length] : ' ';
                const isWordIsolated = /[^a-z]/.test(charBefore) && /[^a-z]/.test(charAfter);
                if (isWordIsolated) {
                  matchedWakeWord = w;
                  wakeWordIndex = index;
                  break;
                }
              }
            }

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

        // Continuous wake word checking on every speech update (both interim and final)
        if (this.isListeningForWakeWord) {
          const lowerText = displayTranscript.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
          const wakeWords = this.wakeWords;
          
          let matchedWakeWord = null;
          let wakeWordIndex = -1;
          for (const w of wakeWords) {
            const index = lowerText.indexOf(w);
            if (index !== -1) {
              const charBefore = index > 0 ? lowerText[index - 1] : ' ';
              const charAfter = index + w.length < lowerText.length ? lowerText[index + w.length] : ' ';
              const isWordIsolated = /[^a-z]/.test(charBefore) && /[^a-z]/.test(charAfter);
              if (isWordIsolated) {
                matchedWakeWord = w;
                wakeWordIndex = index;
                break;
              }
            }
          }
          
          if (matchedWakeWord) {
            const commandAfterWakeWord = lowerText.substring(wakeWordIndex + matchedWakeWord.length).trim();
            const isJustWakeWord = commandAfterWakeWord.length === 0;
            
            if (isJustWakeWord) {
              // User might have paused. Schedule greeting in 600ms.
              if (this.wakeWordTimeout) clearTimeout(this.wakeWordTimeout);
              this.wakeWordTimeout = setTimeout(() => {
                console.log("Wake word detected (paused)!");
                this.stopWakeWordListener();
                if (this.onWakeWordDetected) {
                  this.onWakeWordDetected();
                }
              }, 600);
            } else {
              // User kept speaking (inline command). Clear any pending greeting.
              if (this.wakeWordTimeout) {
                clearTimeout(this.wakeWordTimeout);
                this.wakeWordTimeout = null;
              }
            }
            
            // Only return early if this is an interim result (not final).
            // If it is final, we want to let it fall through to the isFinal block so the inline command gets processed!
            if (!isFinal) {
              return;
            }
          } else if (lowerText === 'stop' || lowerText === 'stop listening' || lowerText === 'go to sleep' || lowerText === 'stand down' || lowerText === 'deactivate voice' || lowerText === 'mute microphone' || lowerText.startsWith('stop ')) {
            console.log("Stop command detected during passive listening.");
            this.stopWakeWordListener();
            if (this.onCommandRecognized) {
              this.onCommandRecognized(displayTranscript);
            }
            return;
          }
        }

        if (isFinal) {
          console.log(`Speech recognized (final): "${displayTranscript}"`);
          if (this.isListeningForWakeWord) {
            // Wake word listener is active, but we got a finalized inline command containing the wake word
            const lowerText = displayTranscript.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
            const wakeWords = this.wakeWords;
            
            let matchedWakeWord = null;
            let wakeWordIndex = -1;
            for (const w of wakeWords) {
              const index = lowerText.indexOf(w);
              if (index !== -1) {
                const charBefore = index > 0 ? lowerText[index - 1] : ' ';
                const charAfter = index + w.length < lowerText.length ? lowerText[index + w.length] : ' ';
                const isWordIsolated = /[^a-z]/.test(charBefore) && /[^a-z]/.test(charAfter);
                if (isWordIsolated) {
                  matchedWakeWord = w;
                  wakeWordIndex = index;
                  break;
                }
              }
            }
            
            if (matchedWakeWord) {
              console.log("Inline command finalized!");
              this.stopWakeWordListener();
              
              const originalLower = displayTranscript.toLowerCase();
              const originalWakeIndex = originalLower.indexOf(matchedWakeWord);
              let command = displayTranscript;
              if (originalWakeIndex !== -1) {
                command = displayTranscript.substring(originalWakeIndex + matchedWakeWord.length).trim();
              }
              // Clean leading punctuation and spaces robustly
              command = command.replace(/^[^a-zA-Z0-9]+/, '').trim();
              
              if (command.length === 0) {
                // Just the wake word was finalized. Trigger wake word detected immediately!
                if (this.wakeWordTimeout) {
                  clearTimeout(this.wakeWordTimeout);
                  this.wakeWordTimeout = null;
                }
                if (this.onWakeWordDetected) {
                  this.onWakeWordDetected();
                }
              } else {
                if (this.onCommandRecognized) {
                  this.onCommandRecognized(command);
                }
              }
              return;
            }
          } else {
            if (this.onCommandRecognized) {
              this.onCommandRecognized(displayTranscript);
            }
          }
        }
      };
    } catch (e) {
      console.error("Failed to initialize speech recognition:", e);
    }
  }

  cancelSpeech() {
    this.queuedUtterances = [];
    if (this.activeUtterance) {
      this.activeUtterance.onstart = null;
      this.activeUtterance.onend = null;
      this.activeUtterance.onerror = null;
      this.activeUtterance = null;
    }
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
    if (this.synth && this.synth.speaking) {
      console.log("[voice.js] Delaying speech recognition start because synthesis is active.");
      if (this.retryStartTimeout) clearTimeout(this.retryStartTimeout);
      this.retryStartTimeout = setTimeout(() => this.startRecognitionInternal(), 600);
      return;
    }

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

  // Vocalize responses
  speak(text) {
    this.lastSpokenText = text;
    this.cancelSpeech();
    this.speakSentence(text);
  }

  // Stream-compatible sentence speak handler
  speakSentence(text) {
    if (!text || !text.trim()) return;
    
    if (!this.synth || this.isMuted) {
      if (this.onSpeechStart && this.queuedUtterances.length === 0) this.onSpeechStart();
      setTimeout(() => {
        if (this.queuedUtterances.length === 0 && this.onSpeechEnd) this.onSpeechEnd();
      }, 800);
      return;
    }

    const cleanedText = text.replace(/[*_`]/g, '').replace(/\[.*\]/g, '').trim();
    if (!cleanedText) return;

    const utterance = new SpeechSynthesisUtterance(cleanedText);
    this.queuedUtterances.push(utterance);

    if (this.preferredVoice) {
      utterance.voice = this.preferredVoice;
    }
    
    // Set slightly robotic pitch/rate parameters
    utterance.pitch = 0.95; 
    utterance.volume = this.vocalVolume;
    utterance.rate = this.vocalRate;

    utterance.onstart = () => {
      this.speakingText = cleanedText.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
      if (this.onSpeechStart && this.queuedUtterances[0] === utterance) {
        this.onSpeechStart();
      }
      if (this.isLongConversation) {
        try {
          this.recognition.start();
        } catch(e) {}
      }
    };

    const handleFinished = () => {
      const idx = this.queuedUtterances.indexOf(utterance);
      if (idx !== -1) {
        this.queuedUtterances.splice(idx, 1);
      }
      if (this.queuedUtterances.length === 0) {
        this.speakingText = '';
        if (this.onSpeechEnd) this.onSpeechEnd();
      }
    };

    utterance.onend = handleFinished;
    utterance.onerror = (err) => {
      console.error("Speech Synthesis Utterance Error:", err);
      handleFinished();
    };

    this.synth.speak(utterance);
  }

  // Toggle listening recognition process
  toggleListening() {
    if (!this.recognition) {
      return false;
    }

    if (this.isListening) {
      this.stopListeningForCommand();
      return false;
    }

    if (this.isListeningForWakeWord) {
      this.isListeningForWakeWord = false;
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
    if (this.recognition) {
      this.recognition.lang = lang;
      if (this.isRecognitionActive) {
        console.log(`[voice.js] Speech recognition language changed to ${lang}. Restarting recognition engine...`);
        try {
          this.recognition.stop();
        } catch(e) {}
      }
    }
  }

  startListeningForCommand() {
    this.isLongConversation = false;
    this.isListeningForWakeWord = false;
    this.isCommandListeningActive = true;
    this.accumulatedSpeechText = "";
    this.lastSessionTranscript = "";
    
    this.warmUpMic(); // Keep hardware mic warm
    
    if (this.isRecognitionActive) {
      this.isTransitioning = false;
      if (this.onRecognitionStateChange) {
        this.onRecognitionStateChange('command');
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

  stopListeningForCommand() {
    this.isLongConversation = false;
    this.isListeningForWakeWord = false;
    this.isCommandListeningActive = false;
    this.stopRecognitionInternal();
  }
}

export default LukasVoiceController;
