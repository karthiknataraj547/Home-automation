// voiceprint.js - Local Voice Biometrics & Speaker Identification Engine
// Analyzes frequency spectrums (FFT) of active speech to construct a normalized voiceprint.

class LukasVoiceprintAnalyzer {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.analysisInterval = null;

    // We focus on the core speech frequency range (80 Hz to 2600 Hz)
    // For 44100Hz sample rate and fftSize = 512, each bin is ~86.13Hz.
    // Bins 1 to 30 cover ~86Hz to ~2584Hz.
    this.startBin = 1;
    this.endBin = 30;

    // Feature accumulation buffer
    this.accumulatedSum = new Array(this.endBin - this.startBin + 1).fill(0);
    this.frameCount = 0;
    this.isRecording = false;

    // Minimum spectral energy threshold to classify a frame as speech (prevents noise pollution)
    this.speechThreshold = 15;
  }

  /**
   * Start analyzing microphone audio stream
   */
  startAnalysis(mediaStream) {
    if (this.isRecording) return;
    this.reset();
    this.stream = mediaStream;

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.source = this.audioContext.createMediaStreamSource(mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.5;

      this.source.connect(this.analyser);
      this.isRecording = true;

      // Sample frequency data every 50ms during active speech
      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      this.analysisInterval = setInterval(() => {
        if (!this.isRecording || !this.analyser) return;

        this.analyser.getByteFrequencyData(dataArray);

        // Calculate total speech band energy
        let speechBandSum = 0;
        for (let i = this.startBin; i <= this.endBin; i++) {
          speechBandSum += dataArray[i];
        }
        const avgEnergy = speechBandSum / (this.endBin - this.startBin + 1);

        // If energy is high enough, accumulate this frame as speech
        if (avgEnergy > this.speechThreshold) {
          for (let i = this.startBin; i <= this.endBin; i++) {
            this.accumulatedSum[i - this.startBin] += dataArray[i];
          }
          this.frameCount++;
        }
      }, 50);

      console.log("[LUKAS BIOMETRICS] Voice frequency analysis started.");
    } catch (e) {
      console.error("[LUKAS BIOMETRICS] Failed to start Web Audio analysis:", e);
    }
  }

  /**
   * Stop analyzing mic stream and return the computed, normalized voiceprint signature vector
   */
  stopAnalysis() {
    this.isRecording = false;
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }

    if (this.frameCount === 0) {
      console.warn("[LUKAS BIOMETRICS] Stopped analysis, but no valid speech frames were captured.");
      this.cleanup();
      return null;
    }

    // Compute average frequency vector
    const avgVector = this.accumulatedSum.map(sum => sum / this.frameCount);

    // Normalize the vector (Euclidean normalization / unit length)
    // This makes matching scale-invariant (independent of how loud the user speaks)
    let magnitudeSq = 0;
    for (let val of avgVector) {
      magnitudeSq += val * val;
    }
    const magnitude = Math.sqrt(magnitudeSq);

    this.cleanup();

    if (magnitude === 0) {
      return null;
    }

    const normalizedVector = avgVector.map(val => val / magnitude);
    console.log(`[LUKAS BIOMETRICS] Voice print computed from ${this.frameCount} speech frames. Magnitude: ${magnitude.toFixed(2)}`);
    return normalizedVector;
  }

  /**
   * Reset analysis accumulators
   */
  reset() {
    this.accumulatedSum.fill(0);
    this.frameCount = 0;
  }

  /**
   * Close audio contexts and release stream nodes
   */
  cleanup() {
    if (this.source) {
      try { this.source.disconnect(); } catch (e) {}
      this.source = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      try { this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }
    this.analyser = null;
  }

  /**
   * Compare two normalized voiceprints using Cosine Similarity
   */
  calculateSimilarity(printA, printB) {
    if (!printA || !printB || printA.length !== printB.length) return 0;
    let dotProduct = 0;
    for (let i = 0; i < printA.length; i++) {
      dotProduct += printA[i] * printB[i];
    }
    return dotProduct; // Since prints are normalized, dotProduct is the cosine similarity (0.0 to 1.0)
  }

  /**
   * Save a voice profile to local storage
   */
  saveProfile(name, voiceprint) {
    if (!name || !voiceprint) return false;
    try {
      const profiles = this.getProfiles();
      profiles[name.trim()] = voiceprint;
      localStorage.setItem("lukas_voice_profiles", JSON.stringify(profiles));
      console.log(`[LUKAS BIOMETRICS] Voice print registered for profile: "${name}"`);
      return true;
    } catch (e) {
      console.error("[LUKAS BIOMETRICS] Failed to save voice profile:", e);
      return false;
    }
  }

  /**
   * Clear all registered profiles
   */
  clearProfiles() {
    localStorage.removeItem("lukas_voice_profiles");
    console.log("[LUKAS BIOMETRICS] Wiped all voice prints.");
  }

  /**
   * Get all registered voice profiles from localStorage
   */
  getProfiles() {
    try {
      return JSON.parse(localStorage.getItem("lukas_voice_profiles") || "{}");
    } catch (e) {
      return {};
    }
  }

  /**
   * Identify a user by comparing their live print against saved profiles
   */
  identify(livePrint, threshold = 0.88) {
    if (!livePrint) return { name: "Guest", confidence: 0 };

    const profiles = this.getProfiles();
    let bestMatch = "Guest";
    let bestScore = 0;

    for (const [name, savedPrint] of Object.entries(profiles)) {
      const score = this.calculateSimilarity(livePrint, savedPrint);
      console.log(`[LUKAS BIOMETRICS] Matching against ${name}: Similarity Score = ${score.toFixed(4)}`);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = name;
      }
    }

    if (bestScore >= threshold) {
      return { name: bestMatch, confidence: bestScore };
    }

    return { name: "Guest", confidence: bestScore };
  }
}

export default LukasVoiceprintAnalyzer;
