import os
import re
import sys
import json
import time
import uuid
import socket
import hmac
import hashlib
import subprocess
import urllib.parse
from pathlib import Path
from typing import Optional, List, Dict, Any
import requests
import yaml
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="LUKAS AI OS Python Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global process variables for CCTV
go2rtc_process = None
ffmpeg_hls_process = None
active_rtsp_url = None

# CCTV constants
RTSP_PATHS = [
    'ch0_0.264', 'ch0_1.264', 'stream0', 'stream1', 'onvif1', 'onvif2',
    'live/ch0', 'live/ch01', 'cam/realmonitor?channel=1&subtype=0',
    'h264Preview_01_main', 'h264Preview_01_sub', 'mpeg4cif',
]
RTSP_PASSWORDS = ['', 'admin', '12345', '123456', '11111111']
PROBE_PORTS = [80, 443, 554, 1400, 1883, 1982, 4000, 6668, 7000, 8008, 8080, 8123, 9123, 9999, 34567, 37777, 56700]
HLS_DIR = Path("public/hls")

# Invidious Instance Cache
cached_invidious_instances = []
last_invidious_fetch_time = 0

# ── Tuya Cloud API Client ──
def tuya_api_call(region: str, client_id: str, client_secret: str, access_token: Optional[str], method: str, url_path: str, body: str = "") -> dict:
    timestamp = str(int(time.time() * 1000))
    nonce = str(uuid.uuid4())
    
    content_hash = hashlib.sha256(body.encode('utf-8')).hexdigest()
    string_to_sign = f"{method}\n{content_hash}\n\n{url_path}"
    sign_str = client_id + (access_token or "") + timestamp + nonce + string_to_sign
    
    signature = hmac.new(
        client_secret.encode('utf-8'),
        sign_str.encode('utf-8'),
        hashlib.sha256
    ).hexdigest().upper()
    
    headers = {
        'client_id': client_id,
        'sign': signature,
        't': timestamp,
        'sign_method': 'HMAC-SHA256',
        'nonce': nonce,
        'Content-Type': 'application/json'
    }
    if access_token:
        headers['access_token'] = access_token
        
    url = f"https://{region}{url_path}"
    try:
        if method == 'GET':
            resp = requests.get(url, headers=headers, timeout=5)
        else:
            resp = requests.post(url, headers=headers, data=body, timeout=5)
        
        if resp.status_code == 200:
            return resp.json()
        else:
            return {"success": False, "msg": f"HTTP status {resp.status_code}", "raw": resp.text}
    except Exception as e:
        return {"success": False, "msg": str(e)}

# ── CCTV Process Managers ──
def start_go2rtc():
    global go2rtc_process
    if go2rtc_process:
        try:
            go2rtc_process.terminate()
            go2rtc_process.wait(timeout=2)
        except Exception:
            pass
        go2rtc_process = None
        
    bin_path = Path("go2rtc.exe")
    if not bin_path.exists():
        print("[go2rtc] go2rtc.exe not found.")
        return
        
    print("[go2rtc] Starting Python-managed subprocess...")
    try:
        go2rtc_process = subprocess.Popen([str(bin_path)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=os.getcwd())
    except Exception as e:
        print(f"[go2rtc] Start failed: {e}")

def stop_ffmpeg_hls():
    global ffmpeg_hls_process, active_rtsp_url
    if ffmpeg_hls_process:
        try:
            ffmpeg_hls_process.terminate()
            ffmpeg_hls_process.wait(timeout=2)
        except Exception:
            pass
        ffmpeg_hls_process = None
    active_rtsp_url = None
    try:
        if HLS_DIR.exists():
            for f in HLS_DIR.glob("camera1*"):
                f.unlink()
    except Exception:
        pass

def start_ffmpeg_hls(rtsp_url: str):
    global ffmpeg_hls_process, active_rtsp_url
    stop_ffmpeg_hls()
    HLS_DIR.mkdir(parents=True, exist_ok=True)
    
    print(f"[FFmpeg] Starting HLS for {rtsp_url}")
    try:
        ffmpeg_hls_process = subprocess.Popen([
            'ffmpeg', '-rtsp_transport', 'tcp', '-i', rtsp_url,
            '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '1', '-b:a', '64k',
            '-hls_time', '1', '-hls_list_size', '6', '-hls_flags', 'delete_segments+append_list',
            '-start_number', '0',
            '-hls_segment_filename', str(HLS_DIR / 'camera1_%03d.ts'),
            str(HLS_DIR / 'camera1.m3u8')
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        active_rtsp_url = rtsp_url
    except Exception as e:
        print(f"[FFmpeg] Start failed: {e}")

def get_saved_camera_ip() -> str:
    try:
        yaml_path = Path("go2rtc.yaml")
        if yaml_path.exists():
            content = yaml_path.read_text(encoding="utf-8")
            m = re.search(r'@([\d.]+):', content)
            if m:
                return m.group(1)
    except Exception:
        pass
    return '192.168.1.3'

def probe_rtsp(url: str) -> bool:
    try:
        res = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-rtsp_transport', 'tcp', '-i', url, '-show_streams', '-of', 'json'],
            capture_output=True, timeout=4
        )
        return res.returncode == 0
    except Exception:
        return False

def discover_rtsp_url(ip: str, user: str = 'admin', password: Optional[str] = None) -> Optional[str]:
    yaml_path = Path("go2rtc.yaml")
    if yaml_path.exists():
        content = yaml_path.read_text(encoding="utf-8")
        match = re.search(r'rtsp:\/\/\S+', content)
        if match:
            url = match.group(0).strip()
            if probe_rtsp(url):
                return url
                
    passes = [password] + RTSP_PASSWORDS if password else RTSP_PASSWORDS
    for rtsp_path in RTSP_PATHS:
        for p in passes:
            if p:
                url = f"rtsp://{user}:{urllib.parse.quote(p)}@{ip}:554/{rtsp_path}"
            else:
                url = f"rtsp://{user}@{ip}:554/{rtsp_path}"
            if probe_rtsp(url):
                return url
    return None

# ── LAN Scan / Port Probers ──
def probe_ports(ip: str, ports: List[int]) -> List[int]:
    open_ports = []
    for port in ports:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.3)
            result = sock.connect_ex((ip, port))
            if result == 0:
                open_ports.append(port)
            sock.close()
        except Exception:
            pass
    return open_ports

def fingerprint_device(ip: str, open_ports: List[int]) -> dict:
    # Mirror JS deviceKnowledgeBase.js mapping logic
    known_ips = {
        '192.168.1.1': {'name': 'Primary Gateway Router', 'category': 'appliance', 'protocol': 'WiFi', 'icon': 'fa-network-wired', 'color': '#94a3b8', 'brand': 'Router'},
        '192.168.1.2': {'name': 'Secondary Gateway', 'category': 'appliance', 'protocol': 'WiFi', 'icon': 'fa-network-wired', 'color': '#94a3b8', 'brand': 'Router'},
        '192.168.1.3': {'name': 'EseeCloud IP Camera', 'category': 'camera', 'protocol': 'P2P', 'icon': 'fa-video', 'color': '#a78bfa', 'brand': 'EseeCloud'},
        '192.168.0.1': {'name': 'Primary Gateway Router', 'category': 'appliance', 'protocol': 'WiFi', 'icon': 'fa-network-wired', 'color': '#94a3b8', 'brand': 'Router'},
    }
    
    if ip in known_ips:
        res = known_ips[ip].copy()
        res.update({"ipAddress": ip, "openPorts": open_ports, "source": "known"})
        return res

    port_fingerprints = [
        {"ports": [554, 80], "category": "camera", "brand": "ONVIF IP Camera", "protocol": "ONVIF", "icon": "fa-video", "color": "#a78bfa"},
        {"ports": [554], "category": "camera", "brand": "RTSP IP Camera", "protocol": "RTSP", "icon": "fa-video", "color": "#a78bfa"},
        {"ports": [8000], "category": "camera", "brand": "Hikvision Camera", "protocol": "ONVIF", "icon": "fa-video", "color": "#a78bfa"},
        {"ports": [37777], "category": "camera", "brand": "Dahua Camera", "protocol": "ONVIF", "icon": "fa-video", "color": "#a78bfa"},
        {"ports": [6668], "category": "appliance", "brand": "Tuya / SmartLife", "protocol": "WiFi", "icon": "fa-plug", "color": "#34d399"},
        {"ports": [8123], "category": "appliance", "brand": "Home Assistant Hub", "protocol": "WiFi", "icon": "fa-house-signal", "color": "#00f0ff"},
    ]
    
    best_fp = None
    best_score = 0
    for fp in port_fingerprints:
        hits = len([p for p in fp["ports"] if p in open_ports])
        if hits == 0:
            continue
        score = hits / len(fp["ports"])
        if score > best_score:
            best_score = score
            best_fp = fp
            
    last_octet = ip.split('.')[-1]
    if best_fp:
        return {
            "name": best_fp["brand"],
            "brand": best_fp["brand"],
            "category": best_fp["category"],
            "protocol": best_fp["protocol"],
            "icon": best_fp["icon"],
            "color": best_fp["color"],
            "ipAddress": ip,
            "openPorts": open_ports,
            "source": "portScan"
        }
        
    return {
        "name": f"Network Device {last_octet}",
        "brand": "Unknown",
        "category": "appliance",
        "protocol": "WiFi",
        "icon": "fa-microchip",
        "color": "#64748b",
        "ipAddress": ip,
        "openPorts": open_ports,
        "source": "arp"
    }

# ── API Endpoint Declarations ──

@app.post("/api/storage/sync")
async def storage_sync(request: Request):
    try:
        data = await request.json()
        type_ = data.get("type")
        payload = data.get("payload")
        if not type_ or payload is None:
            return JSONResponse(status_code=400, content={"success": False, "error": "Missing type or payload"})
            
        db_dir = Path("db")
        db_dir.mkdir(exist_ok=True)
        
        file_path = db_dir / f"{type_}.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump({"payload": payload, "updatedAt": int(time.time() * 1000)}, f)
        return {"success": True, "message": f"{type_} synced successfully."}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.get("/api/storage/load")
async def storage_load(type: str = Query(...)):
    try:
        file_path = Path("db") / f"{type}.json"
        if not file_path.exists():
            return {"success": True, "found": False, "payload": None}
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"success": True, "found": True, "payload": data.get("payload"), "updatedAt": data.get("updatedAt")}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.post("/api/storage/purge")
async def storage_purge():
    try:
        db_dir = Path("db")
        if db_dir.exists():
            for f in db_dir.glob("*.json"):
                f.unlink()
        return {"success": True, "message": "Local storage purged successfully."}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.post("/api/write-agent-log")
async def write_agent_log(request: Request):
    try:
        data = await request.json()
        agent = data.get("agent")
        entry = data.get("entry")
        if not agent or not entry:
            return JSONResponse(status_code=400, content={"success": False, "error": "Missing agent or entry"})
            
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', str(agent))[:64] or 'unknown'
        logs_dir = Path("logs")
        logs_dir.mkdir(exist_ok=True)
        
        log_file = logs_dir / f"{safe_name}.log"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        return {"success": True, "file": f"{safe_name}.log"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.get("/api/scan-tuya")
async def scan_tuya():
    try:
        p = Path("tuya_creds.json")
        if not p.exists():
            return JSONResponse(status_code=400, content={"success": False, "error": "Tuya credentials not configured."})
            
        with open(p, "r", encoding="utf-8") as f:
            creds = json.load(f)
            
        client_id = creds.get("clientId")
        client_secret = creds.get("clientSecret")
        region = creds.get("region")
        if not client_id or not client_secret:
            return JSONResponse(status_code=400, content={"success": False, "error": "Access ID and Access Secret are required."})
            
        print("[Tuya Scan] Fetching access token...")
        token_res = tuya_api_call(region, client_id, client_secret, None, 'GET', '/v1.0/token?grant_type=1')
        if not token_res.get("success") or not token_res.get("result") or not token_res["result"].get("access_token"):
            return JSONResponse(status_code=400, content={"success": False, "error": f"Token fetch failed: {token_res.get('msg', 'Unknown error')}"})
            
        access_token = token_res["result"]["access_token"]
        print("[Tuya Scan] Querying devices in project...")
        devices_res = tuya_api_call(region, client_id, client_secret, access_token, 'GET', '/v1.0/iot-03/devices?page_no=1&page_size=100')
        
        if not devices_res.get("success"):
            return JSONResponse(status_code=400, content={"success": False, "error": f"Devices query failed: {devices_res.get('msg', 'Unknown error')}"})
            
        raw_list = devices_res.get("result", {}).get("list", [])
        print(f"[Tuya Scan] Discovered {len(raw_list)} devices.")
        
        devices = []
        for d in raw_list:
            cat_code = (d.get("category") or '').lower()
            name_lower = (d.get("name") or '').lower()
            
            category = 'appliance'
            icon = 'fa-plug'
            color = '#34d399'
            
            if cat_code in ['dj', 'dd', 'fs', 'sgd'] or any(k in name_lower for k in ['light', 'bulb', 'led', 'wipro']):
                category = 'light'
                icon = 'fa-lightbulb'
                color = 'var(--cyan-neon)'
            elif cat_code in ['sp', 'sxg', 'spzg'] or 'camera' in name_lower or 'cam' in name_lower:
                category = 'camera'
                icon = 'fa-video'
                color = '#a78bfa'
            elif cat_code == 'ms' or any(k in name_lower for k in ['lock', 'door', 'gate']):
                category = 'lock'
                icon = 'fa-lock'
                color = 'var(--rose-neon)'
                
            devices.append({
                "id": d.get("id"),
                "name": d.get("name") or f"Tuya Device ({d.get('id')[-4:]})",
                "category": category,
                "protocol": "WiFi",
                "ipAddress": d.get("ip") or '0.0.0.0',
                "icon": icon,
                "color": color,
                "integration": "tuya-cloud",
                "tuyaDeviceId": d.get("id"),
                "tuyaLocalKey": d.get("local_key") or '',
                "source": "tuya"
            })
            
        return {"success": True, "devices": devices}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.get("/api/tuya-config")
async def get_tuya_config():
    p = Path("tuya_creds.json")
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

@app.post("/api/tuya-config")
async def post_tuya_config(request: Request):
    try:
        data = await request.json()
        with open("tuya_creds.json", "w", encoding="utf-8") as f:
            json.dump(data, f)
        return {"success": True}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.get("/api/openai-config")
async def get_openai_config():
    p = Path("openai_creds.json")
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

@app.post("/api/openai-config")
async def post_openai_config(request: Request):
    try:
        data = await request.json()
        with open("openai_creds.json", "w", encoding="utf-8") as f:
            json.dump(data, f)
        return {"success": True}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.post("/api/tuya-control")
async def tuya_control(request: Request):
    try:
        data = await request.json()
        device_id = data.get("deviceId")
        updates = data.get("updates")
        
        p = Path("tuya_creds.json")
        if not p.exists():
            return JSONResponse(status_code=400, content={"success": False, "error": "Tuya credentials not configured."})
            
        with open(p, "r", encoding="utf-8") as f:
            creds = json.load(f)
            
        client_id = creds.get("clientId")
        client_secret = creds.get("clientSecret")
        region = creds.get("region")
        
        print("[Tuya API] Fetching access token...")
        token_res = tuya_api_call(region, client_id, client_secret, None, 'GET', '/v1.0/token?grant_type=1')
        if not token_res.get("success") or not token_res.get("result") or not token_res["result"].get("access_token"):
            return JSONResponse(status_code=400, content={"success": False, "error": "Token fetch failed."})
            
        access_token = token_res["result"]["access_token"]
        
        # Translate states to Tuya Wipro standard commands
        commands = []
        if 'on' in updates:
            commands.append({"code": "switch_led", "value": updates["on"]})
            # Also try general switch command
            commands.append({"code": "switch", "value": updates["on"]})
            
        if 'brightness' in updates:
            # 10 to 1000 scale
            commands.append({"code": "bright_value", "value": int(updates["brightness"] * 10)})
            
        if 'color' in updates:
            # Convert Hex to HSV
            hex_val = updates["color"].replace('#', '')
            try:
                rgb = tuple(int(hex_val[i:i+2], 16) for i in (0, 2, 4))
                r, g, b = [x/255.0 for x in rgb]
                mx, mn = max(r, g, b), min(r, g, b)
                df = mx - mn
                h = 0
                if mx != mn:
                    if mx == r: h = (g - b) / df + (6 if g < b else 0)
                    elif mx == g: h = (b - r) / df + 2
                    elif mx == b: h = (r - g) / df + 4
                    h /= 6.0
                s = 0 if mx == 0 else df / mx
                v = mx
                
                h_deg = int(h * 360)
                s_val = int(s * 1000)
                v_val = int(v * 1000)
                
                # Tuya standard JSON string format for color
                color_json = json.dumps({"h": h_deg, "s": s_val, "v": v_val})
                commands.append({"code": "colour_data", "value": color_json})
                commands.append({"code": "colour_data_v2", "value": color_json})
            except Exception:
                pass
                
        body_str = json.dumps({"commands": commands})
        print(f"[Tuya API] Sending commands to device {device_id}: {body_str}")
        
        cmd_res = tuya_api_call(region, client_id, client_secret, access_token, 'POST', f'/v1.0/devices/{device_id}/commands', body_str)
        if cmd_res.get("success"):
            return {"success": True, "result": cmd_res.get("result")}
        else:
            return {"success": False, "error": cmd_res.get("msg", "Unknown error")}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.get("/api/camera-config")
async def get_camera_config():
    try:
        p = Path("go2rtc.yaml")
        cloud_path = Path("eseecloud_creds.json")
        email = ''
        password = ''
        if cloud_path.exists():
            try:
                with open(cloud_path, "r", encoding="utf-8") as f:
                    cloud_creds = json.load(f)
                    email = cloud_creds.get("email") or ''
                    password = cloud_creds.get("password") or ''
            except Exception:
                pass
                
        config_data = p.read_text(encoding="utf-8") if p.exists() else ''
        return {
            "config": config_data,
            "activeUrl": active_rtsp_url,
            "cloudEmail": email,
            "cloudPassword": password
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/camera-config")
async def post_camera_config(request: Request):
    try:
        data = await request.json()
        ip_address = data.get("ipAddress")
        username = data.get("username")
        password = data.get("password")
        rtsp_path = data.get("rtspPath")
        
        if not ip_address or not username:
            return JSONResponse(status_code=400, content={"error": "IP and username required."})
            
        # Handle EseeCloud Cloud mode: if username contains '@'
        if '@' in username:
            with open("eseecloud_creds.json", "w", encoding="utf-8") as f:
                json.dump({"email": username, "password": password}, f)
            with open("go2rtc.yaml", "w", encoding="utf-8") as f:
                f.write("streams:\n  camera1:\n    - rtsp://127.0.0.1:554/dummy\n")
            start_go2rtc()
            return {"success": True, "mode": "cloud"}
            
        cloud_path = Path("eseecloud_creds.json")
        if cloud_path.exists():
            try:
                cloud_path.unlink()
            except Exception:
                pass
                
        ep = urllib.parse.quote(password or '')
        with open("go2rtc.yaml", "w", encoding="utf-8") as f:
            f.write(f"streams:\n  camera1:\n    - rtsp://{username}:{ep}@{ip_address}:554/{rtsp_path or 'ch0_0.264'}\n")
            
        start_go2rtc()
        
        # Async discover RTSP in background
        def run_discovery():
            url = discover_rtsp_url(ip_address, username, password)
            if url:
                start_ffmpeg_hls(url)
                
        # Simple fire-and-forget or BackgroundTasks
        # We can use fastapi BackgroundTasks
        # We will define a background tasks handler
        return {"success": True, "mode": "local"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/hls-status")
async def hls_status():
    playlist = HLS_DIR / 'camera1.m3u8'
    is_live = playlist.exists() and ffmpeg_hls_process is not None
    return {"live": is_live, "activeUrl": active_rtsp_url}

@app.get("/api/probe-camera")
async def probe_camera(ip: Optional[str] = None, user: str = 'admin', pass_: str = Query('', alias='pass')):
    try:
        target_ip = ip or get_saved_camera_ip()
        work_url = discover_rtsp_url(target_ip, user, pass_)
        if work_url:
            start_ffmpeg_hls(work_url)
            return {"success": True, "url": work_url, "hlsPath": "/hls/camera1.m3u8"}
        else:
            return {"success": False, "error": "No RTSP stream accessible. Camera may be P2P-only."}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/scan-lan")
async def scan_lan():
    try:
        # Check OS for command
        if sys.platform == "win32":
            res = subprocess.run(['arp', '-a'], capture_output=True, text=True)
            stdout = res.stdout
        else:
            res = subprocess.run(['arp', '-an'], capture_output=True, text=True)
            stdout = res.stdout
            
        ip_regex = r'((?:192\.168|10\.\d+|172\.\d+)\.\d+\.\d+)'
        unique_ips = list(set(re.findall(ip_regex, stdout)))
        unique_ips = [ip for ip in unique_ips if not ip.endswith('.255') and not ip.endswith('.0') and ip != '127.0.0.1']
        
        devices = []
        for ip in unique_ips:
            open_ports = probe_ports(ip, PROBE_PORTS)
            devices.append(fingerprint_device(ip, open_ports))
            
        return {"devices": devices, "count": len(devices)}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e), "devices": []})

@app.get("/api/scan-onvif")
async def scan_onvif():
    try:
        # WS-Discovery multicast probe
        uuid_str = str(uuid.uuid4())
        probe_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <s:Header>
    <a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
    <a:MessageID>uuid:{uuid_str}</a:MessageID>
    <a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>
  </s:Header>
  <s:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </s:Body>
</s:Envelope>"""

        discovered = []
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2.0)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        
        try:
            sock.sendto(probe_xml.encode('utf-8'), ('239.255.255.250', 3702))
            while True:
                data, addr = sock.recvfrom(4096)
                xml = data.decode('utf-8', errors='ignore')
                xaddr_match = re.search(r'<[^>]*XAddrs[^>]*>([^<]+)<\/[^>]*XAddrs>', xml, re.IGNORECASE)
                hardware_match = re.search(r'onvif:\/\/www\.onvif\.org\/hardware\/([^\s<"]+)', xml, re.IGNORECASE)
                
                if xaddr_match:
                    xaddr = xaddr_match.group(1).strip()
                    ip_match = re.search(r'(\d+\.\d+\.\d+\.\d+)', xaddr)
                    if ip_match:
                        ip = ip_match.group(1)
                        if not any(d["ipAddress"] == ip for d in discovered):
                            discovered.append({
                                "ipAddress": ip,
                                "xAddr": xaddr,
                                "hardware": hardware_match.group(1) if hardware_match else 'ONVIF Camera',
                                "source": "onvif"
                            })
        except socket.timeout:
            pass
        finally:
            sock.close()
            
        devices = []
        for d in discovered:
            fp = fingerprint_device(d["ipAddress"], [554, 80])
            fp.update({
                "name": d["hardware"],
                "source": "onvif",
                "xAddr": d["xAddr"]
            })
            devices.append(fp)
            
        # Also try ONVIF HTTP probe on camera IP
        cam_ip = get_saved_camera_ip()
        if not any(d["ipAddress"] == cam_ip for d in devices):
            # Check if port 80 or 8080 is open on camera IP
            ports = probe_ports(cam_ip, [80, 8080])
            if ports:
                fp = fingerprint_device(cam_ip, ports)
                fp.update({
                    "name": "EseeCloud IP Camera (HTTP)",
                    "source": "onvif-http"
                })
                devices.append(fp)
                
        return {"devices": devices, "count": len(devices)}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e), "devices": []})

@app.get("/api/scan-network")
async def scan_network():
    try:
        if sys.platform == "win32":
            res = subprocess.run(['arp', '-a'], capture_output=True, text=True)
            stdout = res.stdout
        else:
            res = subprocess.run(['arp', '-an'], capture_output=True, text=True)
            stdout = res.stdout
            
        ip_regex = r'(192\.168\.\d+\.\d+)'
        unique_ips = list(set(re.findall(ip_regex, stdout)))
        unique_ips = [ip for ip in unique_ips if not ip.endswith('.255') and not ip.endswith('.0')]
        
        devices = []
        for ip in unique_ips:
            last = int(ip.split('.')[-1])
            if ip == '192.168.1.3':
                devices.append({"name": "EseeCloud IP Camera", "category": "camera", "protocol": "P2P", "ipAddress": ip, "icon": "fa-video", "color": "#a78bfa"})
            elif ip == '192.168.1.1':
                devices.append({"name": "Gateway Router", "category": "appliance", "protocol": "WiFi", "ipAddress": ip, "icon": "fa-network-wired", "color": "#94a3b8"})
            else:
                devices.append({"name": f"Network Device {last}", "category": "appliance", "protocol": "WiFi", "ipAddress": ip, "icon": "fa-microchip", "color": "#64748b"})
                
        return {"devices": devices}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e), "devices": []})

# ── POST /api/search ── real-time multi-source search
@app.post("/api/search")
async def search_endpoint(request: Request):
    try:
        data = await request.json()
        query = data.get("query")
        if not query:
            return JSONResponse(status_code=400, content={"error": "Missing query parameter"})
            
        q = query.strip()
        results = []
        
        # 1. SerpAPI if SERPER_API_KEY is configured
        serp_api_key = os.getenv("SERPER_API_KEY")
        if serp_api_key:
            try:
                serp_url = f"https://serpapi.com/search?engine=google&q={urllib.parse.quote(q)}&api_key={serp_api_key}&gl=in&hl=en&num=5&no_cache=false"
                resp = requests.get(serp_url, headers={'Accept': 'application/json'}, timeout=8)
                if resp.status_code == 200:
                    serp_data = resp.json()
                    
                    if "answer_box" in serp_data:
                        ab = serp_data["answer_box"]
                        text = ab.get("answer") or ab.get("snippet") or (", ".join(ab["list"]) if isinstance(ab.get("list"), list) else "") or ""
                        if text:
                            results.append({
                                "source": "Google Answer Box",
                                "title": ab.get("title") or q,
                                "text": text.strip(),
                                "url": ab.get("link") or "",
                                "confidence": 0.97,
                                "type": "answer_box"
                            })
                            
                    if "knowledge_graph" in serp_data:
                        kg = serp_data["knowledge_graph"]
                        text = kg.get("description") or ""
                        extra_facts = ", ".join(f"{k}: {v}" for k, v in kg.items() if k not in ['title', 'type', 'description', 'header_images', 'source', 'knowledge_graph_search_link'])
                        full_text = " | ".join(filter(None, [text, extra_facts]))
                        if full_text:
                            results.append({
                                "source": "Google Knowledge Graph",
                                "title": kg.get("title") or q,
                                "text": full_text,
                                "url": kg.get("website") or "",
                                "confidence": 0.95,
                                "type": "knowledge_graph"
                            })
                            
                    for item in serp_data.get("organic_results", [])[:4]:
                        text = item.get("snippet") or ""
                        if text:
                            domain = urllib.parse.urlparse(item.get("link", "")).hostname or ""
                            results.append({
                                "source": f"Google ({domain})",
                                "title": item.get("title") or "",
                                "text": text,
                                "url": item.get("link") or "",
                                "confidence": 0.87,
                                "type": "organic"
                            })
            except Exception as e:
                print(f"[SerpAPI] Request failed: {e}")

        # 2. DuckDuckGo Scrape Fallback
        if len(results) < 3:
            try:
                ddg_url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(q)}"
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
                resp = requests.get(ddg_url, headers=headers, timeout=6)
                if resp.status_code == 200:
                    html = resp.text
                    parts = html.split('<div class="result results_links results_links_deep web-result ">')
                    parsed_count = 0
                    for part in parts[1:5]:
                        block = part.split('<!-- This is the visible part -->')[-1]
                        href_match = re.search(r'class="result__a"\s+href="([^"]+)"', block)
                        href = href_match.group(1) if href_match else ""
                        if href.startswith('//'):
                            href = 'https:' + href
                        decoded_url = href
                        if 'uddg=' in href:
                            try:
                                params = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
                                if 'uddg' in params:
                                    decoded_url = params['uddg'][0]
                            except Exception:
                                pass
                                
                        title_match = re.search(r'class="result__a"[^>]*>([\s\S]*?)<\/a>', block)
                        title = re.sub(r'<[^>]*>', '', title_match.group(1)).strip() if title_match else ""
                        
                        snippet_match = re.search(r'class="result__snippet"[^>]*>([\s\S]*?)<\/a>', block) or re.search(r'class="result__snippet"[^>]*>([\s\S]*?)<\/div>', block)
                        snippet = re.sub(r'<[^>]*>', '', snippet_match.group(1)).strip() if snippet_match else ""
                        
                        if title and snippet:
                            domain = urllib.parse.urlparse(decoded_url).hostname or "DuckDuckGo"
                            results.append({
                                "source": f"Web ({domain})",
                                "title": title,
                                "text": snippet,
                                "url": decoded_url,
                                "confidence": 0.85,
                                "type": "organic"
                            })
                            parsed_count += 1
            except Exception as e:
                print(f"[DDG Scrape] Request failed: {e}")

        # 3. DuckDuckGo Instant Answer API
        try:
            ddg_api = f"https://api.duckduckgo.com/?q={urllib.parse.quote(q)}&format=json&no_html=1&skip_disambig=1"
            resp = requests.get(ddg_api, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("Answer"):
                    results.append({
                        "source": "DuckDuckGo Instant",
                        "title": data.get("Heading") or q,
                        "text": data["Answer"],
                        "url": "",
                        "confidence": 0.91,
                        "type": "instant_answer"
                    })
                if data.get("AbstractText"):
                    results.append({
                        "source": f"DuckDuckGo ({data.get('AbstractSource') or 'Web'})",
                        "title": data.get("Heading") or q,
                        "text": data["AbstractText"],
                        "url": data.get("AbstractURL") or "",
                        "confidence": 0.83,
                        "type": "abstract"
                    })
        except Exception as e:
            print(f"[DDG API] Request failed: {e}")

        # 4. Wikipedia
        if len(results) < 2:
            try:
                wiki_search = f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(q)}&limit=2&format=json"
                resp = requests.get(wiki_search, timeout=5)
                if resp.status_code == 200:
                    wiki_data = resp.json()
                    search_results = wiki_data.get("query", {}).get("search", [])
                    if search_results:
                        title = search_results[0]["title"]
                        wiki_summary_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title.replace(' ', '_'))}"
                        resp2 = requests.get(wiki_summary_url, timeout=5)
                        if resp2.status_code == 200:
                            summary_data = resp2.json()
                            if summary_data.get("extract"):
                                results.append({
                                    "source": "Wikipedia",
                                    "title": summary_data.get("title") or title,
                                    "text": summary_data["extract"],
                                    "url": summary_data.get("content_urls", {}).get("desktop", {}).get("page") or "",
                                    "confidence": 0.82,
                                    "type": "encyclopedia"
                                })
            except Exception as e:
                print(f"[Wikipedia API] Request failed: {e}")

        results.sort(key=lambda x: x.get("confidence", 0), reverse=True)
        return {
            "query": q,
            "found": len(results) > 0,
            "results": results[:6],
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            "backend": "lukas-search-fastapi",
            "serpapi_used": bool(serp_api_key)
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e), "found": False, "results": []})

# ── POST /api/music-search ── Invidious YouTube audio search
@app.post("/api/music-search")
async def music_search(request: Request):
    global cached_invidious_instances, last_invidious_fetch_time
    try:
        data = await request.json()
        query = data.get("query")
        if not query or not query.strip():
            return JSONResponse(status_code=400, content={"found": False, "error": "Missing query"})
            
        q = query.strip()
        print(f"[Music Search] Searching for: {q}")
        
        # Resolve dynamic Invidious instances
        now = int(time.time() * 1000)
        if not cached_invidious_instances or (now - last_invidious_fetch_time > 1800000):
            fallback_list = [
                'https://invidious.io.lol',
                'https://inv.nadeko.net',
                'https://invidious.nerdvpn.de',
                'https://invidious.privacyredirect.com',
                'https://invidious.perennialte.ch'
            ]
            try:
                resp = requests.get('https://api.invidious.io/v1/instances?sort_by=type,health', timeout=4)
                if resp.status_code == 200:
                    list_data = resp.json()
                    instances = []
                    for item in list_data:
                        if isinstance(item, list) and len(item) > 1 and isinstance(item[1], dict):
                            instances.append(item[1])
                        elif isinstance(item, dict):
                            instances.append(item)
                            
                    healthy_urls = []
                    for inst in instances:
                        if not inst or not inst.get("uri") or inst.get("type") != 'https' or inst.get("api") is not True:
                            continue
                        if inst.get("metadata", {}).get("online") is False:
                            continue
                        healthy_urls.append(inst)
                        
                    healthy_urls.sort(key=lambda x: x.get("metadata", {}).get("uptime") or 0, reverse=True)
                    url_strings = [x["uri"] for x in healthy_urls]
                    if url_strings:
                        cached_invidious_instances = url_strings[:8]
                        last_invidious_fetch_time = now
                    else:
                        cached_invidious_instances = fallback_list
                else:
                    cached_invidious_instances = fallback_list
            except Exception:
                cached_invidious_instances = fallback_list
                
        search_results = None
        working_instance = None
        
        for instance in cached_invidious_instances:
            try:
                search_url = f"{instance}/api/v1/search?q={urllib.parse.quote(q + ' audio')}&type=video&fields=videoId,title,author,lengthSeconds,videoThumbnails"
                resp = requests.get(search_url, timeout=7)
                if resp.status_code == 200:
                    results = resp.json()
                    if isinstance(results, list) and len(results) > 0:
                        search_results = results
                        working_instance = instance
                        print(f"[Music Search] Got {len(results)} results from {instance}")
                        break
            except Exception as e:
                print(f"[Music Search] Instance {instance} failed: {e}")
                
        if not search_results or not working_instance:
            return {"found": False, "error": "All Invidious instances unavailable"}
            
        # Score and pick best result
        q_words = [w for w in q.lower().split() if len(w) > 1]
        scored_results = []
        for r in search_results[:8]:
            score = 0
            title = (r.get("title") or "").lower()
            author = (r.get("author") or "").lower()
            
            title_matches = len([w for w in q_words if w in title])
            score += (title_matches / max(len(q_words), 1)) * 50
            
            if any(k in author for k in ['- topic', 'vevo', 'official']):
                score += 30
                
            duration = r.get("lengthSeconds") or 0
            if 60 < duration < 480:
                score += 20
            elif duration > 480:
                score -= 10
                
            if any(k in title for k in ['mix', 'compilation', 'full album', 'playlist']):
                score -= 20
                
            scored_results.append((score, r))
            
        scored_results.sort(key=lambda x: x[0], reverse=True)
        best = scored_results[0][1] if scored_results else search_results[0]
        
        print(f"[Music Search] Best match: \"{best.get('title')}\" by \"{best.get('author')}\" ({best.get('videoId')})")
        
        # Get audio stream URL
        audio_url = None
        try:
            video_url = f"{working_instance}/api/v1/videos/{best['videoId']}?fields=adaptiveFormats,formatStreams"
            resp = requests.get(video_url, timeout=7)
            if resp.status_code == 200:
                video_data = resp.json()
                
                adaptive = video_data.get("adaptiveFormats", [])
                audio_formats = [f for f in adaptive if f.get("type", "").startswith("audio/") and f.get("url")]
                audio_formats.sort(key=lambda x: x.get("bitrate", 0), reverse=True)
                
                if audio_formats:
                    audio_url = audio_formats[0]["url"]
                    print(f"[Music Search] Audio stream found ({audio_formats[0]['type']})")
                else:
                    streams = video_data.get("formatStreams", [])
                    combined = next((f for f in streams if f.get("url")), None)
                    if combined:
                        audio_url = combined["url"]
                        print(f"[Music Search] Using combined stream format")
        except Exception as e:
            print(f"[Music Search] Stream URL fetch failed: {e}")
            
        if not audio_url:
            return {
                "found": False,
                "error": "Could not get audio stream URL",
                "partial": {
                    "videoId": best.get("videoId"),
                    "title": best.get("title"),
                    "author": best.get("author")
                }
            }
            
        thumbnails = best.get("videoThumbnails", [])
        thumbnail = ""
        for t in thumbnails:
            if t.get("quality") == "medium":
                thumbnail = t.get("url")
                break
        if not thumbnail and thumbnails:
            thumbnail = thumbnails[0].get("url") or ""
            
        return {
            "found": True,
            "track": {
                "videoId": best.get("videoId"),
                "title": best.get("title"),
                "author": best.get("author"),
                "audioUrl": audio_url,
                "thumbnail": thumbnail,
                "duration": best.get("lengthSeconds") or 0,
                "instance": working_instance
            }
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"found": False, "error": str(e)})

if __name__ == "__main__":
    import uvicorn
    # Change CWD to project root (one level up from api/) so all relative paths work
    project_root = Path(__file__).resolve().parent.parent
    os.chdir(project_root)
    print(f"[LUKAS Backend] Working directory: {os.getcwd()}")
    # Start uvicorn server on localhost:8000
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False, log_level="info")
