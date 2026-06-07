const { app, BrowserWindow } = require('electron');
const { spawn, exec } = require('child_process');
const { createServer } = require('net');
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ── Dev mode detection ────────────────────────────────────────────────────────
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

// ── Config paths mapped to user data directory for production safety ─────────
const getConfigDir = () => {
  if (isDev) {
    return process.cwd();
  } else {
    return app.getPath('userData');
  }
};

const getHlsDir = () => {
  const hlsPath = path.join(getConfigDir(), 'hls');
  if (!fs.existsSync(hlsPath)) {
    fs.mkdirSync(hlsPath, { recursive: true });
  }
  return hlsPath;
};

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

// ── Ports to probe per LAN device ────────────────────────────────────────────
const PROBE_PORTS = [80,443,554,1400,1883,1982,4000,6668,7000,8008,8080,8123,9123,9999,34567,37777,56700];

// ── Load deviceKnowledgeBase ESM dynamically ────────────────────────────────
let fingerprintDevice;
async function loadKnowledgeBase() {
  try {
    const modulePath = path.resolve(app.getAppPath(), 'src', 'deviceKnowledgeBase.js');
    const fileUrl = `file://${modulePath.replace(/\\/g, '/')}`;
    const kb = await import(fileUrl);
    fingerprintDevice = kb.fingerprintDevice;
    console.log('[Electron Core] Device Knowledge Base loaded successfully.');
  } catch (e) {
    console.error('[Electron Core] Failed to load deviceKnowledgeBase, using fallback:', e.message);
    fingerprintDevice = (ip, openPorts = []) => {
      const last = parseInt(ip.split('.')[3]);
      if (ip === '192.168.1.3') {
        return { name: 'EseeCloud IP Camera', category: 'camera', protocol: 'P2P', ipAddress: ip, icon: 'fa-video', color: '#a78bfa', brand: 'EseeCloud', source: 'known' };
      }
      if (ip === '192.168.1.1') {
        return { name: 'Primary Gateway Router', category: 'appliance', protocol: 'WiFi', icon: 'fa-network-wired', color: '#94a3b8', brand: 'Router', source: 'known' };
      }
      return {
        name: `Network Device ${last}`,
        brand: 'Unknown',
        category: 'appliance',
        protocol: 'WiFi',
        icon: 'fa-microchip',
        color: '#64748b',
        ipAddress: ip,
        openPorts,
        source: 'arp'
      };
    };
  }
}

// ── Port probe (TCP connect with timeout) ────────────────────────────────────
function probePort(ip, port, ms = 400) {
  return new Promise(resolve => {
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
  const net = require('net');
  const results = await Promise.all(ports.map(port => new Promise(resolve => {
    const s = new net.Socket();
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
  const bin = path.resolve(app.getAppPath(), 'go2rtc.exe');
  if (!fs.existsSync(bin)) { console.warn('[go2rtc] go2rtc.exe not found at path:', bin); return; }
  
  // Make sure go2rtc.yaml exists in getConfigDir()
  const yamlPath = path.resolve(getConfigDir(), 'go2rtc.yaml');
  if (!fs.existsSync(yamlPath)) {
    const srcYaml = path.resolve(app.getAppPath(), 'go2rtc.yaml');
    if (fs.existsSync(srcYaml)) {
      fs.copyFileSync(srcYaml, yamlPath);
    } else {
      fs.writeFileSync(yamlPath, 'streams:\n');
    }
  }

  console.log('[go2rtc] Starting in directory:', getConfigDir());
  go2rtcProcess = spawn(bin, [], { stdio: 'inherit', cwd: getConfigDir() });
  go2rtcProcess.on('close', c => { console.log(`[go2rtc] Exited ${c}`); go2rtcProcess = null; });
  go2rtcProcess.on('error', e => console.error('[go2rtc] error:', e));
}

// ── FFmpeg HLS ───────────────────────────────────────────────────────────────
async function probeRtsp(url) {
  try { await execAsync(`ffprobe -v quiet -rtsp_transport tcp -i "${url}" -show_streams -of json`, { timeout: 4000 }); return true; }
  catch { return false; }
}

async function discoverRtspUrl(ip, user = 'admin', pass = null) {
  const yamlPath = path.resolve(getConfigDir(), 'go2rtc.yaml');
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
  try { 
    fs.readdirSync(getHlsDir()).filter(f => f.startsWith('camera1')).forEach(f => fs.unlinkSync(path.join(getHlsDir(), f))); 
  } catch {}
}

function startFfmpegHls(rtspUrl) {
  stopFfmpegHls();
  const hlsDir = getHlsDir();
  console.log(`[FFmpeg] Starting HLS for ${rtspUrl} into ${hlsDir}`);
  ffmpegHlsProcess = spawn('ffmpeg', [
    '-rtsp_transport','tcp', '-i', rtspUrl,
    '-c:v','copy', '-c:a','aac', '-ar','44100', '-ac','1', '-b:a','64k',
    '-hls_time','1', '-hls_list_size','6', '-hls_flags','delete_segments+append_list',
    '-start_number','0',
    '-hls_segment_filename', path.join(hlsDir, 'camera1_%03d.ts'),
    path.join(hlsDir, 'camera1.m3u8'),
  ], { stdio: 'pipe' });
  ffmpegHlsProcess.stderr.on('data', d => { const m = d.toString(); if (m.includes('Error') || m.includes('frame=')) console.log('[FFmpeg]', m.slice(0,100)); });
  ffmpegHlsProcess.on('close',  c => { console.log(`[FFmpeg] Exited ${c}`); ffmpegHlsProcess = null; });
  ffmpegHlsProcess.on('error', e => { console.error('[FFmpeg] error:', e); ffmpegHlsProcess = null; });
  activeRtspUrl = rtspUrl;
}

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

const SPECS_CACHE_FILE = () => path.resolve(getConfigDir(), 'tuya_specs_cache.json');

function getCachedSpec(deviceId) {
  try {
    const file = SPECS_CACHE_FILE();
    if (fs.existsSync(file)) {
      const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
      return cache[deviceId];
    }
  } catch {}
  return null;
}

function saveCachedSpec(deviceId, spec) {
  try {
    const file = SPECS_CACHE_FILE();
    let cache = {};
    if (fs.existsSync(file)) {
      cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    cache[deviceId] = spec;
    fs.writeFileSync(file, JSON.stringify(cache, null, 2));
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

  for (const c of ['switch_led', 'switch', 'switch_1', 'switch_led_1']) {
    if (functionCodes.includes(c)) {
      codes.switch = c;
      break;
    }
  }

  for (const c of ['bright_value', 'bright_value_v2', 'brightness', 'brightness_1', 'bright_value_1']) {
    if (functionCodes.includes(c)) {
      codes.brightness = c;
      break;
    }
  }

  for (const c of ['colour_data', 'colour_data_v2', 'color_data', 'color', 'colour_data_1']) {
    if (functionCodes.includes(c)) {
      codes.color = c;
      break;
    }
  }

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
    const tokenRes = await tuyaApiCall(region, clientId, clientSecret, null, 'GET', '/v1.0/token?grant_type=1');
    if (!tokenRes.success || !tokenRes.result || !tokenRes.result.access_token) {
      return { success: false, error: `Token fetch failed: ${tokenRes.msg || 'Unknown error'}` };
    }
    
    const accessToken = tokenRes.result.access_token;
    let spec = getCachedSpec(deviceId);
    if (!spec) {
      const specRes = await tuyaApiCall(region, clientId, clientSecret, accessToken, 'GET', `/v1.0/iot-03/devices/${deviceId}/specification`);
      if (specRes.success && specRes.result) {
        spec = specRes.result;
        saveCachedSpec(deviceId, spec);
      }
    }

    const functions = spec ? spec.functions : [];
    const resolvedCodes = resolveDeviceCodes(functions);

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
    const cmdRes = await tuyaApiCall(region, clientId, clientSecret, accessToken, 'POST', `/v1.0/devices/${deviceId}/commands`, bodyStr);
    if (cmdRes.success) {
      return { success: true, result: cmdRes.result };
    } else {
      return { success: false, error: cmdRes.msg };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getSavedCameraIp() {
  try { 
    const yamlFile = path.resolve(getConfigDir(), 'go2rtc.yaml');
    if (fs.existsSync(yamlFile)) {
      const m = fs.readFileSync(yamlFile, 'utf8').match(/@([\d.]+):/); 
      return m ? m[1] : '192.168.1.3'; 
    }
    return '192.168.1.3';
  } catch { return '192.168.1.3'; }
}

function readBody(req) {
  return new Promise(r => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>r(b)); });
}

function json(res, data, status=200) {
  res.statusCode = status;
  res.setHeader('Content-Type','application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.end(JSON.stringify(data));
}

// ── HTTP API & Static File Server ──────────────────────────────────────────
const serveStatic = (req, res) => {
  let filePath = path.join(app.getAppPath(), 'dist', req.url.split('?')[0]);
  if (req.url === '/' || req.url === '') {
    filePath = path.join(app.getAppPath(), 'dist', 'index.html');
  }
  
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(app.getAppPath(), 'dist', 'index.html');
    }
    
    let ext = path.extname(filePath).toLowerCase();
    let contentType = 'text/html';
    if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.json') contentType = 'application/json';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.svg') contentType = 'image/svg+xml';
    else if (ext === '.ico') contentType = 'image/x-icon';
    else if (ext === '.m3u8') contentType = 'application/x-mpegURL';
    else if (ext === '.ts') contentType = 'video/MP2T';
    
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.writeHead(404);
      res.end('Not Found');
    });
    stream.pipe(res);
  });
};

const handleRequest = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = parsedUrl.pathname;

  // Serve HLS streams from getConfigDir()/hls
  if (urlPath.startsWith('/hls/')) {
    const filename = urlPath.slice(5);
    const filePath = path.join(getHlsDir(), filename);
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      let contentType = 'application/x-mpegURL';
      if (filePath.endsWith('.ts')) contentType = 'video/MP2T';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  if (urlPath.startsWith('/api/')) {
    if (urlPath === '/api/scan-tuya' && req.method === 'GET') {
      try {
        const p = path.resolve(getConfigDir(), 'tuya_creds.json');
        if (!fs.existsSync(p)) return json(res, { success: false, error: 'Tuya credentials not configured.' }, 400);
        const creds = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!creds.clientId || !creds.clientSecret) return json(res, { success: false, error: 'Access ID and Access Secret are required.' }, 400);

        const tokenRes = await tuyaApiCall(creds.region, creds.clientId, creds.clientSecret, null, 'GET', '/v1.0/token?grant_type=1');
        if (!tokenRes.success || !tokenRes.result || !tokenRes.result.access_token) {
          return json(res, { success: false, error: `Token fetch failed: ${tokenRes.msg || 'Unknown error'}` }, 400);
        }

        const accessToken = tokenRes.result.access_token;
        const devicesRes = await tuyaApiCall(creds.region, creds.clientId, creds.clientSecret, accessToken, 'GET', '/v1.0/iot-03/devices?page_no=1&page_size=100');
        if (!devicesRes.success) return json(res, { success: false, error: `Devices query failed: ${devicesRes.msg || 'Unknown error'}` }, 400);

        const rawList = (devicesRes.result && devicesRes.result.list) || [];
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
            category,
            protocol: 'WiFi',
            ipAddress: d.ip || '0.0.0.0',
            icon,
            color,
            integration: 'tuya-cloud',
            tuyaDeviceId: d.id,
            tuyaLocalKey: d.local_key || '',
            source: 'tuya'
          };
        });

        return json(res, { success: true, devices, count: devices.length });
      } catch (e) {
        return json(res, { success: false, error: e.message, devices: [] }, 500);
      }
    }

    else if (urlPath === '/api/tuya-config' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const data = JSON.parse(body);
        fs.writeFileSync(path.resolve(getConfigDir(), 'tuya_creds.json'), JSON.stringify(data));
        json(res, { success: true });
      } catch(e) { json(res, { error: e.message }, 500); }
    }

    else if (urlPath === '/api/tuya-config' && req.method === 'GET') {
      try {
        const p = path.resolve(getConfigDir(), 'tuya_creds.json');
        json(res, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { clientId: '', clientSecret: '', region: 'openapi.tuyain.com' });
      } catch(e) { json(res, { error: e.message }, 500); }
    }

    else if (urlPath === '/api/openai-config' && req.method === 'GET') {
      try {
        const p = path.resolve(getConfigDir(), 'openai_creds.json');
        json(res, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { openai_api_key: '' });
      } catch(e) { json(res, { error: e.message }, 500); }
    }

    else if (urlPath === '/api/openai-config' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const data = JSON.parse(body);
        fs.writeFileSync(path.resolve(getConfigDir(), 'openai_creds.json'), JSON.stringify(data));
        json(res, { success: true });
      } catch(e) { json(res, { error: e.message }, 500); }
    }

    else if (urlPath === '/api/tuya-control' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { deviceId, updates } = JSON.parse(body);
        const p = path.resolve(getConfigDir(), 'tuya_creds.json');
        if (!fs.existsSync(p)) return json(res, { error: 'Tuya credentials not configured.' }, 400);
        const creds = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!creds.clientId || !creds.clientSecret) return json(res, { error: 'Tuya Access Key/Secret required.' }, 400);

        const result = await sendTuyaDeviceCommand(creds, deviceId, updates);
        json(res, result);
      } catch(e) { json(res, { success: false, error: e.message }, 500); }
    }

    else if (urlPath === '/api/camera-config' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { ipAddress, username, password, rtspPath } = JSON.parse(body);
        if (!ipAddress || !username) return json(res, { error: 'IP and username required.' }, 400);

        if (username.includes('@')) {
          fs.writeFileSync(path.resolve(getConfigDir(), 'eseecloud_creds.json'), JSON.stringify({ email: username, password }));
          fs.writeFileSync(path.resolve(getConfigDir(),'go2rtc.yaml'),
            `streams:\n  camera1:\n    - rtsp://127.0.0.1:554/dummy\n`);
          startGo2RTC();
          return json(res, { success: true, mode: 'cloud' });
        }

        const cloudPath = path.resolve(getConfigDir(), 'eseecloud_creds.json');
        if (fs.existsSync(cloudPath)) {
          try { fs.unlinkSync(cloudPath); } catch {}
        }

        const ep = encodeURIComponent(password || '');
        fs.writeFileSync(path.resolve(getConfigDir(),'go2rtc.yaml'),
          `streams:\n  camera1:\n    - rtsp://${username}:${ep}@${ipAddress}:554/${rtspPath||'ch0_0.264'}\n`);
        startGo2RTC();
        json(res, { success: true, mode: 'local' });
        (async () => { const u = await discoverRtspUrl(ipAddress, username, password); if (u) startFfmpegHls(u); })();
      } catch(e) { json(res, { error: e.message }, 500); }
    }

    else if (urlPath === '/api/camera-config' && req.method === 'GET') {
      try {
        const p = path.resolve(getConfigDir(),'go2rtc.yaml');
        const cloudPath = path.resolve(getConfigDir(), 'eseecloud_creds.json');
        
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
    }

    else if (urlPath === '/api/hls-status') {
      const playlist = path.join(getHlsDir(),'camera1.m3u8');
      json(res, { live: fs.existsSync(playlist) && ffmpegHlsProcess !== null, activeUrl: activeRtspUrl });
    }

    else if (urlPath === '/api/probe-camera') {
      const ip = parsedUrl.searchParams.get('ip') || getSavedCameraIp();
      const u  = parsedUrl.searchParams.get('user') || 'admin';
      const pw = parsedUrl.searchParams.get('pass') || '';
      try {
        const workUrl = await discoverRtspUrl(ip, u, pw);
        if (workUrl) { startFfmpegHls(workUrl); json(res, { success: true, url: workUrl, hlsPath: '/hls/camera1.m3u8' }); }
        else json(res, { success: false, error: 'No RTSP stream accessible. Camera may be P2P-only.' });
      } catch(e) { json(res, { success: false, error: e.message }); }
    }

    else if (urlPath === '/api/scan-lan') {
      try {
        const { stdout } = await execAsync('arp -a');
        const ipRegex = /((?:192\.168|10\.\d+|172\.\d+)\.\d+\.\d+)/g;
        const uniqueIps = [...new Set(stdout.match(ipRegex)||[])].filter(ip => !ip.endsWith('.255') && !ip.endsWith('.0'));

        const deviceList = await Promise.all(uniqueIps.map(async ip => {
          const openPorts = await probePorts(ip, PROBE_PORTS);
          return { ip, openPorts };
        }));

        const devices = deviceList.map(({ ip, openPorts }) => fingerprintDevice(ip, openPorts));
        json(res, { devices, count: devices.length });
      } catch(e) { json(res, { error: e.message, devices: [] }, 500); }
    }

    else if (urlPath === '/api/scan-onvif') {
      try {
        const onvifDevices = await runOnvifDiscovery(5000);
        const camIp = getSavedCameraIp();
        const httpProbe = await probeOnvifHttp(camIp, 80);
        const httpProbe2 = httpProbe.ok ? httpProbe : await probeOnvifHttp(camIp, 8080);

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
    }

    else if (urlPath === '/api/scan-network') {
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
    }

    else if (urlPath === '/api/search' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { query } = JSON.parse(body);
        if (!query) return json(res, { error: 'Missing query' }, 400);

        const q = query.trim();
        const results = [];

        // 1. DuckDuckGo Instant Answer
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

        // 2. Wikipedia
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

        // 3. SerpAPI (if key configured)
        const serpApiKey = process.env.SERPER_API_KEY || '';
        if (serpApiKey) {
          try {
            const serpPath = `/search?engine=google&q=${encodeURIComponent(q)}&api_key=${serpApiKey}&gl=in&hl=en&num=5`;
            const serpRaw = await new Promise((resolve, reject) => {
              const opts = { hostname: 'serpapi.com', path: serpPath, method: 'GET', headers: { 'Accept': 'application/json' }, timeout: 8000 };
              https.get(opts, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d)); }).on('error', reject);
            });
            const serp = JSON.parse(serpRaw);

            if (serp.answer_box) {
              const text = serp.answer_box.answer || serp.answer_box.snippet || (Array.isArray(serp.answer_box.list) ? serp.answer_box.list.join(', ') : '') || '';
              if (text) results.unshift({ source: 'Google Answer Box', title: serp.answer_box.title || q, text: text.trim(), url: serp.answer_box.link || '', confidence: 0.97, type: 'answer_box' });
            }

            if (serp.knowledge_graph?.description) {
              results.push({ source: 'Google Knowledge Graph', title: serp.knowledge_graph.title || q, text: serp.knowledge_graph.description, url: serp.knowledge_graph.website || '', confidence: 0.95, type: 'knowledge_graph' });
            }

            for (const item of (serp.organic_results || []).slice(0, 3)) {
              if (item.snippet) results.push({ source: `Google (${item.displayed_link || ''})`, title: item.title || '', text: item.snippet, url: item.link || '', confidence: 0.87, type: 'organic' });
            }
          } catch(e) { console.warn('[Search] SerpAPI failed:', e.message); }
        }

        // 4. DuckDuckGo Scrape Fallback
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
        json(res, { query: q, found: results.length > 0, results: results.slice(0, 6), timestamp: new Date().toISOString(), backend: 'lukas-search-serpapi-electron', serpapi_used: !!serpApiKey });

      } catch(e) { json(res, { error: e.message, found: false, results: [] }, 500); }
    }

    else if (urlPath === '/api/fetch-url' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { url } = JSON.parse(body);
        if (!url) return json(res, { error: 'Missing url' }, 400);

        const client = url.startsWith('https') ? https : http;
        client.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          timeout: 6000
        }, (r) => {
          let html = '';
          r.on('data', chunk => html += chunk);
          r.on('end', () => {
            let text = html
              .replace(/<head>[\s\S]*?<\/head>/gi, '')
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            json(res, { success: true, text: text.slice(0, 15000) });
          });
        }).on('error', (err) => {
          json(res, { success: false, error: err.message }, 500);
        });
      } catch(e) { json(res, { success: false, error: e.message }, 500); }
    }
    
    else {
      res.statusCode = 404;
      res.end('API Not Found');
    }
    return;
  }

  serveStatic(req, res);
};

const startProductionServer = () => {
  return new Promise((resolve) => {
    let port = 3000;
    const server = http.createServer(handleRequest);

    const onError = (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} in use, trying ${port + 1}...`);
        port++;
        server.listen(port);
      } else {
        console.error('[Production Server] error:', err);
        resolve(null);
      }
    };

    server.on('error', onError);
    server.on('listening', () => {
      console.log(`[Production Server] running at http://localhost:${port}`);
      resolve(port);
    });

    server.listen(port);
  });
};

// ── Electron Window Lifecycle ────────────────────────────────────────────────
function createWindow(port) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "LUKAS Assistant",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // bypass CORS for external IoT resources and locally generated files
    }
  });

  // Automatically approve media access prompts (ensures mic works for speech recognition)
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    win.loadURL(`http://localhost:${port}`);
  }
}

app.whenReady().then(async () => {
  await loadKnowledgeBase();

  let port = 3000;
  if (!isDev) {
    port = await startProductionServer() || 3000;
    
    // In production mode, Electron process hosts go2rtc and HLS streams
    startGo2RTC();
    const savedIp = getSavedCameraIp();
    setTimeout(async () => {
      const url = await discoverRtspUrl(savedIp, 'admin', null);
      if (url) startFfmpegHls(url);
    }, 3000);
  }

  createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  stopFfmpegHls();
  if (go2rtcProcess) {
    try { go2rtcProcess.kill(); } catch (e) {}
  }
});
