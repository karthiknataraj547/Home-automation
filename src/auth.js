/**
 * LUKAS / JARVIS Holographic Authentication Engine
 * Secure client-side password hashing and session management using Web Crypto API.
 */

// Helper to hash password using SHA-256
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Check if user account exists
export function userExists(username) {
  const accounts = JSON.parse(localStorage.getItem('lukas_accounts') || '{}');
  return !!accounts[username.toLowerCase()];
}

// Create account
export async function registerUser(username, password) {
  const normName = username.trim().toLowerCase();
  if (!normName || !password) return { success: false, message: 'Invalid Username/Password' };
  
  const accounts = JSON.parse(localStorage.getItem('lukas_accounts') || '{}');
  if (accounts[normName]) {
    return { success: false, message: 'Terminal Identity Already Assigned' };
  }
  
  const hashedPassword = await hashPassword(password);
  accounts[normName] = {
    username: username.trim(),
    hash: hashedPassword,
    createdAt: new Date().toISOString()
  };
  
  localStorage.setItem('lukas_accounts', JSON.stringify(accounts));
  return { success: true, message: 'Security Clearance Created Successfully' };
}

// Authenticate user
export async function loginUser(username, password) {
  const normName = username.trim().toLowerCase();
  if (!normName || !password) return { success: false, message: 'Invalid Credentials' };
  
  const accounts = JSON.parse(localStorage.getItem('lukas_accounts') || '{}');
  const account = accounts[normName];
  if (!account) {
    return { success: false, message: 'Access Denied: Unrecognized Signature' };
  }
  
  const hashedPassword = await hashPassword(password);
  if (account.hash !== hashedPassword) {
    return { success: false, message: 'Access Denied: Incorrect Security Phrase' };
  }
  
  // Set session token
  sessionStorage.setItem('lukas_session', JSON.stringify({
    username: account.username,
    token: 'sec_clearance_' + Math.random().toString(36).substring(2),
    loginTime: new Date().toISOString()
  }));
  
  return { success: true, message: 'Clearance Confirmed. Loading System Core...' };
}

// Check if logged in
export function isAuthenticated() {
  return !!sessionStorage.getItem('lukas_session');
}

// Get logged in user details
export function getSessionUser() {
  const session = sessionStorage.getItem('lukas_session');
  return session ? JSON.parse(session) : null;
}

// End session
export function logoutUser() {
  sessionStorage.removeItem('lukas_session');
}
