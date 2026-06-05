// deviceKnowledgeBase.js — Comprehensive IoT/Smart Home Device Catalog
// Maps open ports, BLE names, and IP addresses to real device identities

// ── Port → Device Fingerprints ───────────────────────────────────────────────
export const PORT_FINGERPRINTS = [
  // ── Cameras ────────────────────────────────────────────────────────────────
  { ports: [554, 80],   category: 'camera',    brand: 'ONVIF IP Camera',             protocol: 'ONVIF',     icon: 'fa-video',           color: '#a78bfa' },
  { ports: [554],       category: 'camera',    brand: 'RTSP IP Camera',              protocol: 'RTSP',      icon: 'fa-video',           color: '#a78bfa' },
  { ports: [8000],      category: 'camera',    brand: 'Hikvision Camera / DVR',      protocol: 'ONVIF',     icon: 'fa-video',           color: '#a78bfa' },
  { ports: [37777],     category: 'camera',    brand: 'Dahua Camera / NVR',          protocol: 'ONVIF',     icon: 'fa-video',           color: '#a78bfa' },
  { ports: [9000],      category: 'camera',    brand: 'Reolink Camera',              protocol: 'RTSP',      icon: 'fa-video',           color: '#a78bfa' },
  { ports: [34567],     category: 'camera',    brand: 'DVR/NVR (XMEye/EseeCloud)',   protocol: 'P2P',       icon: 'fa-video',           color: '#a78bfa' },
  { ports: [80, 8080],  category: 'camera',    brand: 'Web Camera / IP Cam',         protocol: 'HTTP',      icon: 'fa-video',           color: '#a78bfa' },

  // ── Smart Lighting ──────────────────────────────────────────────────────────
  { ports: [56700],     category: 'light',     brand: 'LIFX Smart Bulb',             protocol: 'WiFi',      icon: 'fa-lightbulb',       color: '#fbbf24' },
  { ports: [1982],      category: 'light',     brand: 'Yeelight Smart Bulb',         protocol: 'WiFi',      icon: 'fa-lightbulb',       color: '#fbbf24' },
  { ports: [80, 443],   category: 'light',     brand: 'Philips Hue Bridge',          protocol: 'Zigbee',    icon: 'fa-lightbulb',       color: '#fbbf24' },
  { ports: [4001],      category: 'light',     brand: 'Govee Smart Light',           protocol: 'WiFi',      icon: 'fa-lightbulb',       color: '#fbbf24' },

  // ── Smart Plugs & Switches ──────────────────────────────────────────────────
  { ports: [9999],      category: 'appliance', brand: 'TP-Link Kasa Smart Plug',     protocol: 'WiFi',      icon: 'fa-plug',            color: '#34d399' },
  { ports: [9123],      category: 'appliance', brand: 'TP-Link Tapo Device',         protocol: 'WiFi',      icon: 'fa-plug',            color: '#34d399' },
  { ports: [6668],      category: 'appliance', brand: 'Tuya / SmartLife Device',     protocol: 'WiFi',      icon: 'fa-plug',            color: '#34d399' },
  { ports: [4000],      category: 'appliance', brand: 'Shelly Smart Relay',          protocol: 'WiFi',      icon: 'fa-plug',            color: '#34d399' },
  { ports: [10001],     category: 'appliance', brand: 'Meross Smart Plug',           protocol: 'WiFi',      icon: 'fa-plug',            color: '#34d399' },
  { ports: [55443],     category: 'appliance', brand: 'Xiaomi Mi Device',            protocol: 'WiFi',      icon: 'fa-plug',            color: '#34d399' },
  { ports: [8888],      category: 'appliance', brand: 'Wemo Smart Switch',           protocol: 'WiFi',      icon: 'fa-plug',            color: '#34d399' },

  // ── Smart Speakers & Media ──────────────────────────────────────────────────
  { ports: [8008, 8009],category: 'media',     brand: 'Google Chromecast / Home',    protocol: 'WiFi',      icon: 'fa-compact-disc',    color: '#60a5fa' },
  { ports: [1400],      category: 'media',     brand: 'Sonos Smart Speaker',         protocol: 'WiFi',      icon: 'fa-music',           color: '#60a5fa' },
  { ports: [7000],      category: 'media',     brand: 'Apple TV / AirPlay',          protocol: 'WiFi',      icon: 'fa-music',           color: '#60a5fa' },
  { ports: [49153],     category: 'media',     brand: 'Amazon Echo / Alexa',         protocol: 'WiFi',      icon: 'fa-music',           color: '#60a5fa' },
  { ports: [3689],      category: 'media',     brand: 'iTunes / DAAP Media Server',  protocol: 'WiFi',      icon: 'fa-music',           color: '#60a5fa' },

  // ── Thermostats & Climate ────────────────────────────────────────────────────
  { ports: [443, 8443], category: 'climate',   brand: 'Nest / Google Thermostat',    protocol: 'WiFi',      icon: 'fa-temperature-half',color: '#fb923c' },
  { ports: [8080],      category: 'climate',   brand: 'Ecobee Thermostat',           protocol: 'WiFi',      icon: 'fa-temperature-half',color: '#fb923c' },
  { ports: [80, 443],   category: 'climate',   brand: 'Tado Smart Thermostat',       protocol: 'WiFi',      icon: 'fa-temperature-half',color: '#fb923c' },

  // ── Security & Locks ─────────────────────────────────────────────────────────
  { ports: [47128],     category: 'security',  brand: 'August Smart Lock',           protocol: 'BLE',       icon: 'fa-lock',            color: '#f43f5e' },
  { ports: [443],       category: 'security',  brand: 'Ring Doorbell / Camera',      protocol: 'WiFi',      icon: 'fa-bell',            color: '#f43f5e' },
  { ports: [5353],      category: 'security',  brand: 'Arlo Security Camera',        protocol: 'WiFi',      icon: 'fa-shield-halved',   color: '#f43f5e' },

  // ── Hubs & Gateways ──────────────────────────────────────────────────────────
  { ports: [8123],      category: 'appliance', brand: 'Home Assistant Hub',          protocol: 'WiFi',      icon: 'fa-house-signal',    color: '#00f0ff' },
  { ports: [1883],      category: 'appliance', brand: 'MQTT Broker',                 protocol: 'WiFi',      icon: 'fa-server',          color: '#00f0ff' },
  { ports: [8883],      category: 'appliance', brand: 'MQTT Broker (TLS)',           protocol: 'WiFi',      icon: 'fa-server',          color: '#00f0ff' },
  { ports: [39500],     category: 'appliance', brand: 'Samsung SmartThings Hub',     protocol: 'Zigbee',    icon: 'fa-house-signal',    color: '#00f0ff' },
  { ports: [80, 8080],  category: 'appliance', brand: 'Zigbee2MQTT Bridge',          protocol: 'Zigbee',    icon: 'fa-house-signal',    color: '#00f0ff' },
  { ports: [8888],      category: 'appliance', brand: 'Hubitat Elevation Hub',       protocol: 'Zigbee',    icon: 'fa-house-signal',    color: '#00f0ff' },

  // ── Routers & Network ─────────────────────────────────────────────────────────
  { ports: [80, 443, 22],category:'appliance', brand: 'Network Gateway / Router',    protocol: 'WiFi',      icon: 'fa-network-wired',   color: '#94a3b8' },

  // ── ESP / DIY IoT ─────────────────────────────────────────────────────────────
  { ports: [80, 81],    category: 'appliance', brand: 'ESP8266/ESP32 (ESPHome)',      protocol: 'WiFi',      icon: 'fa-microchip',       color: '#34d399' },
  { ports: [8266],      category: 'appliance', brand: 'NodeMCU / Arduino IoT',       protocol: 'WiFi',      icon: 'fa-microchip',       color: '#34d399' },
];

// ── BLE Name → Device Fingerprint ────────────────────────────────────────────
export const BLE_NAME_PATTERNS = [
  // Cameras
  { re: /esee|ippro|ip.?pro|eseecloud/i,         category: 'camera',    brand: 'EseeCloud IP Camera',       icon: 'fa-video',           color: '#a78bfa' },
  { re: /wyze.?cam|wyze/i,                        category: 'camera',    brand: 'Wyze Camera',               icon: 'fa-video',           color: '#a78bfa' },
  { re: /arlo/i,                                  category: 'camera',    brand: 'Arlo Security Camera',      icon: 'fa-video',           color: '#a78bfa' },
  // Lighting
  { re: /lifx/i,                                  category: 'light',     brand: 'LIFX Smart Bulb',           icon: 'fa-lightbulb',       color: '#fbbf24' },
  { re: /yeelight/i,                              category: 'light',     brand: 'Yeelight Bulb',             icon: 'fa-lightbulb',       color: '#fbbf24' },
  { re: /govee/i,                                 category: 'light',     brand: 'Govee Smart Light',         icon: 'fa-lightbulb',       color: '#fbbf24' },
  { re: /hue|philips/i,                           category: 'light',     brand: 'Philips Hue',               icon: 'fa-lightbulb',       color: '#fbbf24' },
  { re: /sengled/i,                               category: 'light',     brand: 'Sengled Smart Bulb',        icon: 'fa-lightbulb',       color: '#fbbf24' },
  { re: /nanoleaf/i,                              category: 'light',     brand: 'Nanoleaf Light Panel',      icon: 'fa-lightbulb',       color: '#fbbf24' },
  // Plugs & Switches
  { re: /kasa|tp.?link/i,                         category: 'appliance', brand: 'TP-Link Kasa Device',       icon: 'fa-plug',            color: '#34d399' },
  { re: /tapo/i,                                  category: 'appliance', brand: 'TP-Link Tapo Device',       icon: 'fa-plug',            color: '#34d399' },
  { re: /shelly/i,                                category: 'appliance', brand: 'Shelly Smart Relay',        icon: 'fa-plug',            color: '#34d399' },
  { re: /meross/i,                                category: 'appliance', brand: 'Meross Smart Plug',         icon: 'fa-plug',            color: '#34d399' },
  { re: /tuya|smart.?life/i,                      category: 'appliance', brand: 'Tuya SmartLife Device',     icon: 'fa-plug',            color: '#34d399' },
  { re: /wemo/i,                                  category: 'appliance', brand: 'Belkin WeMo Switch',        icon: 'fa-plug',            color: '#34d399' },
  { re: /xiaomi|mi |mijia/i,                      category: 'appliance', brand: 'Xiaomi Mi Device',          icon: 'fa-plug',            color: '#34d399' },
  { re: /switchbot/i,                             category: 'appliance', brand: 'SwitchBot Device',          icon: 'fa-plug',            color: '#34d399' },
  // Speakers & Media
  { re: /google.?home|nest.?hub|chromecast/i,    category: 'media',     brand: 'Google Home / Nest',        icon: 'fa-compact-disc',    color: '#60a5fa' },
  { re: /echo|alexa|amazon/i,                    category: 'media',     brand: 'Amazon Echo',               icon: 'fa-music',           color: '#60a5fa' },
  { re: /sonos/i,                                 category: 'media',     brand: 'Sonos Speaker',             icon: 'fa-music',           color: '#60a5fa' },
  { re: /jbl|harman/i,                            category: 'media',     brand: 'JBL/Harman Speaker',        icon: 'fa-music',           color: '#60a5fa' },
  { re: /bose/i,                                  category: 'media',     brand: 'Bose Speaker',              icon: 'fa-music',           color: '#60a5fa' },
  { re: /soundbar|speaker|audio/i,               category: 'media',     brand: 'BLE Audio Device',          icon: 'fa-music',           color: '#60a5fa' },
  // Thermostats & Climate
  { re: /nest|ecobee|tado|honeywell/i,           category: 'climate',   brand: 'Smart Thermostat',          icon: 'fa-temperature-half',color: '#fb923c' },
  { re: /daikin|lg.?ac|samsung.?ac/i,            category: 'climate',   brand: 'Smart AC Unit',             icon: 'fa-snowflake',       color: '#fb923c' },
  // Security & Locks
  { re: /august|yale|schlage|kwikset|deadbolt/i, category: 'security',  brand: 'Smart Lock',                icon: 'fa-lock',            color: '#f43f5e' },
  { re: /ring|doorbell/i,                         category: 'security',  brand: 'Ring Doorbell',             icon: 'fa-bell',            color: '#f43f5e' },
  { re: /sensor|motion|door.?win|smoke|leak/i,   category: 'security',  brand: 'Smart Sensor',              icon: 'fa-shield-halved',   color: '#f43f5e' },
  // Fitness & Health
  { re: /fitbit|garmin|polar|withings/i,         category: 'appliance', brand: 'Fitness Tracker',           icon: 'fa-heart-pulse',     color: '#94a3b8' },
  { re: /band|watch|mi.?band/i,                  category: 'appliance', brand: 'Smartwatch / Band',         icon: 'fa-watch',           color: '#94a3b8' },
  // Catch-all
  { re: /.*/,                                     category: 'appliance', brand: 'Unknown BLE Device',        icon: 'fa-bluetooth',       color: '#94a3b8' },
];

// ── Known Static IP → Device ─────────────────────────────────────────────────
export const KNOWN_IPS = {
  '192.168.1.1':   { name: 'Primary Gateway Router',   category: 'appliance', protocol: 'WiFi',    icon: 'fa-network-wired',   color: '#94a3b8', brand: 'Router' },
  '192.168.1.2':   { name: 'Secondary Gateway',        category: 'appliance', protocol: 'WiFi',    icon: 'fa-network-wired',   color: '#94a3b8', brand: 'Router' },
  '192.168.1.3':   { name: 'EseeCloud IP Camera',      category: 'camera',    protocol: 'P2P',     icon: 'fa-video',           color: '#a78bfa', brand: 'EseeCloud' },
  '192.168.0.1':   { name: 'Primary Gateway Router',   category: 'appliance', protocol: 'WiFi',    icon: 'fa-network-wired',   color: '#94a3b8', brand: 'Router' },
};

// ── Fingerprinting function ───────────────────────────────────────────────────
export function fingerprintDevice(ip, openPorts = []) {
  if (KNOWN_IPS[ip]) {
    const k = KNOWN_IPS[ip];
    return { ...k, ipAddress: ip, openPorts, source: 'known' };
  }

  // Score fingerprints by port match ratio
  let best = null, bestScore = 0;
  for (const fp of PORT_FINGERPRINTS) {
    const hits = fp.ports.filter(p => openPorts.includes(p)).length;
    if (hits === 0) continue;
    const score = hits / fp.ports.length;
    if (score > bestScore) { bestScore = score; best = fp; }
  }

  const last = parseInt(ip.split('.')[3]);
  if (best) {
    return {
      name:      best.brand,
      brand:     best.brand,
      category:  best.category,
      protocol:  best.protocol,
      icon:      best.icon,
      color:     best.color,
      ipAddress: ip,
      openPorts,
      source:    'portScan',
    };
  }

  // Fallback — unknown device on network
  return {
    name:      `Network Device ${last}`,
    brand:     'Unknown',
    category:  'appliance',
    protocol:  'WiFi',
    icon:      'fa-microchip',
    color:     '#64748b',
    ipAddress: ip,
    openPorts,
    source:    'arp',
  };
}

export function fingerprintBLE(name = '') {
  for (const p of BLE_NAME_PATTERNS) {
    if (p.re.test(name)) {
      return {
        name:          name || p.brand,
        brand:         p.brand,
        category:      p.category,
        protocol:      'Bluetooth',
        icon:          p.icon,
        color:         p.color,
        source:        'ble',
      };
    }
  }
  return { name, brand: 'BLE Device', category: 'appliance', protocol: 'Bluetooth', icon: 'fa-bluetooth', color: '#94a3b8', source: 'ble' };
}
