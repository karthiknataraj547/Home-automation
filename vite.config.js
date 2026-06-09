import { defineConfig } from 'vite';
import { spawn, exec }  from 'child_process';
import { createServer }  from 'net';
import dgram             from 'dgram';
import http              from 'http';
import https             from 'https';
import fs                from 'fs';
import path              from 'path';
import crypto            from 'crypto';
import { promisify }     from 'util';

const execAsync = promisify(exec);

// ── State ──────────────────────────────────────────────────────────────────────
let go2rtcProcess    = null;
let ffmpegHlsProcess = null;
let activeRtspUrl    = null;
let pythonProcess    = null;

let cachedInvidiousInstances = null;
let lastInvidiousFetchTime = 0;

function getHealthyInvidiousInstances() {
  const now = Date.now();
  if (cachedInvidiousInstances && (now - lastInvidiousFetchTime < 1800000)) {
    return Promise.resolve(cachedInvidiousInstances);
  }

  const fallbackList = [
    'https://invidious.io.lol',
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://invidious.privacyredirect.com',
    'https://invidious.perennialte.ch',
  ];

  return new Promise((resolve) => {
    https.get({
      hostname: 'api.invidious.io',
      path: '/v1/instances?sort_by=type,health',
      headers: { 'User-Agent': 'LUKAS-AI/1.0', 'Accept': 'application/json' },
      timeout: 4000
    }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const list = JSON.parse(data);
          const instances = [];
          if (Array.isArray(list)) {
            list.forEach(item => {
              if (Array.isArray(item) && item.length > 1 && item[1] && typeof item[1] === 'object') {
                instances.push(item[1]);
              } else if (item && typeof item === 'object') {
                instances.push(item);
              }
            });
          }

          const healthyUrls = instances
            .filter(inst => {
              if (!inst || !inst.uri || inst.type !== 'https' || inst.api !== true) return false;
              if (inst.metadata && inst.metadata.online === false) return false;
              return true;
            })
            .sort((a, b) => {
              const uptimeA = (a.metadata && a.metadata.uptime) || 0;
              const uptimeB = (b.metadata && b.metadata.uptime) || 0;
              return uptimeB - uptimeA;
            })
            .map(inst => inst.uri);

          if (healthyUrls.length > 0) {
            cachedInvidiousInstances = healthyUrls.slice(0, 8);
            lastInvidiousFetchTime = now;
            console.log(`[Music Search Backend] Dynamically fetched ${cachedInvidiousInstances.length} healthy Invidious instances.`);
            resolve(cachedInvidiousInstances);
          } else {
            resolve(fallbackList);
          }
        } catch (err) {
          console.warn('[Music Search Backend] Failed to parse Invidious instances:', err.message);
          resolve(fallbackList);
        }
      });
    }).on('error', (err) => {
      console.warn('[Music Search Backend] Failed to fetch Invidious instances:', err.message);
      resolve(fallbackList);
    }).on('timeout', () => {
      console.warn('[Music Search Backend] Invidious instances fetch timed out.');
      resolve(fallbackList);
    });
  });
}


// ── RTSP candidate paths ──────────────────────────────────────────────────────
const RTSP_PATHS = [
  'ch0_0.264','ch0_1.264','stream0','stream1','onvif1','onvif2',
  'live/ch0','live/ch01','cam/realmonitor?channel=1&subtype=0',
  'h264Preview_01_main','h264Preview_01_sub','mpeg4cif',
];
const RTSP_PASSWORDS = ['', 'admin', '12345', '123456', '11111111'];

// ── HLS output directory ──────────────────────────────────────────────────────
const HLS_DIR = path.resolve(process.cwd(), 'public', 'hls');

function ensureHlsDir() {
  if (!fs.existsSync(HLS_DIR)) fs.mkdirSync(HLS_DIR, { recursive: true });
}

// ── Port probe (TCP connect with timeout) ────────────────────────────────────
function probePort(ip, port, ms = 400) {
  return new Promise(resolve => {
    const sock = createServer().listen(0);       // dummy — just to show dgram import unused warning not needed
    sock.close();
    const net = require('net');
    const s   = new net.Socket();
    s.setTimeout(ms);
    s.connect(port, ip, () => { s.destroy(); resolve(true); });
    s.on('error',   () => { s.destroy(); resolve(false); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

// Probe a set of ports in parallel, return list of open ones
async function probePorts(ip, ports) {
  const net = await import('net');
  const results = await Promise.all(ports.map(port => new Promise(resolve => {
    const s = new net.default.Socket();
    s.setTimeout(400);
    s.connect(port, ip, () => { s.destroy(); resolve(port); });
    s.on('error',   () => { s.destroy(); resolve(null); });
    s.on('timeout', () => { s.destroy(); resolve(null); });
  })));
  return results.filter(Boolean);
}

// ── ONVIF WS-Discovery UDP multicast ────────────────────────────────────────
function runOnvifDiscovery(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const uuid  = Math.random().toString(36).slice(2);
    const probe = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <s:Header>
    <a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
    <a:MessageID>uuid:${uuid}</a:MessageID>
    <a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>
  </s:Header>
  <s:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </s:Body>
</s:Envelope>`;

    const discovered = [];
    const sock = dgram.createSocket('udp4');
    sock.bind(() => {
      try { sock.setBroadcast(true); sock.setMulticastTTL(4); } catch {}
      const msg = Buffer.from(probe);
      sock.send(msg, 0, msg.length, 3702, '239.255.255.250');
    });

    sock.on('message', (msg) => {
      const xml = msg.toString();
      // Extract XAddrs (ONVIF device service URL)
      const xAddr = xml.match(/<[^>]*XAddrs[^>]*>([^<]+)<\/[^>]*XAddrs>/i);
      const scope  = xml.match(/onvif:\/\/www\.onvif\.org\/hardware\/([^\s<"]+)/i);
      const ip     = xAddr ? xAddr[1].match(/(\d+\.\d+\.\d+\.\d+)/) : null;
      if (ip) {
        discovered.push({
          ipAddress: ip[1],
          xAddr:     xAddr[1].trim(),
          hardware:  scope ? scope[1] : 'ONVIF Camera',
          source:    'onvif',
        });
      }
    });

    sock.on('error', () => {});
    setTimeout(() => { try { sock.close(); } catch {} resolve(discovered); }, timeoutMs);
  });
}

// ── HTTP ONVIF probe on a single IP ──────────────────────────────────────────
function probeOnvifHttp(ip, port = 80) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsdl="http://www.onvif.org/ver10/device/wsdl">
  <s:Body><wsdl:GetCapabilities><Category>Media</Category></wsdl:GetCapabilities></s:Body>
</s:Envelope>`;
  return new Promise(resolve => {
    try {
      const opts = { host: ip, port, path: '/onvif/device_service', method: 'POST',
                     headers: { 'Content-Type': 'application/soap+xml; charset=utf-8',
                                'Content-Length': Buffer.byteLength(soap) }, timeout: 3000 };
      const req = http.request(opts, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ ok: true, status: res.statusCode, body: data.slice(0, 400) }));
      });
      req.on('error', () => resolve({ ok: false }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
      req.write(soap);
      req.end();
    } catch { resolve({ ok: false }); }
  });
}

// ── go2rtc manager ───────────────────────────────────────────────────────────
function startGo2RTC() {
  if (go2rtcProcess) { try { go2rtcProcess.kill(); } catch {} go2rtcProcess = null; }
  const bin = path.resolve(process.cwd(), 'go2rtc.exe');
  if (!fs.existsSync(bin)) { console.warn('[go2rtc] go2rtc.exe not found.'); return; }
  console.log('[go2rtc] Starting...');
  go2rtcProcess = spawn(bin, [], { stdio: 'inherit', cwd: process.cwd() });
  go2rtcProcess.on('close', c => { console.log(`[go2rtc] Exited ${c}`); go2rtcProcess = null; });
  go2rtcProcess.on('error', e => console.error('[go2rtc]', e));
}

// ── FFmpeg HLS ───────────────────────────────────────────────────────────────
async function probeRtsp(url) {
  try { await execAsync(`ffprobe -v quiet -rtsp_transport tcp -i "${url}" -show_streams -of json`, { timeout: 4000 }); return true; }
  catch { return false; }
}

async function discoverRtspUrl(ip, user = 'admin', pass = null) {
  const yamlPath = path.resolve(process.cwd(), 'go2rtc.yaml');
  if (fs.existsSync(yamlPath)) {
    const match = fs.readFileSync(yamlPath, 'utf8').match(/rtsp:\/\/\S+/);
    if (match && await probeRtsp(match[0].trim())) return match[0].trim();
  }
  const passes = pass ? [pass, ...RTSP_PASSWORDS] : RTSP_PASSWORDS;
  for (const rtspPath of RTSP_PATHS) {
    for (const p of passes) {
      const url = p ? `rtsp://${user}:${encodeURIComponent(p)}@${ip}:554/${rtspPath}` : `rtsp://${user}@${ip}:554/${rtspPath}`;
      if (await probeRtsp(url)) return url;
    }
  }
  return null;
}

function stopFfmpegHls() {
  if (ffmpegHlsProcess) { try { ffmpegHlsProcess.kill('SIGTERM'); } catch {} ffmpegHlsProcess = null; }
  activeRtspUrl = null;
  try { fs.readdirSync(HLS_DIR).filter(f => f.startsWith('camera1')).forEach(f => fs.unlinkSync(path.join(HLS_DIR, f))); } catch {}
}

function startFfmpegHls(rtspUrl) {
  stopFfmpegHls();
  ensureHlsDir();
  console.log(`[FFmpeg] Starting HLS for ${rtspUrl}`);
  ffmpegHlsProcess = spawn('ffmpeg', [
    '-rtsp_transport','tcp', '-i', rtspUrl,
    '-c:v','copy', '-c:a','aac', '-ar','44100', '-ac','1', '-b:a','64k',
    '-hls_time','1', '-hls_list_size','6', '-hls_flags','delete_segments+append_list',
    '-start_number','0',
    '-hls_segment_filename', path.join(HLS_DIR, 'camera1_%03d.ts'),
    path.join(HLS_DIR, 'camera1.m3u8'),
  ], { stdio: 'pipe' });
  ffmpegHlsProcess.stderr.on('data', d => { const m = d.toString(); if (m.includes('Error') || m.includes('frame=')) console.log('[FFmpeg]', m.slice(0,100)); });
  ffmpegHlsProcess.on('close',  c => { console.log(`[FFmpeg] Exited ${c}`); ffmpegHlsProcess = null; });
  ffmpegHlsProcess.on('error', e => { console.error('[FFmpeg]', e); ffmpegHlsProcess = null; });
  activeRtspUrl = rtspUrl;
}

// ── Python FastAPI Backend Manager ──────────────────────────────────────────
function findPythonExecutable() {
  const candidates = ['python', 'python3', 'py'];
  for (const c of candidates) {
    try {
      const result = require('child_process').execSync(`${c} --version`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      if (result && result.toString().toLowerCase().includes('python')) return c;
    } catch {}
  }
  // Try known Windows paths
  const winPaths = [
    // Confirmed install location (Python 3.11 via winget)
    path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Asus\\AppData\\Local', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Asus\\AppData\\Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Asus\\AppData\\Local', 'Programs', 'Python', 'Python310', 'python.exe'),
    'C:\\Python311\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python310\\python.exe',
  ];
  for (const p of winPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function startPythonBackend() {
  if (pythonProcess) { try { pythonProcess.kill(); } catch {} pythonProcess = null; }
  const serverScript = path.resolve(process.cwd(), 'api', 'server.py');
  if (!fs.existsSync(serverScript)) {
    console.warn('[Python] api/server.py not found. Skipping Python backend.');
    return;
  }
  const pythonExe = findPythonExecutable();
  if (!pythonExe) {
    console.warn('[Python] No Python executable found. Python backend will not start.');
    console.warn('[Python] Install Python 3.10+ and ensure it is on PATH.');
    return;
  }
  console.log(`[Python] Starting FastAPI backend with: ${pythonExe}`);
  pythonProcess = spawn(pythonExe, [serverScript], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env }
  });
  pythonProcess.on('close', c => {
    console.log(`[Python] Backend exited with code ${c}`);
    pythonProcess = null;
  });
  pythonProcess.on('error', e => {
    console.error('[Python] Failed to start:', e.message);
    pythonProcess = null;
  });
  console.log('[Python] FastAPI backend starting on http://127.0.0.1:8000');
}

// ── Clean shutdown ───────────────────────────────────────────────────────────
['exit','SIGINT','SIGTERM'].forEach(sig => process.on(sig, () => {
  if (go2rtcProcess)    try { go2rtcProcess.kill(); }    catch {}
  if (ffmpegHlsProcess) try { ffmpegHlsProcess.kill(); } catch {}
  if (pythonProcess)    try { pythonProcess.kill(); }    catch {}
  if (sig !== 'exit') process.exit();
}));

// ── Tuya Cloud API Client ───────────────────────────────────────────────────
// ── Tuya Cloud API Client ───────────────────────────────────────────────────
function tuyaApiCall(region, clientId, clientSecret, accessToken, method, urlPath, body = "") {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomUUID();
    const contentHash = crypto.createHash('sha256').update(body).digest('hex');
    const stringToSign = `${method}\n${contentHash}\n\n${urlPath}`;
    const signStr = clientId + (accessToken || "") + timestamp + nonce + stringToSign;
    const signature = crypto.createHmac('sha256', clientSecret).update(signStr).digest('hex').toUpperCase();

    const headers = {
      'client_id': clientId,
      'sign': signature,
      't': timestamp,
      'sign_method': 'HMAC-SHA256',
      'nonce': nonce,
      'Content-Type': 'application/json'
    };
    if (accessToken) {
      headers['access_token'] = accessToken;
    }

    const options = {
      hostname: region,
      port: 443,
      path: urlPath,
      method: method,
      headers: headers,
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: 'Malformed JSON response', raw: data });
        }
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Tuya API Request Timeout')); });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function hexToHsv(hex) {
  let h = hex.replace('#', '');
  let r = parseInt(h.substring(0,2), 16) / 255;
  let g = parseInt(h.substring(2,4), 16) / 255;
  let b = parseInt(h.substring(4,6), 16) / 255;
  
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let d = max - min;
  let hVal = 0;
  let sVal = max === 0 ? 0 : d / max;
  let vVal = max;
  
  if (max !== min) {
    switch (max) {
      case r: hVal = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hVal = (b - r) / d + 2; break;
      case b: hVal = (r - g) / d + 4; break;
    }
    hVal /= 6;
  }
  return { h: hVal * 360, s: sVal, v: vVal };
}

const SPECS_CACHE_FILE = path.resolve(process.cwd(), 'tuya_specs_cache.json');

function getCachedSpec(deviceId) {
  try {
    if (fs.existsSync(SPECS_CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(SPECS_CACHE_FILE, 'utf8'));
      return cache[deviceId];
    }
  } catch {}
  return null;
}

function saveCachedSpec(deviceId, spec) {
  try {
    let cache = {};
    if (fs.existsSync(SPECS_CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(SPECS_CACHE_FILE, 'utf8'));
    }
    cache[deviceId] = spec;
    fs.writeFileSync(SPECS_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {}
}

function resolveDeviceCodes(functions) {
  const codes = {
    switch: 'switch_led',
    brightness: 'bright_value',
    color: 'colour_data',
    workMode: 'work_mode'
  };

  if (!functions || !Array.isArray(functions)) return codes;
  const functionCodes = functions.map(f => f.code);

  // 1. Resolve switch power code
  for (const c of ['switch_led', 'switch', 'switch_1', 'switch_led_1']) {
    if (functionCodes.includes(c)) {
      codes.switch = c;
      break;
    }
  }

  // 2. Resolve brightness control code
  for (const c of ['bright_value', 'bright_value_v2', 'brightness', 'brightness_1', 'bright_value_1']) {
    if (functionCodes.includes(c)) {
      codes.brightness = c;
      break;
    }
  }

  // 3. Resolve color control code
  for (const c of ['colour_data', 'colour_data_v2', 'color_data', 'color', 'colour_data_1']) {
    if (functionCodes.includes(c)) {
      codes.color = c;
      break;
    }
  }

  // 4. Resolve work mode selection code
  if (functionCodes.includes('work_mode')) {
    codes.workMode = 'work_mode';
  } else {
    codes.workMode = null;
  }

  return codes;
}

async function sendTuyaDeviceCommand(creds, deviceId, updates) {
  try {
    const { region, clientId, clientSecret } = creds;
    
    // 1. Fetch access token
    console.log('[Tuya API] Fetching access token...');
    const tokenRes = await tuyaApiCall(region, clientId, clientSecret, null, 'GET', '/v1.0/token?grant_type=1');
    if (!tokenRes.success || !tokenRes.result || !tokenRes.result.access_token) {
      return { success: false, error: `Token fetch failed: ${tokenRes.msg || 'Unknown error'}` };
    }
    
    const accessToken = tokenRes.result.access_token;
    console.log('[Tuya API] Token acquired. Checking device specifications...');

    // 2. Load device specification (cached or fetched)
    let spec = getCachedSpec(deviceId);
    if (!spec) {
      console.log(`[Tuya API] Fetching specifications for device ${deviceId}...`);
      const specRes = await tuyaApiCall(region, clientId, clientSecret, accessToken, 'GET', `/v1.0/iot-03/devices/${deviceId}/specification`);
      if (specRes.success && specRes.result) {
        spec = specRes.result;
        saveCachedSpec(deviceId, spec);
        console.log(`[Tuya API] Specifications saved to cache.`);
      } else {
        console.warn(`[Tuya API] Specification query failed: ${specRes.msg || 'Unknown error'}. Using fallbacks.`);
      }
    } else {
      console.log(`[Tuya API] Specifications loaded from cache.`);
    }

    const functions = spec ? spec.functions : [];
    const resolvedCodes = resolveDeviceCodes(functions);
    console.log('[Tuya API] Resolved command codes for device:', resolvedCodes);

    // 3. Map standard state updates to resolved Tuya command codes
    const commands = [];
    if (updates.on !== undefined && resolvedCodes.switch) {
      commands.push({ code: resolvedCodes.switch, value: updates.on });
    }

    if (updates.brightness !== undefined && resolvedCodes.brightness) {
      const brightnessFunc = functions.find(f => f.code === resolvedCodes.brightness);
      let min = 10, max = 1000;
      if (brightnessFunc && brightnessFunc.values) {
        try {
          const vals = JSON.parse(brightnessFunc.values);
          if (vals.min !== undefined) min = vals.min;
          if (vals.max !== undefined) max = vals.max;
        } catch {}
      }

      let brightVal = Math.round(updates.brightness * 10);
      if (max === 255) {
        brightVal = Math.round((updates.brightness / 100) * 255);
      } else {
        brightVal = Math.round((updates.brightness / 100) * max);
        if (brightVal < min) brightVal = min;
      }
      commands.push({ code: resolvedCodes.brightness, value: brightVal });
    }

    if (updates.color !== undefined && resolvedCodes.color) {
      if (resolvedCodes.workMode) {
        commands.push({ code: resolvedCodes.workMode, value: 'colour' });
      }

      const hsv = hexToHsv(updates.color);
      const colorPayload = JSON.stringify({
        h: Math.round(hsv.h),
        s: Math.round(hsv.s * 1000),
        v: Math.round(hsv.v * 1000)
      });
      commands.push({ code: resolvedCodes.color, value: colorPayload });
    }

    if (commands.length === 0) {
      return { success: true, msg: 'No commands to send.' };
    }

    const bodyStr = JSON.stringify({ commands });
    console.log(`[Tuya API] Sending commands to device ${deviceId}:`, bodyStr);
    
    const cmdRes = await tuyaApiCall(region, clientId, clientSecret, accessToken, 'POST', `/v1.0/devices/${deviceId}/commands`, bodyStr);
    if (cmdRes.success) {
      console.log('[Tuya API] Commands executed successfully.');
      return { success: true, result: cmdRes.result };
    } else {
      console.error('[Tuya API] Command execution failed:', cmdRes.msg);
      return { success: false, error: cmdRes.msg };
    }
  } catch (err) {
    console.error('[Tuya API] Request failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getSavedCameraIp() {
  try { const m = fs.readFileSync(path.resolve(process.cwd(),'go2rtc.yaml'),'utf8').match(/@([\d.]+):/); return m ? m[1] : '192.168.1.3'; } catch { return '192.168.1.3'; }
}

function readBody(req) {
  return new Promise(r => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>r(b)); });
}

function json(res, data, status=200) {
  res.statusCode = status;
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(data));
}

// ── Ports to probe per LAN device ────────────────────────────────────────────
const PROBE_PORTS = [80,443,554,1400,1883,1982,4000,6668,7000,8008,8080,8123,9123,9999,34567,37777,56700];

// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  server: { port: 3000, host: true, strictPort: true },
  plugins: [{
    name: 'lukas-backend',
    configureServer(server) {
      startGo2RTC();
      startPythonBackend();

      // Auto-probe HLS on startup (background)
      const savedIp = getSavedCameraIp();
      setTimeout(async () => {
        const url = await discoverRtspUrl(savedIp, 'admin', null);
        if (url) startFfmpegHls(url);
        else console.warn('[STARTUP] No RTSP found. Configure via Settings → CCTV Config.');
      }, 3000);

      server.middlewares.use(async (req, res, next) => {
        const url = req.url.split('?')[0];

        // ── POST /api/storage/sync ── local file-backed secure synchronization ─────
        if (url === '/api/storage/sync' && req.method === 'POST') {
          try {
            const bodyStr = await readBody(req);
            const data = JSON.parse(bodyStr);
            const { type, payload } = data;
            if (!type || !payload) {
              return json(res, { success: false, error: 'Missing type or payload.' }, 400);
            }
            
            const dbDir = path.resolve(process.cwd(), 'db');
            if (!fs.existsSync(dbDir)) {
              fs.mkdirSync(dbDir, { recursive: true });
            }
            
            const filePath = path.resolve(dbDir, `${type}.json`);
            fs.writeFileSync(filePath, JSON.stringify({ payload, updatedAt: Date.now() }), 'utf8');
            return json(res, { success: true, message: `${type} synced successfully.` });
          } catch (err) {
            return json(res, { success: false, error: err.message }, 500);
          }
        }

        // ── GET /api/storage/load ── local file-backed secure database load ─────
        if (url === '/api/storage/load' && req.method === 'GET') {
          try {
            const urlParts = req.url.split('?');
            const query = urlParts[1] || '';
            const typeParam = query.split('&').find(p => p.startsWith('type='));
            const type = typeParam ? decodeURIComponent(typeParam.split('=')[1]) : null;

            if (!type) {
              return json(res, { success: false, error: 'Missing type parameter.' }, 400);
            }
            
            const dbDir = path.resolve(process.cwd(), 'db');
            const filePath = path.resolve(dbDir, `${type}.json`);
            
            if (!fs.existsSync(filePath)) {
              return json(res, { success: true, found: false, payload: null });
            }
            
            const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return json(res, { success: true, found: true, payload: fileData.payload, updatedAt: fileData.updatedAt });
          } catch (err) {
            return json(res, { success: false, error: err.message }, 500);
          }
        }

        // ── POST /api/storage/purge ── purge all file-backed secure storage ─────
        if (url === '/api/storage/purge' && req.method === 'POST') {
          try {
            const dbDir = path.resolve(process.cwd(), 'db');
            if (fs.existsSync(dbDir)) {
              const files = fs.readdirSync(dbDir);
              for (const file of files) {
                if (file.endsWith('.json')) {
                  fs.unlinkSync(path.join(dbDir, file));
                }
              }
            }
            return json(res, { success: true, message: 'Local storage purged successfully.' });
          } catch (err) {
            return json(res, { success: false, error: err.message }, 500);
          }
        }

        // ── POST /api/write-agent-log ── write structured agent logs ─────
        if (url === '/api/write-agent-log' && req.method === 'POST') {
          try {
            const bodyStr = await readBody(req);
            const { agent, entry } = JSON.parse(bodyStr);
            if (!agent || !entry) {
              return json(res, { success: false, error: 'Missing agent or entry.' }, 400);
            }

            // Sanitize agent name to prevent path traversal
            const safeName = String(agent).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'unknown';
            const logsDir  = path.resolve(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
              fs.mkdirSync(logsDir, { recursive: true });
            }

            const logFile = path.join(logsDir, `${safeName}.log`);
            fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf8');
            return json(res, { success: true, file: `${safeName}.log` });
          } catch (err) {
            return json(res, { success: false, error: err.message }, 500);
          }
        }

        // ── GET /api/scan-tuya ── scan Tuya developer platform devices ─────
        if (url === '/api/scan-tuya' && req.method === 'GET') {
          try {
            const p = path.resolve(process.cwd(), 'tuya_creds.json');
            if (!fs.existsSync(p)) {
              return json(res, { success: false, error: 'Tuya credentials not configured.' }, 400);
            }
            const creds = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (!creds.clientId || !creds.clientSecret) {
              return json(res, { success: false, error: 'Access ID and Access Secret are required.' }, 400);
            }

            console.log('[Tuya Scan] Fetching access token...');
            const tokenRes = await tuyaApiCall(creds.region, creds.clientId, creds.clientSecret, null, 'GET', '/v1.0/token?grant_type=1');
            if (!tokenRes.success || !tokenRes.result || !tokenRes.result.access_token) {
              return json(res, { success: false, error: `Token fetch failed: ${tokenRes.msg || 'Unknown error'}` }, 400);
            }

            const accessToken = tokenRes.result.access_token;
            console.log('[Tuya Scan] Querying devices in project...');
            const devicesRes = await tuyaApiCall(creds.region, creds.clientId, creds.clientSecret, accessToken, 'GET', '/v1.0/iot-03/devices?page_no=1&page_size=100');

            if (!devicesRes.success) {
              return json(res, { success: false, error: `Devices query failed: ${devicesRes.msg || 'Unknown error'}` }, 400);
            }

            const rawList = (devicesRes.result && devicesRes.result.list) || [];
            console.log(`[Tuya Scan] Discovered ${rawList.length} devices.`);

            const devices = rawList.map(d => {
              let category = 'appliance';
              let icon = 'fa-plug';
              let color = '#34d399';

              const catCode = (d.category || '').toLowerCase();
              const nameLower = (d.name || '').toLowerCase();

              if (catCode === 'dj' || catCode === 'dd' || catCode === 'fs' || catCode === 'sgd' ||
                  nameLower.includes('light') || nameLower.includes('bulb') || nameLower.includes('led') || nameLower.includes('wipro')) {
                category = 'light';
                icon = 'fa-lightbulb';
                color = 'var(--cyan-neon)';
              } else if (catCode === 'sp' || catCode === 'sxg' || catCode === 'spzg' || nameLower.includes('camera') || nameLower.includes('cam')) {
                category = 'camera';
                icon = 'fa-video';
                color = '#a78bfa';
              } else if (catCode === 'ms' || nameLower.includes('lock') || nameLower.includes('door') || nameLower.includes('gate')) {
                category = 'lock';
                icon = 'fa-lock';
                color = 'var(--rose-neon)';
              }

              return {
                id: d.id,
                name: d.name || `Tuya Device (${d.id.slice(-4)})`,
                category: category,
                protocol: 'WiFi',
                ipAddress: d.ip || '0.0.0.0',
                icon: icon,
                color: color,
                integration: 'tuya-cloud',
                tuyaDeviceId: d.id,
                tuyaLocalKey: d.local_key || '',
                source: 'tuya'
              };
            });

            return json(res, { success: true, devices, count: devices.length });
          } catch(e) {
            console.error('[Tuya Scan Error]', e);
            return json(res, { success: false, error: e.message, devices: [] }, 500);
          }

        // ── POST /api/tuya-config ── save tuya credentials ────────────────
        } else if (url === '/api/tuya-config' && req.method === 'POST') {
          const body = await readBody(req);

          try {
            const data = JSON.parse(body);
            fs.writeFileSync(path.resolve(process.cwd(), 'tuya_creds.json'), JSON.stringify(data));
            json(res, { success: true });
          } catch(e) { json(res, { error: e.message }, 500); }

        // ── GET /api/tuya-config ── read tuya credentials ─────────────────
        } else if (url === '/api/tuya-config' && req.method === 'GET') {
          try {
            const p = path.resolve(process.cwd(), 'tuya_creds.json');
            json(res, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { clientId: '', clientSecret: '', region: 'openapi.tuyain.com' });
          } catch(e) { json(res, { error: e.message }, 500); }

        // ── GET /api/openai-config ── read openai credentials ──────────────
        } else if (url === '/api/openai-config' && req.method === 'GET') {
          try {
            const p = path.resolve(process.cwd(), 'openai_creds.json');
            json(res, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { openai_api_key: '' });
          } catch(e) { json(res, { error: e.message }, 500); }

        // ── POST /api/openai-config ── save openai credentials ─────────────
        } else if (url === '/api/openai-config' && req.method === 'POST') {
          const body = await readBody(req);
          try {
            const data = JSON.parse(body);
            fs.writeFileSync(path.resolve(process.cwd(), 'openai_creds.json'), JSON.stringify(data));
            json(res, { success: true });
          } catch(e) { json(res, { error: e.message }, 500); }

        // ── POST /api/tuya-control ── send Tuya command ───────────────────
        } else if (url === '/api/tuya-control' && req.method === 'POST') {
          const body = await readBody(req);
          try {
            const { deviceId, updates } = JSON.parse(body);
            const p = path.resolve(process.cwd(), 'tuya_creds.json');
            if (!fs.existsSync(p)) {
              return json(res, { error: 'Tuya credentials not configured. Please save them in Settings.' }, 400);
            }
            const creds = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (!creds.clientId || !creds.clientSecret) {
              return json(res, { error: 'Tuya Client ID and Client Secret are required.' }, 400);
            }

            const result = await sendTuyaDeviceCommand(creds, deviceId, updates);
            json(res, result);
          } catch(e) { json(res, { success: false, error: e.message }, 500); }

        // ── POST /api/camera-config ── save + restart ─────────────────────
        } else if (url === '/api/camera-config' && req.method === 'POST') {
          const body = await readBody(req);
          try {
            const { ipAddress, username, password, rtspPath } = JSON.parse(body);
            if (!ipAddress || !username) return json(res, { error: 'IP and username required.' }, 400);

            // Handle EseeCloud Cloud mode: if username contains '@'
            if (username.includes('@')) {
              fs.writeFileSync(path.resolve(process.cwd(), 'eseecloud_creds.json'), JSON.stringify({ email: username, password }));
              
              // Write a dummy local stream to prevent go2rtc erroring out on startup
              fs.writeFileSync(path.resolve(process.cwd(),'go2rtc.yaml'),
                `streams:\n  camera1:\n    - rtsp://127.0.0.1:554/dummy\n`);
              startGo2RTC();
              return json(res, { success: true, mode: 'cloud' });
            }

            // Remove cloud credentials if changing back to local RTSP mode
            const cloudPath = path.resolve(process.cwd(), 'eseecloud_creds.json');
            if (fs.existsSync(cloudPath)) {
              try { fs.unlinkSync(cloudPath); } catch {}
            }

            const ep = encodeURIComponent(password || '');
            fs.writeFileSync(path.resolve(process.cwd(),'go2rtc.yaml'),
              `streams:\n  camera1:\n    - rtsp://${username}:${ep}@${ipAddress}:554/${rtspPath||'ch0_0.264'}\n`);
            startGo2RTC();
            json(res, { success: true, mode: 'local' });
            (async () => { const u = await discoverRtspUrl(ipAddress, username, password); if (u) startFfmpegHls(u); })();
          } catch(e) { json(res, { error: e.message }, 500); }

        // ── GET /api/camera-config ── read yaml ───────────────────────────
        } else if (url === '/api/camera-config' && req.method === 'GET') {
          try {
            const p = path.resolve(process.cwd(),'go2rtc.yaml');
            const cloudPath = path.resolve(process.cwd(), 'eseecloud_creds.json');
            
            let email = '';
            let password = '';
            if (fs.existsSync(cloudPath)) {
              try {
                const cloudCreds = JSON.parse(fs.readFileSync(cloudPath, 'utf8'));
                email = cloudCreds.email || '';
                password = cloudCreds.password || '';
              } catch {}
            }

            json(res, { 
              config: fs.existsSync(p) ? fs.readFileSync(p,'utf8') : '', 
              activeUrl: activeRtspUrl,
              cloudEmail: email,
              cloudPassword: password
            });
          } catch(e) { json(res, { error: e.message }, 500); }

        // ── GET /api/hls-status ───────────────────────────────────────────
        } else if (url === '/api/hls-status') {
          const playlist = path.join(HLS_DIR,'camera1.m3u8');
          json(res, { live: fs.existsSync(playlist) && ffmpegHlsProcess !== null, activeUrl: activeRtspUrl });

        // ── GET /api/probe-camera ── manual probe ─────────────────────────
        } else if (url === '/api/probe-camera') {
          const p = new URL(req.url,'http://localhost');
          const ip = p.searchParams.get('ip') || getSavedCameraIp();
          const u  = p.searchParams.get('user') || 'admin';
          const pw = p.searchParams.get('pass') || '';
          try {
            const workUrl = await discoverRtspUrl(ip, u, pw);
            if (workUrl) { startFfmpegHls(workUrl); json(res, { success: true, url: workUrl, hlsPath: '/hls/camera1.m3u8' }); }
            else json(res, { success: false, error: 'No RTSP stream accessible. Camera may be P2P-only.' });
          } catch(e) { json(res, { success: false, error: e.message }); }

        // ── GET /api/scan-lan ── ARP + port probe ─────────────────────────
        } else if (url === '/api/scan-lan') {
          try {
            const { stdout } = await execAsync('arp -a');
            const ipRegex = /((?:192\.168|10\.\d+|172\.\d+)\.\d+\.\d+)/g;
            const uniqueIps = [...new Set(stdout.match(ipRegex)||[])].filter(ip => !ip.endsWith('.255') && !ip.endsWith('.0'));

            const deviceList = await Promise.all(uniqueIps.map(async ip => {
              const openPorts = await probePorts(ip, PROBE_PORTS);
              return { ip, openPorts };
            }));

            // Import knowledge base (ESM → dynamic import)
            const { fingerprintDevice } = await import('./src/deviceKnowledgeBase.js');
            const devices = deviceList.map(({ ip, openPorts }) => fingerprintDevice(ip, openPorts));

            json(res, { devices, count: devices.length });
          } catch(e) { json(res, { error: e.message, devices: [] }, 500); }

        // ── GET /api/scan-onvif ── WS-Discovery UDP ───────────────────────
        } else if (url === '/api/scan-onvif') {
          try {
            const onvifDevices = await runOnvifDiscovery(5000);
            // Also try ONVIF HTTP probe on camera IP
            const camIp = getSavedCameraIp();
            const httpProbe = await probeOnvifHttp(camIp, 80);
            const httpProbe2 = httpProbe.ok ? httpProbe : await probeOnvifHttp(camIp, 8080);

            const { fingerprintDevice } = await import('./src/deviceKnowledgeBase.js');
            const devices = onvifDevices.map(d => ({
              ...fingerprintDevice(d.ipAddress, [554,80]),
              name: d.hardware || 'ONVIF Camera',
              source: 'onvif',
              xAddr: d.xAddr,
            }));

            if (httpProbe2.ok && !devices.find(d => d.ipAddress === camIp)) {
              devices.push({
                ...fingerprintDevice(camIp, [80]),
                name: 'EseeCloud IP Camera (HTTP)',
                source: 'onvif-http',
              });
            }

            json(res, { devices, count: devices.length });
          } catch(e) { json(res, { error: e.message, devices: [] }, 500); }

        // ── GET /api/scan-network ── legacy ARP (kept for compatibility) ───
        } else if (url === '/api/scan-network') {
          try {
            exec('arp -a', (err, stdout) => {
              if (err) return json(res, { error: 'ARP failed', devices: [] }, 500);
              const ipRegex = /(192\.168\.\d+\.\d+)/g;
              const uniqueIps = [...new Set(stdout.match(ipRegex)||[])].filter(ip=>!ip.endsWith('.255')&&!ip.endsWith('.0'));
              const devices = uniqueIps.map(ip => {
                const last = parseInt(ip.split('.')[3]);
                if (ip === '192.168.1.3') return { name:'EseeCloud IP Camera', category:'camera', protocol:'P2P', ipAddress:ip, icon:'fa-video', color:'#a78bfa' };
                if (ip === '192.168.1.1') return { name:'Gateway Router', category:'appliance', protocol:'WiFi', ipAddress:ip, icon:'fa-network-wired', color:'#94a3b8' };
                return { name:`Network Device ${last}`, category:'appliance', protocol:'WiFi', ipAddress:ip, icon:'fa-microchip', color:'#64748b' };
              });
              json(res, { devices });
            });
          } catch(e) { json(res, { error: e.message, devices: [] }, 500); }

        } else if ((url === '/api/search') && req.method === 'POST') {
          // ── POST /api/search ── real-time multi-source search backend ──────
          try {
            const body = await readBody(req);
            const { query } = JSON.parse(body);
            if (!query) return json(res, { error: 'Missing query' }, 400);

            const q = query.trim();
            const results = [];

            // 1. DuckDuckGo Instant Answers (server-side, no CORS)
            try {
              const ddgRes = await new Promise((resolve, reject) => {
                const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
                https.get(apiUrl, { timeout: 5000 }, (r) => {
                  let data = '';
                  r.on('data', chunk => data += chunk);
                  r.on('end', () => resolve(data));
                }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
              });
              const ddgData = JSON.parse(ddgRes);
              if (ddgData.Answer) {
                results.push({ source: 'DuckDuckGo Instant', title: ddgData.Heading || q, text: ddgData.Answer, url: '', confidence: 0.92, type: 'instant_answer' });
              }
              if (ddgData.AbstractText) {
                results.push({ source: `DuckDuckGo (${ddgData.AbstractSource || 'Web'})`, title: ddgData.Heading || q, text: ddgData.AbstractText, url: ddgData.AbstractURL || '', confidence: 0.84, type: 'abstract' });
              }
            } catch(e) { console.warn('[Search] DDG failed:', e.message); }

            // 2. Wikipedia (server-side)
            try {
              const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&limit=2&format=json`;
              const wikiSearchRaw = await new Promise((resolve, reject) => {
                https.get(wikiSearchUrl, { timeout: 5000 }, (r) => {
                  let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d));
                }).on('error', reject);
              });
              const wikiSearch = JSON.parse(wikiSearchRaw);
              if (wikiSearch.query?.search?.length > 0) {
                const title = wikiSearch.query.search[0].title;
                const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
                const summaryRaw = await new Promise((resolve, reject) => {
                  https.get(summaryUrl, { timeout: 5000 }, (r) => {
                    let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d));
                  }).on('error', reject);
                });
                const wiki = JSON.parse(summaryRaw);
                if (wiki.extract) {
                  results.push({ source: 'Wikipedia', title: wiki.title, text: wiki.extract, url: wiki.content_urls?.desktop?.page || '', confidence: 0.82, type: 'encyclopedia' });
                }
              }
            } catch(e) { console.warn('[Search] Wikipedia failed:', e.message); }

            // 3. SerpAPI — Google Search (if key configured)
            const serpApiKey = process.env.SERPER_API_KEY || '';
            if (serpApiKey) {
              try {
                const serpPath = `/search?engine=google&q=${encodeURIComponent(q)}&api_key=${serpApiKey}&gl=in&hl=en&num=5`;
                const serpRaw = await new Promise((resolve, reject) => {
                  const opts = { hostname: 'serpapi.com', path: serpPath, method: 'GET', headers: { 'Accept': 'application/json' }, timeout: 8000 };
                  https.get(opts, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d)); }).on('error', reject);
                });
                const serp = JSON.parse(serpRaw);

                // Answer box — highest confidence
                if (serp.answer_box) {
                  const text = serp.answer_box.answer || serp.answer_box.snippet || (Array.isArray(serp.answer_box.list) ? serp.answer_box.list.join(', ') : '') || '';
                  if (text) results.unshift({ source: 'Google Answer Box', title: serp.answer_box.title || q, text: text.trim(), url: serp.answer_box.link || '', confidence: 0.97, type: 'answer_box' });
                }

                // Knowledge graph
                if (serp.knowledge_graph?.description) {
                  results.push({ source: 'Google Knowledge Graph', title: serp.knowledge_graph.title || q, text: serp.knowledge_graph.description, url: serp.knowledge_graph.website || '', confidence: 0.95, type: 'knowledge_graph' });
                }

                // Organic results
                 for (const item of (serp.organic_results || []).slice(0, 3)) {
                   if (item.snippet) results.push({ source: `Google (${item.displayed_link || ''})`, title: item.title || '', text: item.snippet, url: item.link || '', confidence: 0.87, type: 'organic' });
                 }
               } catch(e) { console.warn('[Search] SerpAPI failed:', e.message); }
             }

            // 4. DuckDuckGo Scrape fallback (if SerpAPI didn't give enough results and no key is configured)
            if (results.length < 3) {
              try {
                const ddgHtmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
                const scrapeRes = await fetch(ddgHtmlUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                  }
                });
                if (scrapeRes.ok) {
                  const html = await scrapeRes.text();
                  const parts = html.split('<div class="result results_links results_links_deep web-result ">');
                  
                  function decodeHtml(str) {
                    return str
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&quot;/g, '"')
                      .replace(/&#x27;/g, "'")
                      .replace(/&#39;/g, "'")
                      .replace(/&nbsp;/g, ' ');
                  }

                  let parsedCount = 0;
                  for (let i = 1; i < parts.length && parsedCount < 4; i++) {
                    const block = parts[i].split('<!-- This is the visible part -->')[1] || parts[i];
                    
                    const hrefMatch = block.match(/class="result__a"\s+href="([^"]+)"/);
                    let href = hrefMatch ? hrefMatch[1] : '';
                    let decodedUrl = href;
                    if (href.startsWith('//')) href = 'https:' + href;
                    if (href.includes('uddg=')) {
                      try {
                        const partsUrl = href.split('uddg=');
                        if (partsUrl.length > 1) {
                          const paramVal = partsUrl[1].split('&')[0];
                          decodedUrl = decodeURIComponent(paramVal);
                        }
                      } catch (e) {}
                    }
                    
                    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
                    let title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';
                    title = decodeHtml(title);
                    
                    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) || block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
                    let snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';
                    snippet = decodeHtml(snippet);
                    
                    if (title && snippet) {
                      let domain = '';
                      try { domain = new URL(decodedUrl).hostname; } catch {}
                      
                      results.push({
                        source: `Web (${domain || 'DuckDuckGo'})`,
                        title,
                        text: snippet,
                        url: decodedUrl,
                        confidence: 0.85,
                        type: 'organic'
                      });
                      parsedCount++;
                    }
                  }
                }
              } catch(e) { console.warn('[Search] DDG html scrape failed:', e.message); }
            }

            results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
            json(res, { query: q, found: results.length > 0, results: results.slice(0, 6), timestamp: new Date().toISOString(), backend: 'lukas-search-serpapi-vite', serpapi_used: !!serpApiKey });

          } catch(e) { json(res, { error: e.message, found: false, results: [] }, 500); }

        // ── POST /api/music-search ── Invidious YouTube audio search ─────
        } else if (url === '/api/music-search' && req.method === 'POST') {
          try {
            const body = await readBody(req);
            const { query } = JSON.parse(body);
            if (!query || !query.trim()) return json(res, { found: false, error: 'Missing query' }, 400);

            const q = query.trim();
            console.log(`[Music Search] Searching: "${q}"`);

            // Public Invidious instances resolved dynamically
            const INVIDIOUS_INSTANCES = await getHealthyInvidiousInstances();

            const searchWithTimeout = (url, timeoutMs = 7000) => new Promise((resolve, reject) => {
              const controller = { aborted: false };
              const timer = setTimeout(() => {
                controller.aborted = true;
                reject(new Error('timeout'));
              }, timeoutMs);

              https.get(url, {
                timeout: timeoutMs,
                headers: {
                  'Accept': 'application/json',
                  'User-Agent': 'LUKAS-AI/1.0',
                }
              }, (r) => {
                clearTimeout(timer);
                let data = '';
                r.on('data', c => data += c);
                r.on('end', () => {
                  try { resolve(JSON.parse(data)); }
                  catch { reject(new Error('Invalid JSON')); }
                });
              })
              .on('error', (e) => { clearTimeout(timer); reject(e); })
              .on('timeout', () => { clearTimeout(timer); reject(new Error('timeout')); });
            });

            // Try each Invidious instance
            let searchResults = null;
            let workingInstance = null;

            for (const instance of INVIDIOUS_INSTANCES) {
              try {
                const searchUrl = `${instance}/api/v1/search?q=${encodeURIComponent(q + ' audio')}&type=video&fields=videoId,title,author,lengthSeconds,videoThumbnails`;
                const results = await searchWithTimeout(searchUrl, 7000);
                if (Array.isArray(results) && results.length > 0) {
                  searchResults = results;
                  workingInstance = instance;
                  console.log(`[Music Search] Got ${results.length} results from ${instance}`);
                  break;
                }
              } catch (e) {
                console.warn(`[Music Search] Instance ${instance} failed: ${e.message}`);
              }
            }

            if (!searchResults || !workingInstance) {
              return json(res, { found: false, error: 'All Invidious instances unavailable' });
            }

            // Score and pick best result
            const qWords = q.toLowerCase().split(/\s+/).filter(w => w.length > 1);
            const scored = searchResults.slice(0, 8).map(r => {
              let score = 0;
              const title = (r.title || '').toLowerCase();
              const author = (r.author || '').toLowerCase();

              const titleMatches = qWords.filter(w => title.includes(w)).length;
              score += (titleMatches / Math.max(qWords.length, 1)) * 50;

              if (author.includes('- topic') || author.includes('vevo') || author.includes('official')) score += 30;

              const dur = r.lengthSeconds || 0;
              if (dur > 60 && dur < 480) score += 20;
              else if (dur > 480) score -= 10;

              if (title.includes('mix') || title.includes('compilation') || title.includes('full album') || title.includes('playlist')) score -= 20;

              return { r, score };
            });
            scored.sort((a, b) => b.score - a.score);
            const best = scored[0]?.r || searchResults[0];

            console.log(`[Music Search] Best match: "${best.title}" by "${best.author}" (${best.videoId})`);

            // Get audio stream URL from Invidious video endpoint
            let audioUrl = null;
            try {
              const videoUrl = `${workingInstance}/api/v1/videos/${best.videoId}?fields=adaptiveFormats,formatStreams`;
              const videoData = await searchWithTimeout(videoUrl, 7000);

              // Prefer audio-only adaptive formats (highest bitrate)
              const audioFormats = (videoData.adaptiveFormats || [])
                .filter(f => f.type && f.type.startsWith('audio/') && f.url)
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

              if (audioFormats.length > 0) {
                audioUrl = audioFormats[0].url;
                console.log(`[Music Search] Audio stream found (${audioFormats[0].type}, ${Math.round((audioFormats[0].bitrate || 0) / 1000)}kbps)`);
              } else {
                // Fall back to combined format
                const combined = (videoData.formatStreams || []).find(f => f.url);
                if (combined) {
                  audioUrl = combined.url;
                  console.log(`[Music Search] Using combined stream format`);
                }
              }
            } catch (e) {
              console.warn(`[Music Search] Stream URL fetch failed: ${e.message}`);
            }

            if (!audioUrl) {
              return json(res, {
                found: false,
                error: 'Could not get audio stream URL',
                partial: {
                  videoId: best.videoId,
                  title: best.title,
                  author: best.author,
                }
              });
            }

            const thumbnail = best.videoThumbnails?.find(t => t.quality === 'medium')?.url ||
                              best.videoThumbnails?.[0]?.url || '';

            return json(res, {
              found: true,
              track: {
                videoId: best.videoId,
                title: best.title,
                author: best.author,
                audioUrl,
                thumbnail,
                duration: best.lengthSeconds || 0,
                instance: workingInstance,
              }
            });

          } catch (e) {
            console.error('[Music Search] Error:', e.message);
            return json(res, { found: false, error: e.message }, 500);
          }

        } else { next(); }

      });
    }
  }]
});
