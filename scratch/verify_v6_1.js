import fs from 'fs';
import path from 'path';

// Mock minimal browser globals for testing
global.window = {
  location: { href: 'http://localhost:3000/' }
};
global.localStorage = {
  getItem(key) { return null; },
  setItem(key, val) {}
};

// 1. Test Orchestrator Rules
import { INTENT } from '../src/ai/orchestrator.js';
import LukasOrchestrator from '../src/ai/orchestrator.js';

const orchestrator = new LukasOrchestrator(null);

console.log("==========================================");
console.log("TESTING LUKAS ORCHESTRATOR ROUTING MAPPING");
console.log("==========================================");

// Case 1.1: Compound Multi-Task Query
const compoundInput = "Can you fsleep and schedule a meeting with the mail if of karthiknataraj547@gmail.com";
const r1 = orchestrator._classifyByRules(compoundInput);
console.log(`Input: "${compoundInput}"`);
console.log(`Routed to: ${r1.intent} (Confidence: ${r1.confidence}, isComplex: ${r1.isComplex})`);
if (r1.intent === INTENT.PLANNING && r1.isComplex === true && r1.confidence === 0.50) {
  console.log("[PASS] Correctly downgraded rule confidence and mapped compound query to planning.");
} else {
  console.error("[FAIL] Compound query did not match expected route.");
  process.exit(1);
}

// Case 1.2: Correction feedback query
const correctionInput = "i gave you two differnet tasks, i asked you to set a reminder and scchudle a meeting for the mail id personal";
const r2 = orchestrator._classifyByRules(correctionInput);
console.log(`Input: "${correctionInput}"`);
console.log(`Routed to: ${r2.intent} (Confidence: ${r2.confidence})`);
if (r2.intent === INTENT.CONVERSATION && r2.confidence === 0.90) {
  console.log("[PASS] Correctly mapped correction/complaint to conversational mode.");
} else {
  console.error("[FAIL] Correction query did not match expected route.");
  process.exit(1);
}

// 2. Test Task Runner Reminder Step execution
import LukasTaskRunner from '../src/ai/taskrunner.js';

console.log("\n==========================================");
console.log("TESTING TASK RUNNER REMINDER STEP ROUTING");
console.log("==========================================");

// Mock global scheduler, reminder function, and parsing functions
global.lukasReminders = [];
global.addReminder = (text, fireAt) => {
  console.log(`[Mock addReminder] text="${text}" fireAt="${fireAt.toISOString()}"`);
  global.lukasReminders.push({ text, fireAt });
};

global.lukasScheduler = {
  scheduled: [],
  async scheduleCommand(obj) {
    console.log(`[MockScheduler.scheduleCommand] scheduled: ${JSON.stringify(obj)}`);
    this.scheduled.push(obj);
    return 'sched-999';
  }
};

global.parseReminderTime = (cmd) => {
  return new Date(Date.now() + 5 * 60000);
};

global.extractReminderText = (cmd) => {
  return "sleep";
};

global.getSessionUser = () => {
  return { username: 'Commander' };
};

const runner = new LukasTaskRunner();
const reminderStep = {
  id: 1,
  title: "Set sleep reminder",
  description: "remind me to sleep in 5 minutes",
  type: "reminder"
};

const context = {
  memory: null,
  apiKey: "mock-key",
  apiProvider: "openai"
};

runner._executeStep(reminderStep, context).then((output) => {
  console.log(`Step execution output: "${output}"`);
  if (global.lukasReminders.length === 1 && global.lukasReminders[0].text === "sleep") {
    console.log("[PASS] Reminder successfully created via addReminder.");
  } else {
    console.error("[FAIL] Reminder not created.");
    process.exit(1);
  }

  if (global.lukasScheduler.scheduled.length === 1 && global.lukasScheduler.scheduled[0].label === "sleep") {
    console.log("[PASS] Reminder registered in lukasScheduler.");
  } else {
    console.error("[FAIL] Reminder not registered in scheduler.");
    process.exit(1);
  }
}).catch(err => {
  console.error("[FAIL] Reminder execution threw an error:", err);
  process.exit(1);
});

// 3. Test Sentence Splitting logic in Voice Controller
class MockSpeechSynthesisUtterance {
  constructor(text) {
    this.text = text;
  }
}
global.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

console.log("\n==========================================");
console.log("TESTING VOICE SENTENCE SPLITTING Cadence");
console.log("==========================================");

const mainJsContent = fs.readFileSync(path.resolve(process.cwd(), 'src/voice.js'), 'utf8');

// Balancing brackets to extract LukasVoiceController
const startIdx = mainJsContent.indexOf('class LukasVoiceController {');
if (startIdx === -1) {
  console.error("Could not find class LukasVoiceController in voice.js");
  process.exit(1);
}

let bracketCount = 0;
let pos = startIdx;
let classContent = "";
while (pos < mainJsContent.length) {
  const char = mainJsContent[pos];
  classContent += char;
  if (char === '{') bracketCount++;
  else if (char === '}') {
    bracketCount--;
    if (bracketCount === 0) break;
  }
  pos++;
}

const evalScope = new Function('return ' + classContent);
const LukasVoiceController = evalScope();

// Instantiate with mocked speech recognition
global.window.webkitSpeechRecognition = function() {
  return {
    addEventListener() {},
    start() {},
    stop() {},
    abort() {}
  };
};
global.window.speechSynthesis = {
  getVoices() { return []; },
  speak() {}
};

global.LukasVoiceprintAnalyzer = class MockVoiceprintAnalyzer {
  constructor() {}
};

global.SpeechRecognitionManager = class MockSpeechRecognitionManager {
  constructor(controller) {
    this.controller = controller;
    this.state = 'IDLE';
    this.recognition = {
      addEventListener() {},
      start() {},
      stop() {},
      abort() {}
    };
  }
  transitionTo(state) {
    this.state = state;
  }
};

const voice = new LukasVoiceController();
const testSpeechText = "1. Sleep. 2. Code. I am LUKAS.";
const sentences = voice._splitIntoSentences(testSpeechText);
console.log("Test Text:", testSpeechText);
console.log("Splits:", sentences);

if (sentences.includes("1.") && sentences.includes("2.") && sentences.includes("I am LUKAS.")) {
  console.log("[PASS] Sentence splitter successfully preserves short words and list numbers.");
} else {
  console.error("[FAIL] Short sentences or list numbers were skipped.");
  process.exit(1);
}

console.log("\n==========================================");
console.log("ALL V6.1 ARCHITECTURE VALIDATION TESTS PASSED!");
console.log("==========================================\n");
