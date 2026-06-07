// execution.js - LUKAS Execution Tracking & Verification Engine

export class LukasExecutionTracker {
  constructor(context = {}) {
    this.voice = context.voice;
    this.home = context.home;
    this.diag = context.diag;
    this.handleAssistantResponse = context.handleAssistantResponse;
  }

  setContext(context) {
    if (context.voice) this.voice = context.voice;
    if (context.home) this.home = context.home;
    if (context.diag) this.diag = context.diag;
    if (context.handleAssistantResponse) this.handleAssistantResponse = context.handleAssistantResponse;
  }

  /**
   * Tracks execution of a function.
   * If it takes > 3 seconds, vocalizes: "Still working on your request."
   * Retries up to 3 times if error is a network or timeout error.
   */
  async trackExecution(taskName, taskFn, maxRetries = 3) {
    let attempts = 0;
    let success = false;
    let result = null;
    let lastError = null;

    // Start 3-second watchdog timer
    let stillWorkingTimer = setTimeout(() => {
      if (!success && !lastError) {
        const msg = "Still working on your request.";
        if (this.diag) {
          this.diag.logToTerminal(`[EXECUTION WATCHDOG] Task "${taskName}" taking longer than 3s. Vocalizing standby status...`, "info");
        }
        if (this.voice) {
          this.voice.speak(msg);
        }
      }
    }, 3000);

    while (attempts < maxRetries && !success) {
      attempts++;
      try {
        if (this.diag) {
          this.diag.logToTerminal(`[EXECUTION ENGINE] Running "${taskName}" (Attempt ${attempts}/${maxRetries})...`, "info");
        }
        result = await taskFn();
        success = true;
      } catch (err) {
        lastError = err;
        if (this.diag) {
          this.diag.logToTerminal(`[EXECUTION ENGINE] Attempt ${attempts} failed for "${taskName}": ${err.message}`, "warn");
        }
        if (attempts < maxRetries) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    clearTimeout(stillWorkingTimer);

    if (success) {
      return result;
    } else {
      const failMsg = `Execution failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`;
      if (this.diag) {
        this.diag.logToTerminal(`[EXECUTION ENGINE] ❌ ${failMsg}`, "error");
      }
      if (this.voice) {
        this.voice.speak(`Sorry, the action failed: ${lastError?.message || 'Unknown error'}`);
      }
      throw lastError;
    }
  }

  /**
   * Room Match -> Category/Type Match -> Exact Device ID Match.
   */
  resolveDevice(targetName, category, targetZone) {
    if (!targetName) return { device: null, ambiguous: false, matches: [] };
    const searchName = targetName.toLowerCase().trim();
    
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
    const devices = this.home ? this.home.dynamicDevices : [];

    if (zoneFilter) {
      matches = devices.filter(d => {
        const matchZone = d.zone.toLowerCase() === zoneFilter.toLowerCase();
        if (category && ['light', 'climate', 'security', 'media', 'lock'].includes(category)) {
          return matchZone && d.category === category;
        }
        return matchZone;
      });
    }

    if (matches.length === 0) {
      matches = devices.filter(d => {
        const devName = d.name.toLowerCase();
        const nameMatch = devName.includes(searchName) || searchName.includes(devName);
        if (category && ['light', 'climate', 'security', 'media', 'lock'].includes(category)) {
          return nameMatch && d.category === category;
        }
        return nameMatch;
      });
    }

    // Exact match takes precedence
    const exactMatch = matches.find(d => d.name.toLowerCase() === searchName);
    if (exactMatch) {
      return { device: exactMatch, ambiguous: false, matches: [exactMatch] };
    }

    if (matches.length > 1) {
      return { device: null, ambiguous: true, matches: matches };
    }

    return { device: matches[0] || null, ambiguous: false, matches: matches };
  }

  /**
   * Verifies the states of modified devices
   */
  verifyStates(expectedDeviceStates, expectedClimateStates) {
    let passed = true;
    const mismatchDetails = [];
    const devices = this.home ? this.home.dynamicDevices : [];

    for (const [devId, expectedProps] of Object.entries(expectedDeviceStates)) {
      const dev = devices.find(d => d.id === devId);
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

    if (this.home && this.home.state && this.home.state.climate) {
      for (const [prop, val] of Object.entries(expectedClimateStates)) {
        if (this.home.state.climate[prop] !== val) {
          passed = false;
          mismatchDetails.push(`Climate ${prop} mismatch: expected ${val}, got ${this.home.state.climate[prop]}`);
        }
      }
    }

    return { passed, details: mismatchDetails.join(', ') };
  }
}
