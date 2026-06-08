import fs from 'fs';
import path from 'path';
import LukasSupervisor from '../src/ai/supervisor.js';
import LukasVerificationAgent from '../src/ai/verification.js';

// Setup Mock DOM Environment
class MockElement {
  constructor(id = '', tagName = '') {
    this.id = id;
    this.tagName = tagName;
    this.style = {};
    this.classList = {
      classes: new Set(),
      contains(c) { return this.classes.has(c); },
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); }
    };
    this.children = [];
    this.listeners = {};
    this.innerHTML = '';
    this.textContent = '';
    this.value = '50';
    this.checked = false;
  }

  addEventListener(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  appendChild(child) {
    this.children.push(child);
  }

  querySelector(selector) {
    // Return mock sub-elements for device card testing
    if (selector === '.device-spinner' || selector === '.device-status-line' || selector === '.device-error-icon') {
      return new MockElement('', 'div');
    }
    return null;
  }
}

global.document = {
  elements: {},
  getElementById(id) {
    if (!this.elements[id]) {
      this.elements[id] = new MockElement(id);
    }
    return this.elements[id];
  },
  querySelector(selector) {
    if (selector.startsWith('#') || selector.startsWith('.')) {
      return this.getElementById(selector.slice(1));
    }
    if (selector.includes('zoneLivingRoom') || selector.includes('zoneKitchen') || selector.includes('zoneBedroom')) {
      return this.getElementById('zoneCard');
    }
    return new MockElement('', 'div');
  },
  createElement(tagName) {
    return new MockElement('', tagName);
  }
};

global.window = {
  location: { href: 'http://localhost:3000/' }
};

global.chatHistory = new MockElement('chatHistory');

// Mock fetch to simulate the /api/write-agent-log backend endpoint in Node.js test environment
global.fetch = async (url, options) => {
  if (url === '/api/write-agent-log') {
    const { agent, entry } = JSON.parse(options.body);
    const logsDir = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const logFile = path.join(logsDir, `${agent}.log`);
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf8');
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  }
  return { ok: false, status: 404 };
};

// Mock Globals
global.DEVICES = {
  LIVING_ROOM: 'livingRoomLight',
  BEDROOM: 'bedroomLight',
  KITCHEN: 'kitchenLight',
  OUTDOOR: 'outdoorLock'
};

global.ROUTINES = {
  MORNING: 'morning',
  CINEMA: 'cinema',
  ECO: 'eco',
  LOCKDOWN: 'lockdown'
};

global.isProcessingCommand = false;

global.diag = {
  logToTerminal(msg, level = 'info') {
    console.log(`[DIAG - ${level.toUpperCase()}] ${msg}`);
  }
};

global.appendChatBubble = (text, role) => {
  console.log(`[CHAT BUBBLE - ${role.toUpperCase()}] ${text}`);
};

global.voice = {
  stopWakeWordListener() {
    console.log('[VOICE] Stopped wake word listener.');
  },
  speak(msg) {
    console.log(`[VOICE SPEAK] ${msg}`);
  }
};

global.lukasMemory = {
  addMessage(role, text, category) {
    console.log(`[MEMORY addMessage] role=${role} category=${category} text="${text}"`);
  }
};

// Setup Mock Home (Automation Hub)
class MockHome {
  constructor() {
    this.dynamicDevices = [
      { id: 'livingRoomLight', name: 'Living Room Light', category: 'light', zone: 'Living Room', on: true, brightness: 80, color: '#ff0000' },
      { id: 'bedroomLight', name: 'Bedroom Light', category: 'light', zone: 'Bedroom', on: true, brightness: 60, color: '#ffffff' },
      { id: 'kitchenLight', name: 'Kitchen Light', category: 'light', zone: 'Kitchen', on: false, brightness: 50, color: '#ffffff' },
      { id: 'outdoorLock', name: 'Outdoor Lock', category: 'security', zone: 'Outdoor', locked: true }
    ];
    this.state = {
      climate: { targetTemp: 22, mode: 'cool', indoorTemp: 24 },
      devices: {
        outdoorLock: { locked: true }
      }
    };
  }

  getDeviceById(id) {
    // Handle resolve mappings
    const aliasMap = {
      livingRoom: 'livingRoomLight',
      bedroom:    'bedroomLight',
      kitchen:    'kitchenLight',
      outdoor:    'outdoorLock',
    };
    const resolvedId = aliasMap[id] || id;
    return this.dynamicDevices.find(d => d.id === resolvedId);
  }

  async setDeviceState(id, updates) {
    console.log(`[MockHome.setDeviceState] id=${id} updates=${JSON.stringify(updates)}`);
    const dev = this.getDeviceById(id);
    if (dev) {
      Object.assign(dev, updates);
      
      // Sync DOM states to simulate reactive rendering, so that verification succeeds
      let domPrefix = '';
      if (id === 'livingRoomLight') domPrefix = 'Living';
      else if (id === 'bedroomLight') domPrefix = 'Bedroom';
      else if (id === 'kitchenLight') domPrefix = 'Kitchen';
      
      if (domPrefix) {
        if (updates.on !== undefined) {
          document.getElementById(`lightSwitch${domPrefix}`).checked = updates.on;
        }
        if (updates.brightness !== undefined) {
          document.getElementById(`dimmer${domPrefix}`).value = String(updates.brightness);
        }
        if (updates.color !== undefined) {
          document.getElementById(`color${domPrefix}`).value = updates.color;
        }
      } else if (id === 'outdoorLock') {
        if (updates.locked !== undefined) {
          document.getElementById('doorLockOutdoor').checked = updates.locked;
        }
      }
    }
  }

  setTargetTemperature(val) {
    console.log(`[MockHome.setTargetTemperature] val=${val}`);
    this.state.climate.targetTemp = val;
  }

  setClimateMode(mode) {
    console.log(`[MockHome.setClimateMode] mode=${mode}`);
    this.state.climate.mode = mode;
  }

  saveDynamicDevices() {
    console.log('[MockHome.saveDynamicDevices] Saved.');
  }
}

global.home = new MockHome();

// Mock resolveDevice function from main.js
global.resolveDevice = (targetName, category, targetZone) => {
  if (!targetName) return { device: null, ambiguous: false, matches: [] };
  const searchName = targetName.toLowerCase().trim();
  
  let zoneFilter = targetZone || null;
  if (!zoneFilter) {
    if (searchName.includes('living room') || searchName.includes('livingroom')) zoneFilter = 'Living Room';
    else if (searchName.includes('bedroom')) zoneFilter = 'Bedroom';
    else if (searchName.includes('kitchen')) zoneFilter = 'Kitchen';
    else if (searchName.includes('outdoor')) zoneFilter = 'Outdoor';
  }

  let devices = [...home.dynamicDevices];
  if (zoneFilter) {
    devices = devices.filter(d => d.zone.toLowerCase() === zoneFilter.toLowerCase());
  }
  if (category) {
    devices = devices.filter(d => d.category === category);
  }

  let matches = devices.filter(d => {
    return d.name.toLowerCase().includes(searchName) || searchName.includes(d.name.toLowerCase()) || d.id.toLowerCase() === searchName;
  });

  if (matches.length === 0) return { device: null, ambiguous: false, matches: [] };
  if (matches.length > 1) return { device: null, ambiguous: true, matches };
  return { device: matches[0], ambiguous: false, matches };
};

// Replicate setDeviceStateWithFeedback from main.js
global.setDeviceStateWithFeedback = async (deviceId, updates) => {
  console.log(`[setDeviceStateWithFeedback] deviceId=${deviceId} updates=${JSON.stringify(updates)}`);
  await home.setDeviceState(deviceId, updates);
};

// Instantiate Supervisors & Verification Agents
global.lukasSupervisor = new LukasSupervisor();
global.lukasVerify = new LukasVerificationAgent();

// Extract LukasMultiTaskEngine from main.js
const mainJsContent = fs.readFileSync(path.resolve(process.cwd(), 'main.js'), 'utf8');

const classStart = mainJsContent.indexOf('class LukasMultiTaskEngine {');
if (classStart === -1) {
  console.error("Could not find class LukasMultiTaskEngine in main.js");
  process.exit(1);
}

// Find class end (end of construct, methods, etc.)
// We know from grep that constructor starts near 1141 and next system components or functions start after line 2141.
// Let's find the closing bracket of the class.
// We can balance brackets starting from classStart
let bracketCount = 0;
let pos = classStart;
let classContent = "";

while (pos < mainJsContent.length) {
  const char = mainJsContent[pos];
  classContent += char;
  if (char === '{') bracketCount++;
  else if (char === '}') {
    bracketCount--;
    if (bracketCount === 0) {
      break;
    }
  }
  pos++;
}

console.log(`Extracted LukasMultiTaskEngine code successfully. Length: ${classContent.length} chars.`);

// Eval class definition
const evalScope = new Function('return ' + classContent);
const LukasMultiTaskEngine = evalScope();

// Run Multi-Action Engine Verification
async function runTests() {
  console.log("\n==========================================================");
  console.log("RUNNING LUKAS MULTI-TASK ENGINE INTEGRATION TESTS...");
  console.log("==========================================================\n");

  const engine = new LukasMultiTaskEngine();

  // Test Case 1: Multi-device lighting execution and verification
  // Directive: "turn off living room light and turn on kitchen"
  const actions = [
    {
      id: 1,
      category: 'light',
      action: 'off',
      targetZone: 'Living Room',
      targetDeviceName: 'Living Room Light',
      isGlobal: false,
      value: null,
      dependsOn: []
    },
    {
      id: 2,
      category: 'light',
      action: 'on',
      targetZone: 'Kitchen',
      targetDeviceName: 'Kitchen Light',
      isGlobal: false,
      value: null,
      dependsOn: []
    }
  ];

  console.log("--- Executing Test Case 1: Turn off Living Room and Turn on Kitchen ---");
  await engine.run(actions, 'mock-key', 'openai', 'turn off living room light and turn on kitchen');

  // Assertions
  const livingDev = home.getDeviceById('livingRoomLight');
  const kitchenDev = home.getDeviceById('kitchenLight');
  
  if (!livingDev.on && kitchenDev.on) {
    console.log("\n[PASS] Test Case 1 succeeded. Device states verified: Living Room (OFF), Kitchen (ON).");
  } else {
    console.error("\n[FAIL] Test Case 1 failed. Living Room state:", livingDev.on, "Kitchen state:", kitchenDev.on);
    process.exit(1);
  }

  // Verify log files were written
  console.log("\n--- Checking generated specialized logs ---");
  const expectedLogs = ['planner.log', 'voice.log', 'reasoning.log', 'monitoring.log', 'verification.log', 'audit.log', 'home.log'];
  
  for (const file of expectedLogs) {
    const p = path.resolve(process.cwd(), 'logs', file);
    if (fs.existsSync(p)) {
      const size = fs.statSync(p).size;
      console.log(`[PASS] Log file "${file}" exists and contains data (${size} bytes)`);
    } else {
      console.error(`[FAIL] Expected log file "${file}" was not created.`);
      process.exit(1);
    }
  }

  // Test Case 2: Thermostat adjustment execution
  // Directive: "set temperature to 25"
  const climateActions = [
    {
      id: 3,
      category: 'climate',
      action: 'set',
      targetZone: null,
      targetDeviceName: 'Thermostat',
      isGlobal: false,
      value: '25',
      dependsOn: []
    }
  ];

  console.log("\n--- Executing Test Case 2: Set thermostat to 25 ---");
  await engine.run(climateActions, 'mock-key', 'openai', 'set temperature to 25');

  if (home.state.climate.targetTemp === 25) {
    console.log("\n[PASS] Test Case 2 succeeded. Thermostat set to 25°C.");
  } else {
    console.error("\n[FAIL] Test Case 2 failed. Climate temp:", home.state.climate.targetTemp);
    process.exit(1);
  }

  // Test Case 3: Verification Failure & State Rollback
  // Let's force a state verification mismatch. We'll command the bedroom light to turn off, but mock the DOM switch state to remain checked (ON).
  // The verification agent should retry 3 times, fail, report a warning, and rollback.
  console.log("\n--- Executing Test Case 3: Force verification mismatch and rollback ---");
  
  // Disable automatic DOM check syncing for bedroomLight to force mismatch
  const originalSetState = home.setDeviceState;
  home.setDeviceState = async function(id, updates) {
    console.log(`[MockHome.setDeviceState - Forced Mismatch] id=${id} updates=${JSON.stringify(updates)}`);
    const dev = this.getDeviceById(id);
    if (dev) {
      Object.assign(dev, updates);
      // We do NOT update document.getElementById('lightSwitchBedroom').checked
      // So the DOM check remains checked=true (ON) while dev.on is set to false.
      document.getElementById('lightSwitchBedroom').checked = true; 
    }
  };

  const failActions = [
    {
      id: 4,
      category: 'light',
      action: 'off',
      targetZone: 'Bedroom',
      targetDeviceName: 'Bedroom Light',
      isGlobal: false,
      value: null,
      dependsOn: []
    }
  ];

  // Let's speed up polling in verification agent for this test case
  lukasVerify.POLL_INTERVAL = 10; 

  try {
    await engine.run(failActions, 'mock-key', 'openai', 'turn off bedroom light');
  } catch (err) {
    console.log(`Caught expected error: ${err.message}`);
  }

  // Restore state syncing
  home.setDeviceState = originalSetState;

  // Verify rollback happened: Bedroom light should still be ON (restored from snapshot)
  const bedroomDev = home.getDeviceById('bedroomLight');
  if (bedroomDev.on) {
    console.log("\n[PASS] Test Case 3 succeeded. Rollback verified: Bedroom Light remains ON.");
  } else {
    console.error("\n[FAIL] Test Case 3 failed. Rollback did not restore Bedroom Light state to ON.");
    process.exit(1);
  }

  // Verify recovery log was populated
  const recoveryLogPath = path.resolve(process.cwd(), 'logs', 'recovery.log');
  if (fs.existsSync(recoveryLogPath)) {
    const size = fs.statSync(recoveryLogPath).size;
    console.log(`[PASS] Log file "recovery.log" exists and contains details (${size} bytes)`);
  } else {
    console.error(`[FAIL] Expected log file "recovery.log" was not created.`);
    process.exit(1);
  }

  console.log("\n==========================================================");
  console.log("ALL MULTI-TASK INTEGRATION TESTS PASSED!");
  console.log("==========================================================\n");
}

runTests().catch(e => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
