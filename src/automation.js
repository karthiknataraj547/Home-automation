// automation.js - LUKAS Automation and Devices Controller
// Manages device state variables, zones, climate values, and routines.

export const DEVICES = {
  LIVING_ROOM: 'livingRoom',
  BEDROOM: 'bedroom',
  KITCHEN: 'kitchen',
  OUTDOOR: 'outdoor'
};

export const ROUTINES = {
  MORNING: 'morning',
  CINEMA: 'cinema',
  ECO: 'eco',
  LOCKDOWN: 'lockdown'
};

class LukasAutomationHub {
  constructor() {
    // Completely erase dynamic registry database once to start fresh
    if (!localStorage.getItem('lukas_registry_erased_v3')) {
      localStorage.setItem('lukas_dynamic_devices', JSON.stringify([]));
      localStorage.setItem('lukas_registry_erased_v3', 'true');
    }

    // Load dynamic device registry from local storage
    this.dynamicDevices = JSON.parse(localStorage.getItem('lukas_dynamic_devices')) || [];

    this.state = {
      // Keep state.devices compatible with legacy main.js mappings
      devices: {
        livingRoom: this.getDeviceLegacyState("livingRoomLight", { on: true, brightness: 80, color: '#00f0ff' }),
        bedroom: this.getDeviceLegacyState("bedroomLight", { on: false, brightness: 50, color: '#a855f7' }),
        kitchen: this.getDeviceLegacyState("kitchenLight", { on: false, brightness: 60, color: '#10b981' }),
        outdoor: this.getDeviceLegacyState("outdoorLock", { locked: true, floodlights: false })
      },
      climate: {
        indoorTemp: 22.4,
        targetTemp: 22,
        airQuality: 98,
        mode: 'cool'
      },
      activeRoutine: null
    };

    this.onDeviceStateChange = null;
    this.onClimateStateChange = null;
    this.onRoutineTriggered = null;
    this.onRegistryChange = null; // Callback when registry list modifies
  }

  getDeviceLegacyState(id, fallback) {
    const dev = this.dynamicDevices.find(d => d.id === id);
    if (!dev) return fallback;
    if (id === "outdoorLock") {
      return { locked: dev.locked, floodlights: dev.floodlights || false };
    }
    return { on: dev.on, brightness: dev.brightness, color: dev.color };
  }

  saveDynamicDevices() {
    localStorage.setItem('lukas_dynamic_devices', JSON.stringify(this.dynamicDevices));
    if (this.onRegistryChange) this.onRegistryChange(this.dynamicDevices);
  }

  // Set individual device state
  setDeviceState(id, updates) {
    // Check if legacy key is used
    let resolvedId = id;
    if (id === DEVICES.LIVING_ROOM) resolvedId = 'livingRoomLight';
    else if (id === DEVICES.BEDROOM) resolvedId = 'bedroomLight';
    else if (id === DEVICES.KITCHEN) resolvedId = 'kitchenLight';
    else if (id === DEVICES.OUTDOOR) resolvedId = 'outdoorLock';

    const dev = this.dynamicDevices.find(d => d.id === resolvedId);
    
    // Determine the legacy key
    const legacyKey = resolvedId === 'livingRoomLight' ? 'livingRoom' :
                      resolvedId === 'bedroomLight' ? 'bedroom' :
                      resolvedId === 'kitchenLight' ? 'kitchen' :
                      resolvedId === 'outdoorLock' ? 'outdoor' : null;

    if (dev) {
      Object.assign(dev, updates);
      this.saveDynamicDevices();

      // Send command to physical Tuya cloud device if integrated
      if (dev.integration === 'tuya-cloud' && dev.tuyaDeviceId) {
        fetch('/api/tuya-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: dev.tuyaDeviceId, updates: updates })
        })
        .then(r => r.json())
        .then(data => {
          if (!data.success) {
            console.warn(`[Tuya API Error] ${data.error}`);
            if (typeof window !== 'undefined' && window.diag) {
              window.diag.logToTerminal(`[TUYA ERROR] Command failed for ${dev.name}: ${data.error}`, 'error');
            }
          } else {
            if (typeof window !== 'undefined' && window.diag) {
              window.diag.logToTerminal(`[TUYA] Command sent to Wipro Cloud: ${dev.name} updated.`, 'info');
            }
          }
        })
        .catch(err => {
          console.error('[Tuya Network Error]', err);
        });
      } else if (dev.integration === 'tuya-local' && dev.tuyaLocalKey) {
        if (typeof window !== 'undefined' && window.diag) {
          window.diag.logToTerminal(`[TUYA LOCAL] Sending direct local LAN UDP/TCP commands to ${dev.name} (${dev.ipAddress})...`, 'info');
        }
      }

      // Mirror back to legacy state
      if (legacyKey) {
        if (resolvedId === 'outdoorLock') {
          this.state.devices.outdoor = { locked: dev.locked, floodlights: dev.floodlights || false };
        } else {
          this.state.devices[legacyKey] = { on: dev.on, brightness: dev.brightness, color: dev.color };
        }
      }
    } else {
      // If not in dynamic registry (e.g. registry erased), still update legacy state directly
      if (legacyKey) {
        Object.assign(this.state.devices[legacyKey], updates);
      }
    }

    // Reset active routine if manually changed
    if (this.state.activeRoutine) {
      this.state.activeRoutine = null;
      if (this.onRoutineTriggered) this.onRoutineTriggered(null);
    }

    // Trigger state change callback to refresh UI components
    if (legacyKey && this.onDeviceStateChange) {
      this.onDeviceStateChange(legacyKey, this.state.devices[legacyKey]);
    }
  }

  // Add a brand new device node
  addDevice(name, zone, category, protocol, ipAddress, integration = 'demo', tuyaDeviceId = '', tuyaLocalKey = '') {
    const id = "device_" + Date.now();
    const newDevice = {
      id: id,
      name: name,
      zone: zone,
      category: category,
      protocol: protocol,
      ipAddress: ipAddress,
      integration: integration,
      tuyaDeviceId: tuyaDeviceId,
      tuyaLocalKey: tuyaLocalKey,
      latency: Math.floor(Math.random() * 20) + 5,
      rssi: -50 - Math.floor(Math.random() * 35),
      status: "ONLINE"
    };

    if (category === 'light') {
      newDevice.on = false;
      newDevice.brightness = 70;
      newDevice.color = "#ffffff";
    } else if (category === 'security' || category === 'lock') {
      newDevice.locked = true;
    } else {
      newDevice.on = false;
    }

    this.dynamicDevices.push(newDevice);
    this.saveDynamicDevices();
    return newDevice;
  }

  // Remove a device node
  removeDevice(deviceId) {
    this.dynamicDevices = this.dynamicDevices.filter(d => d.id !== deviceId);
    this.saveDynamicDevices();
    return true;
  }

  // Adjust Climate Controller Target
  setTargetTemperature(temp) {
    const constrainedTemp = Math.max(16, Math.min(30, temp));
    this.state.climate.targetTemp = constrainedTemp;
    
    if (this.onClimateStateChange) {
      this.onClimateStateChange(this.state.climate);
    }
  }

  // Change active climate operating mode
  setClimateMode(mode) {
    if (!['cool', 'heat', 'eco'].includes(mode)) return;
    this.state.climate.mode = mode;
    
    if (mode === 'eco') {
      this.state.climate.targetTemp = 25;
    }

    if (this.onClimateStateChange) {
      this.onClimateStateChange(this.state.climate);
    }
  }

  // Get count of active lights
  getActiveLightsCount() {
    let count = 0;
    // Count built-in lights from state
    if (this.state.devices.livingRoom && this.state.devices.livingRoom.on) count++;
    if (this.state.devices.bedroom && this.state.devices.bedroom.on) count++;
    if (this.state.devices.kitchen && this.state.devices.kitchen.on) count++;
    
    // Count dynamic custom lights
    this.dynamicDevices.forEach(d => {
      // Exclude legacy IDs if they happen to be in dynamicDevices to prevent double counting
      if (d.category === 'light' && !['livingRoomLight', 'bedroomLight', 'kitchenLight'].includes(d.id)) {
        if (d.on) count++;
      }
    });
    
    return count;
  }

  // Get total count of lights
  getTotalLightsCount() {
    let total = 3; // 3 built-in lights
    this.dynamicDevices.forEach(d => {
      if (d.category === 'light' && !['livingRoomLight', 'bedroomLight', 'kitchenLight'].includes(d.id)) {
        total++;
      }
    });
    return total;
  }

  // Trigger Routine Preset Sequences
  triggerRoutine(routineType) {
    this.state.activeRoutine = routineType;
    const { climate } = this.state;
    let logs = [];

    // Resolve dynamic devices
    const living = this.dynamicDevices.find(d => d.id === 'livingRoomLight');
    const bed = this.dynamicDevices.find(d => d.id === 'bedroomLight');
    const kitchen = this.dynamicDevices.find(d => d.id === 'kitchenLight');
    const outdoor = this.dynamicDevices.find(d => d.id === 'outdoorLock');

    switch(routineType) {
      case ROUTINES.MORNING:
        climate.mode = 'heat';
        climate.targetTemp = 23;

        if (bed) { bed.on = true; bed.brightness = 40; bed.color = '#ff9f3b'; }
        if (kitchen) { kitchen.on = true; kitchen.brightness = 85; kitchen.color = '#ffffff'; }
        if (outdoor) { outdoor.locked = false; outdoor.floodlights = false; }

        logs = [
          "Routine 'Morning' Activated.",
          "Thermostat target set to 23°C (HEAT mode).",
          "Bedroom lights set to warm amber (40% intensity).",
          "Kitchen lights fully enabled at 85%.",
          "Main entrance lock deactivated."
        ];
        break;

      case ROUTINES.CINEMA:
        climate.mode = 'cool';
        climate.targetTemp = 21;

        if (living) { living.on = true; living.brightness = 20; living.color = '#8b5cf6'; }
        if (bed) bed.on = false;
        if (kitchen) kitchen.on = false;
        if (outdoor) outdoor.locked = true;

        logs = [
          "Routine 'Cinema Mode' Activated.",
          "Living room lighting dimmed to deep indigo (20%).",
          "Secondary zone lights deactivated.",
          "Main locks secured. Climate adjusted to cool 21°C."
        ];
        break;

      case ROUTINES.ECO:
        climate.mode = 'eco';
        climate.targetTemp = 25;

        if (living) living.on = false;
        if (bed) bed.on = false;
        if (kitchen) kitchen.on = false;
        if (outdoor) outdoor.locked = true;

        logs = [
          "Routine 'Eco Energy Saver' Activated.",
          "All home lighting systems deactivated.",
          "Thermostat configured to ECO standard (25°C).",
          "Main entrance locks verified secure."
        ];
        break;

      case ROUTINES.LOCKDOWN:
        climate.mode = 'eco';
        
        this.dynamicDevices.forEach(d => {
          if (d.category === 'light') {
            d.on = true;
            d.brightness = 100;
            d.color = '#ff0000';
          }
        });

        if (outdoor) {
          outdoor.locked = true;
          outdoor.floodlights = true;
        }

        logs = [
          "SECURITY PROTOCOL 'LOCKDOWN' ENGAGED!",
          "All indoor lighting shifted to high-intensity Alert Crimson.",
          "All external access doors and gates hermetically locked.",
          "High-capacity perimeter floodlights activated.",
          "Surveillance cameras set to maximum tracking frame rates."
        ];
        break;
      
      default:
        this.state.activeRoutine = null;
        return null;
    }

    this.saveDynamicDevices();

    // Mirror back to legacy state properties
    if (living) this.state.devices.livingRoom = { on: living.on, brightness: living.brightness, color: living.color };
    if (bed) this.state.devices.bedroom = { on: bed.on, brightness: bed.brightness, color: bed.color };
    if (kitchen) this.state.devices.kitchen = { on: kitchen.on, brightness: kitchen.brightness, color: kitchen.color };
    if (outdoor) this.state.devices.outdoor = { locked: outdoor.locked, floodlights: outdoor.floodlights };

    // Propagate all changes to handlers
    if (this.onClimateStateChange) this.onClimateStateChange(climate);
    if (this.onDeviceStateChange) {
      if (living) this.onDeviceStateChange('livingRoom', this.state.devices.livingRoom);
      if (bed) this.onDeviceStateChange('bedroom', this.state.devices.bedroom);
      if (kitchen) this.onDeviceStateChange('kitchen', this.state.devices.kitchen);
      if (outdoor) this.onDeviceStateChange('outdoor', this.state.devices.outdoor);
    }
    if (this.onRoutineTriggered) this.onRoutineTriggered(routineType);

    return logs;
  }
}

export default LukasAutomationHub;
