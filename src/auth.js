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

// Stub for exchanging OAuth 2.0 auth code for JWT tokens
export async function exchangeOAuthCodeForToken(code) {
  console.log(`[AUTH STACK] Exchanging OAuth authorization code: ${code}`);
  await new Promise(r => setTimeout(r, 600));
  
  const mockJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsdWthcyIsIm5hbWUiOiJDb21tYW5kZXIiLCJpYXQiOjE1MTYyMzkwMjJ9.stubSignature';
  const mockRefreshToken = 'stub_refresh_token_' + Math.random().toString(36).substring(2);
  
  const session = {
    username: 'Commander',
    token: mockJwt,
    refreshToken: mockRefreshToken,
    loginTime: new Date().toISOString(),
    expiresIn: 3600
  };
  
  sessionStorage.setItem('lukas_session', JSON.stringify(session));
  return { success: true, session };
}

// Stub for JWT token rotation and refresh
export async function refreshJWTToken(refreshToken) {
  console.log(`[AUTH STACK] Rotating JWT session token using refresh token...`);
  await new Promise(r => setTimeout(r, 300));
  
  const newJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsdWthcyIsIm5hbWUiOiJDb21tYW5kZXIiLCJpYXQiOjE1MTYyNDI2MjJ9.newStubSignature';
  const session = getSessionUser();
  if (session) {
    session.token = newJwt;
    session.loginTime = new Date().toISOString();
    sessionStorage.setItem('lukas_session', JSON.stringify(session));
    return { success: true, token: newJwt };
  }
  return { success: false, error: 'No active session found to refresh.' };
}
