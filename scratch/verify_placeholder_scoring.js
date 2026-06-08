import { scoreResponse } from '../src/ai/core.js';

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

console.log("=========================================");
console.log("RUNNING LUKAS PLACEHOLDER SCORING TESTS...");
console.log("=========================================");

// Test Case 1: Valid response with system headers and voice tags
const userInput = "Hello Lukas, verify if you are here and operational";
const validResponse = `[EXECUTIVE ANALYSIS]
User Goal: check if active
Actual Objective: verify system state
Best Next Step: respond conversationally

[RESPONSE]
[EMOTION: Calm] Yes, Commander. [PAUSE: 300] I am here and operational.`;

const score1 = scoreResponse(userInput, validResponse);
console.log(`Valid response score: ${score1.score}, Issues:`, score1.issues);
assert(score1.score >= 95, "Valid response scored high.");
assert(score1.issues.length === 0, "No issues found in valid response.");

// Test Case 2: Robotic response with unresolved placeholders in brackets
const roboticResponse = `Understood. To facilitate this, I'll start by drafting the email for you to send, as well as scheduling the meeting for 2 PM.

### Draft Email:
**Subject:** Meeting Scheduled for Today at 2 PM
**Body:**
Dear [Recipient's Name],

I hope this message finds you well. I would like to confirm our meeting scheduled for today at 2 PM. Please let me know if this time is still convenient for you.

Thank you, and I look forward to our discussion.

Best regards,
[Your Name]
[Your Contact Information]

---
### Meeting Details:
- **Time:** 2 PM
- **Date:** [Today’s date]
- **Platform:** [Specify virtual platform if applicable, e.g., Google Meet, Zoom, etc.]`;

const score2 = scoreResponse(userInput, roboticResponse);
console.log(`Robotic response score: ${score2.score}, Issues:`, score2.issues);
assert(score2.score < 70, "Robotic response with placeholders scored low.");
assert(score2.issues.some(i => i.includes('Contains unresolved placeholder or unapproved bracket tag')), "Correctly flagged unresolved bracket placeholders.");

console.log("=========================================");
console.log("ALL LOGIC VALIDATION TESTS PASSED!");
console.log("=========================================");
process.exit(0);
