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

  get className() {
    return Array.from(this.classList.classes).join(' ');
  }

  set className(val) {
    this.classList.classes.clear();
    val.split(/\s+/).forEach(c => {
      if (c) this.classList.classes.add(c);
    });
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

  querySelectorAll(selector) {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const results = [];
      const traverse = (node) => {
        if (node.classList && node.classList.contains && node.classList.contains(cls)) {
          results.push(node);
        }
        if (node.children) {
          node.children.forEach(traverse);
        }
      };
      traverse(this);
      return results;
    }
    return [];
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

const memoryStore = {};
global.lukasMemory = {
  addMessage(role, text, category) {
    console.log(`[MEMORY addMessage] role=${role} category=${category} text="${text}"`);
  },
  getPreference(key, defaultValue) {
    console.log(`[MEMORY getPreference] key=${key}`);
    return memoryStore[key] !== undefined ? memoryStore[key] : defaultValue;
  },
  setPreference(key, value) {
    console.log(`[MEMORY setPreference] key=${key} value=${value}`);
    memoryStore[key] = value;
  }
};

global.getSessionUser = () => {
  return { username: 'TestUser' };
};

global.lukasReminders = [];
global.addReminder = (text, fireAt) => {
  console.log(`[Mock addReminder] text=${text} fireAt=${fireAt}`);
  const rem = { text, fireAt: fireAt.toISOString(), fired: false, createdAt: new Date().toISOString() };
  global.lukasReminders.push(rem);
  
  // Render to DOM
  const reminderList = global.document.getElementById('reminderList');
  if (reminderList) {
    const item = global.document.createElement('div');
    item.className = 'reminder-item';
    const label = global.document.createElement('span');
    label.className = 'ri-label';
    label.textContent = text;
    item.appendChild(label);
    reminderList.appendChild(item);
  }
  
  // Also update preference store to simulate IndexedDB persistence layer syncing
  const list = JSON.parse(global.lukasMemory.getPreference('user_reminders', '[]'));
  list.push(rem);
  global.lukasMemory.setPreference('user_reminders', JSON.stringify(list));
  
  return rem;
};

global.parseReminderTime = (cmd) => {
  const now = new Date();
  if (cmd.includes('5 pm') || cmd.includes('17:00') || cmd.includes('at 5 pm')) {
    const target = new Date(now);
    target.setHours(17, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target;
  }
  return new Date(now.getTime() + 5 * 60000); // 5 mins
};

global.lukasScheduler = {
  scheduled: [],
  async scheduleCommand(obj) {
    console.log(`[MockScheduler.scheduleCommand] scheduled: ${JSON.stringify(obj)}`);
    this.scheduled.push(obj);
    return 'sched-123456';
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

  // Test Case 4: Reminder action execution and verification
  // Directive: "remind me to call John at 5 pm"
  console.log("\n--- Executing Test Case 4: Execute reminder creation with multi-agent pipeline ---");
  


  // Clear mock scheduler and reminders list
  lukasScheduler.scheduled = [];
  global.lukasReminders = [];
  
  // Empty mock DOM reminderList
  const rList = document.getElementById('reminderList');
  if (rList) {
    rList.children = [];
  }

  const reminderActions = [
    {
      id: 5,
      category: 'reminder',
      action: 'create',
      targetZone: null,
      targetDeviceName: null,
      isGlobal: false,
      value: 'call John',
      timeExpression: '5 pm',
      dependsOn: []
    }
  ];

  await engine.run(reminderActions, 'mock-key', 'openai', 'remind me to call John at 5 pm');

  // Verify that the reminder is registered in lukasScheduler
  if (lukasScheduler.scheduled.length === 1) {
    console.log("[PASS] Test Case 4: Reminder registered in Scheduler Agent.");
  } else {
    console.error("[FAIL] Test Case 4: Reminder NOT registered in Scheduler Agent.");
    process.exit(1);
  }

  // Verify that the reminder is inserted in IndexedDB memory via preference layer
  const savedReminders = JSON.parse(lukasMemory.getPreference('user_reminders', '[]'));
  if (savedReminders.length === 1 && savedReminders[0].text === 'call John') {
    console.log("[PASS] Test Case 4: Reminder saved to lukasMemory preference layer.");
  } else {
    console.error("[FAIL] Test Case 4: Reminder NOT found in preference layer.");
    process.exit(1);
  }

  // Verify that lukasVerify successfully checked the visual DOM state
  const verificationLogPath = path.resolve(process.cwd(), 'logs', 'verification.log');
  if (fs.existsSync(verificationLogPath)) {
    const content = fs.readFileSync(verificationLogPath, 'utf8');
    if (content.includes('reminder')) {
      console.log("[PASS] Test Case 4: Verification agent logged reminder visual DOM checks.");
    } else {
      console.error("[FAIL] Test Case 4: Verification agent did not log reminder visual checks.");
      process.exit(1);
    }
  }

  console.log("\n==========================================================");
  console.log("ALL MULTI-TASK INTEGRATION TESTS PASSED!");
  console.log("==========================================================\n");
}

runTests().catch(e => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
