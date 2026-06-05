// voice.js - LUKAS voice communication sub-module
// Integrates HTML5 Web Speech API (SpeechRecognition & SpeechSynthesis)

class LukasVoiceController {
  constructor() {
    this.synth = window.speechSynthesis;
    this.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = null;
    
    this.isMuted = localStorage.getItem('lukas_muted') === 'true';
    const storedVol  = parseFloat(localStorage.getItem('lukas_vocal_volume'));
    const storedRate = parseFloat(localStorage.getItem('lukas_vocal_rate'));
    this.vocalVolume = isNaN(storedVol)  ? 1.0 : storedVol;
    this.vocalRate   = isNaN(storedRate) ? 1.0 : storedRate;
    this.isListening = false;
    this.isListeningForWakeWord = false;
    this.isLongConversation = false;
    this.speakingText = '';
    
    this.onSpeechStart = null;
    this.onSpeechEnd = null;
    this.onCommandRecognized = null;
    this.onRecognitionStateChange = null;
    this.onWakeWordDetected = null;
    this.onSpeechDetected = null;
    
    this.preferredVoice = null;
    
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
      this.recognition.lang = 'en-US';

      this.recognition.onstart = () => {
        this.isListening = this.isLongConversation || !this.isListeningForWakeWord;
        if (this.onRecognitionStateChange) {
          this.onRecognitionStateChange(this.isListeningForWakeWord ? 'wakeword' : (this.isLongConversation ? 'command' : 'off'));
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (this.onRecognitionStateChange) {
          this.onRecognitionStateChange('off');
        }
        
        // Auto-restart if in wake-word mode or long conversation mode and stopped
        if (this.isListeningForWakeWord || this.isLongConversation) {
          try {
            this.recognition.start();
          } catch (e) {
            // Already active or busy
          }
        }
      };

      this.recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        
        // Ignore noise/no-speech errors to avoid breaking continuous loops
        if (event.error === 'no-speech' && (this.isListeningForWakeWord || this.isLongConversation)) {
          return; 
        }

        this.isListening = false;
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
            
            // Stop and restart recognition to reset state
            try { this.recognition.stop(); } catch(e) {}
            setTimeout(() => {
              try { this.recognition.start(); } catch(e) {}
            }, 100);
            return;
          }
        }

        // Trigger real-time interim speech detection callback
        if (this.onSpeechDetected) {
          this.onSpeechDetected(fullTranscript);
        }

        if (isFinal) {
          console.log(`Speech recognized (final): "${fullTranscript}"`);
          if (this.isListeningForWakeWord) {
            const lowerText = fullTranscript.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
            if (lowerText.includes('lukas') || lowerText.includes('lucas') || lowerText.includes('lookas') || lowerText.includes('wake up')) {
              console.log("Wake word detected!");
              this.stopWakeWordListener();
              if (this.onWakeWordDetected) {
                this.onWakeWordDetected();
              }
            } else if (lowerText === 'stop' || lowerText === 'stop listening' || lowerText === 'go to sleep' || lowerText === 'stand down' || lowerText === 'deactivate voice' || lowerText === 'mute microphone' || lowerText.startsWith('stop ')) {
              console.log("Stop command detected during passive listening.");
              this.stopWakeWordListener();
              if (this.onCommandRecognized) {
                this.onCommandRecognized(fullTranscript);
              }
            }
          } else {
            if (this.onCommandRecognized) {
              this.onCommandRecognized(fullTranscript);
            }
          }
        }
      };
    } catch (e) {
      console.error("Failed to initialize speech recognition:", e);
    }
  }

  // Continuous background listener for "Lukas"
  startWakeWordListener() {
    if (!this.recognition) return;
    this.isListeningForWakeWord = true;
    if (this.synth) this.synth.cancel();
    try {
      this.recognition.start();
    } catch (e) {
      // Already active
    }
  }

  // Stop background listener
  stopWakeWordListener() {
    this.isListeningForWakeWord = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Already stopped
      }
    }
  }

  // Toggle vocal feedback output
  toggleMute(state) {
    if (state !== undefined) {
      this.isMuted = state;
    } else {
      this.isMuted = !this.isMuted;
    }
    localStorage.setItem('lukas_muted', this.isMuted);
    
    if (this.isMuted && this.synth) {
      this.synth.cancel(); // Mute immediately stops active vocalization
    }
    return this.isMuted;
  }

  // Vocalize responses
  speak(text) {
    if (!this.synth || this.isMuted) {
      if (this.onSpeechStart) this.onSpeechStart();
      setTimeout(() => {
        if (this.onSpeechEnd) this.onSpeechEnd();
      }, 1000); // Simulate speech end if muted
      return;
    }

    // Cancel active speak tasks
    this.synth.cancel();
    
    // Clean text from custom markdown or symbols
    const cleanedText = text.replace(/[*_`]/g, '').replace(/\[.*\]/g, '');
    this.speakingText = cleanedText.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");

    const utterance = new SpeechSynthesisUtterance(cleanedText);
    this.activeUtterance = utterance; // Prevent garbage collection bug in Chrome
    if (this.preferredVoice) {
      utterance.voice = this.preferredVoice;
    }
    
    // Set slightly robotic pitch/rate parameters
    utterance.pitch = 0.95; 
    utterance.volume = this.vocalVolume;
    utterance.rate = this.vocalRate;

    utterance.onstart = () => {
      if (this.onSpeechStart) this.onSpeechStart();
      // Ensure listening stays active while speaking to capture user interrupts
      if (this.isLongConversation) {
        try {
          this.recognition.start();
        } catch(e) {}
      }
    };

    utterance.onend = () => {
      this.speakingText = '';
      if (this.onSpeechEnd) this.onSpeechEnd();
    };

    utterance.onerror = (err) => {
      console.error("Speech Synthesis Error:", err);
      this.speakingText = '';
      if (this.onSpeechEnd) this.onSpeechEnd();
    };

    this.synth.speak(utterance);
  }

  // Toggle listening recognition process
  toggleListening() {
    if (!this.recognition) {
      return false;
    }

    if (this.isListening) {
      this.recognition.stop();
      return false;
    }

    if (this.isListeningForWakeWord) {
      this.isListeningForWakeWord = false;
    }

    try {
      if (this.synth) this.synth.cancel();
      this.recognition.stop();
    } catch (e) {}

    setTimeout(() => {
      try {
        this.recognition.start();
      } catch (err) {
        console.error("Failed to start speech recognition:", err);
      }
    }, 150);

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

  startListeningForCommand() {
    this.isLongConversation = false;
    this.isListeningForWakeWord = false;
    if (this.synth) this.synth.cancel();
    try {
      this.recognition.start();
    } catch (e) {}
  }

  stopListeningForCommand() {
    this.isLongConversation = false;
    this.isListeningForWakeWord = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
  }
}

export default LukasVoiceController;
