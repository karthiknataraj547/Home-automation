// ═══════════════════════════════════════════════════════════════════════
// LUKAS Device Verification Agent
// Verifies that device commands actually took effect before
// reporting success. Eliminates false confirmations.
//
// Verification pipeline:
//   Command Sent → State Readback → Expected vs Actual → Pass/Fail
// ═══════════════════════════════════════════════════════════════════════

class LukasVerificationAgent {
  constructor() {
    this._pendingVerifications = new Map(); // id → { device, expected, resolve }
    this._results = [];       // last 100 verification results
    this._maxResults = 100;

    // How long to wait for a device to respond (ms)
    this.POLL_INTERVAL = 800;
    this.MAX_RETRIES   = 3;
    this.TUYA_VERIFY   = true; // Re-read Tuya state from cloud after command
  }

  // ─── Primary Verification Method ─────────────────────────────────────────

  /**
   * Verify a device command was executed successfully.
   *
   * @param {object} automationHub    Reference to LukasAutomationHub
   * @param {string} deviceId         Device ID (e.g. 'livingRoomLight')
   * @param {object} expectedUpdates  { on: true } or { brightness: 80 } etc.
   * @param {object} options          { tuyaCreds?, maxRetries?, supervisor? }
   * @returns {Promise<VerificationResult>}
   */
  async verifyDeviceCommand(automationHub, deviceId, expectedUpdates, options = {}) {
    const { tuyaCreds, maxRetries = this.MAX_RETRIES, supervisor = null } = options;
    const startTime = Date.now();

    if (supervisor) {
      supervisor.logAgentAction('verification', `Verifying "${deviceId}" → ${JSON.stringify(expectedUpdates)}`, 'info');
    }

    let retries = 0;
    let lastResult = null;

    while (retries < maxRetries) {
      await this._sleep(this.POLL_INTERVAL);

      // Read current device state
      let device = automationHub.getDeviceById(deviceId);
      if (!device && deviceId === 'reminder') {
        device = { id: 'reminder', name: 'Reminder System', category: 'reminder' };
      }
      if (!device) {
        lastResult = this._buildResult(deviceId, expectedUpdates, null, startTime, 'device_not_found');
        break;
      }

      // Check all expected fields and visual DOM states
      const mismatch = this._findMismatch(device, expectedUpdates, deviceId);

      if (!mismatch) {
        // All fields match — success
        lastResult = this._buildResult(deviceId, expectedUpdates, device, startTime, 'state_match');
        break;
      }

      retries++;
      if (retries < maxRetries) {
        if (supervisor) {
          supervisor.logAgentAction('verification',
            `Retry ${retries}/${maxRetries} for "${deviceId}": ${mismatch}. Re-sending command...`, 'warn');
          supervisor.logAgentAction('recovery',
            `[RETRY] Re-sending command to "${deviceId}" (Attempt ${retries}/${maxRetries}) due to mismatch: ${mismatch}`, 'warn');
        }
        try {
          await automationHub.setDeviceState(deviceId, expectedUpdates);
        } catch (err) {
          if (supervisor) {
            supervisor.logAgentAction('verification', `Re-send attempt failed for "${deviceId}": ${err.message}`, 'error');
            supervisor.logAgentAction('recovery', `[RETRY ERROR] Re-send failed for "${deviceId}": ${err.message}`, 'error');
          }
        }
      }
    }

    // If all local retries failed AND it's a Tuya device — try cloud readback
    if (lastResult === null || !lastResult.verified) {
      const device = automationHub.getDeviceById(deviceId);
      if (device && device.integration === 'tuya-cloud' && tuyaCreds && this.TUYA_VERIFY) {
        if (supervisor) {
          supervisor.logAgentAction('recovery', `[CLOUD FALLBACK] Local verification failed. Triggering cloud status query for: ${device.name}`, 'info');
        }
        const cloudResult = await this._verifyTuyaCloud(device, expectedUpdates, tuyaCreds, startTime);
        lastResult = cloudResult;
      } else {
        lastResult = lastResult || this._buildResult(deviceId, expectedUpdates, null, startTime, 'timeout');
      }
    }

    // Log result
    this._results.push(lastResult);
    if (this._results.length > this._maxResults) this._results.shift();

    if (supervisor) {
      supervisor.logAgentAction(
        'verification',
        `[${lastResult.verified ? '✓ PASS' : '✗ FAIL'}] "${deviceId}": ` +
        `expected=${JSON.stringify(expectedUpdates)} actual=${JSON.stringify(lastResult.actual)} ` +
        `latency=${lastResult.latencyMs}ms method=${lastResult.method}`,
        lastResult.verified ? 'info' : 'warn',
        lastResult
      );
    }

    // Escalation if verification failed
    if (!lastResult.verified) {
      if (supervisor) {
        supervisor.logAgentAction(
          'supervisor',
          `[GOVERNOR ALERT] Escalation: "${deviceId}" failed verification. Details: expected=${JSON.stringify(expectedUpdates)} actual=${JSON.stringify(lastResult.actual)}`,
          'error',
          lastResult
        );
      }
      if (typeof window !== 'undefined' && window.lukasNotify) {
        const dev = automationHub.getDeviceById(deviceId);
        const name = dev ? dev.name : deviceId;
        window.lukasNotify.notifyDeviceFailure(name, `Verification failed (${lastResult.method})`);
      }
    }

    return lastResult;
  }

  // ─── Multi-Device Verification ────────────────────────────────────────────

  /**
   * Verify multiple device commands in parallel.
   * @param {object} automationHub
   * @param {Array<{deviceId, expectedUpdates}>} commands
   * @param {object} options
   * @returns {Promise<Array<VerificationResult>>}
   */
  async verifyMultipleDevices(automationHub, commands, options = {}) {
    const promises = commands.map(({ deviceId, expectedUpdates }) =>
      this.verifyDeviceCommand(automationHub, deviceId, expectedUpdates, options)
    );
    return Promise.all(promises);
  }

  // ─── Tuya Cloud State Readback ────────────────────────────────────────────

  async _verifyTuyaCloud(device, expectedUpdates, creds, startTime) {
    try {
      const resp = await fetch('/api/tuya-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: device.tuyaDeviceId, creds })
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.success && data.state) {
          const mismatch = this._findMismatch(data.state, expectedUpdates, device.id);
          return this._buildResult(device.id, expectedUpdates, data.state, startTime,
            mismatch ? 'tuya_mismatch' : 'tuya_confirmed');
        }
      }
    } catch { /* network error */ }

    return this._buildResult(device.id, expectedUpdates, null, startTime, 'cloud_unreachable');
  }

  // ─── State Comparison ────────────────────────────────────────────────────

  _findMismatch(actual, expected, deviceId) {
    if (deviceId === 'reminder') {
      if (typeof document !== 'undefined') {
        const list = document.getElementById('reminderList');
        if (list) {
          const labels = Array.from(list.querySelectorAll('.ri-label')).map(el => el.textContent.toLowerCase().trim());
          const expectedLabel = String(expected.text).toLowerCase().trim();
          if (!labels.includes(expectedLabel)) {
            return `DOM reminderList does not contain visible reminder label: "${expected.text}"`;
          }
        } else {
          return `DOM element "#reminderList" not found in document.`;
        }
      }
      return null;
    }

    for (const [key, val] of Object.entries(expected)) {
      const actualVal = actual[key];
      if (actualVal === undefined) return `field "${key}" missing`;
      if (typeof val === 'boolean' && actual[key] !== val) return `"${key}" is ${actual[key]} not ${val}`;
      if (typeof val === 'number' && Math.abs(actual[key] - val) > 2) return `"${key}" is ${actual[key]} not ${val}`;
      if (typeof val === 'string' && actual[key]?.toLowerCase() !== val.toLowerCase()) return `"${key}" is "${actual[key]}" not "${val}"`;
    }
    
    // Check actual DOM state in browser environment to avoid false confirmations
    if (typeof document !== 'undefined' && deviceId) {
      let domPrefix = '';
      if (deviceId === 'livingRoomLight' || deviceId === 'livingRoom') domPrefix = 'Living';
      else if (deviceId === 'bedroomLight' || deviceId === 'bedroom') domPrefix = 'Bedroom';
      else if (deviceId === 'kitchenLight' || deviceId === 'kitchen') domPrefix = 'Kitchen';
      
      if (domPrefix) {
        for (const [key, val] of Object.entries(expected)) {
          if (key === 'on') {
            const el = document.getElementById(`lightSwitch${domPrefix}`);
            if (el && el.checked !== val) {
              return `DOM switch for "${domPrefix}" is ${el.checked} not ${val}`;
            }
          } else if (key === 'brightness') {
            const el = document.getElementById(`dimmer${domPrefix}`);
            if (el && Math.abs(parseInt(el.value) - val) > 5) {
              return `DOM dimmer for "${domPrefix}" is ${el.value} not ${val}`;
            }
          } else if (key === 'color') {
            const el = document.getElementById(`color${domPrefix}`);
            if (el) {
              const cleanVal = String(val).toLowerCase();
              const cleanElVal = String(el.value).toLowerCase();
              const colorMap = {
                'red': '#ff0000', 'green': '#10b981', 'blue': '#3b82f6', 'purple': '#a855f7',
                'cyan': '#00f0ff', 'orange': '#ff9f3b', 'white': '#ffffff', 'yellow': '#eab308',
                'pink': '#ec4899', 'magenta': '#d946ef', 'lime': '#84cc16', 'teal': '#14b8a6',
                'gold': '#f59e0b', 'crimson': '#e11d48'
              };
              const mappedVal = colorMap[cleanVal] || cleanVal;
              const mappedElVal = colorMap[cleanElVal] || cleanElVal;
              if (mappedElVal !== mappedVal) {
                return `DOM color for "${domPrefix}" is "${el.value}" not "${val}"`;
              }
            }
          }
        }
      } else if (deviceId === 'outdoorLock' || deviceId === 'outdoor') {
        for (const [key, val] of Object.entries(expected)) {
          if (key === 'locked') {
            const el = document.getElementById('doorLockOutdoor');
            if (el && el.checked !== val) {
              return `DOM doorLockOutdoor is ${el.checked} not ${val}`;
            }
          } else if (key === 'floodlights') {
            const el = document.getElementById('floodlightsOutdoor');
            if (el && el.checked !== val) {
              return `DOM floodlightsOutdoor is ${el.checked} not ${val}`;
            }
          }
        }
      }
    }
    
    return null; // all match
  }

  _buildResult(deviceId, expected, actual, startTime, method) {
    return {
      deviceId,
      expected,
      actual: actual ? Object.fromEntries(Object.keys(expected).map(k => [k, actual[k]])) : null,
      verified: ['state_match', 'tuya_confirmed'].includes(method),
      latencyMs: Date.now() - startTime,
      method,
      ts: new Date().toISOString()
    };
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ─── Results & Diagnostics ────────────────────────────────────────────────

  getRecentResults(n = 20) {
    return this._results.slice(-n);
  }

  getSuccessRate() {
    if (this._results.length === 0) return 100;
    const passed = this._results.filter(r => r.verified).length;
    return Math.round((passed / this._results.length) * 100);
  }

  getStatusReport() {
    return {
      totalVerifications: this._results.length,
      successRate: this.getSuccessRate(),
      recentResults: this.getRecentResults(5)
    };
  }
}

export default LukasVerificationAgent;
