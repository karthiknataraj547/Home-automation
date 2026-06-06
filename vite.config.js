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

// ── Clean shutdown ───────────────────────────────────────────────────────────
['exit','SIGINT','SIGTERM'].forEach(sig => process.on(sig, () => {
  if (go2rtcProcess)    try { go2rtcProcess.kill(); }    catch {}
  if (ffmpegHlsProcess) try { ffmpegHlsProcess.kill(); } catch {}
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

      // Auto-probe HLS on startup (background)
      const savedIp = getSavedCameraIp();
      setTimeout(async () => {
        const url = await discoverRtspUrl(savedIp, 'admin', null);
        if (url) startFfmpegHls(url);
        else console.warn('[STARTUP] No RTSP found. Configure via Settings → CCTV Config.');
      }, 3000);

      server.middlewares.use(async (req, res, next) => {
        const url = req.url.split('?')[0];

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

        } else { next(); }
      });
    }
  }]
});
