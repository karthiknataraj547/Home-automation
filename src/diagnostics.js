// diagnostics.js - LUKAS System Diagnostics & Energy Charts Engine
// Updates dashboard gauges, terminal output feeds, and draws SVG energy charts.

class LukasDiagnosticsHub {
  constructor() {
    this.gaugeCircumference = 125.6; // 2 * PI * r (r=20)
    
    // Performance metric variables
    this.metrics = {
      cpu: 15,
      ram: 42,
      temp: 48,
      security: 98.4
    };

    // Energy analytics variables
    this.energyHistory = [];
    this.historyLength = 40;
    this.chartWidth = 1000;
    this.chartHeight = 80;
    
    this.initEnergyHistory();
  }

  // Set up gauges with initial values
  initGauges() {
    this.updateGauge('cpu', this.metrics.cpu);
    this.updateGauge('ram', this.metrics.ram);
    this.updateGauge('temp', this.metrics.temp);
    this.updateGauge('security', this.metrics.security);

    // Continuous subtle metric fluctuations
    setInterval(() => {
      this.fluctuateMetrics();
    }, 3000);
  }

  // Update a specific circular SVG gauge
  updateGauge(metric, value) {
    const arcNode = document.getElementById(`${metric}GaugeArc`);
    const labelNode = document.getElementById(`${metric}GaugeText`);
    const detailNode = document.getElementById(`${metric}DetailText`);

    if (!arcNode || !labelNode) return;

    // Convert value to percentage percentage offset
    let percentage = value;
    if (metric === 'temp') {
      percentage = (value / 100) * 100; // Assuming max temp is 100C
    }
    
    const offset = this.gaugeCircumference - (percentage / 100) * this.gaugeCircumference;
    arcNode.style.strokeDashoffset = offset;
    
    if (metric === 'security') {
      labelNode.textContent = 'SEC';
      detailNode.textContent = `INTEG: ${value}%`;
    } else {
      labelNode.textContent = `${Math.round(value)}${metric === 'temp' ? '°' : '%'}`;
      
      if (metric === 'cpu') {
        detailNode.textContent = `${(value * 0.08 + 2.0).toFixed(1)} GHz`;
      } else if (metric === 'ram') {
        detailNode.textContent = `${(value * 0.16).toFixed(1)} GB`;
      } else if (metric === 'temp') {
        detailNode.textContent = `${value.toFixed(1)}°C`;
      }
    }
  }

  fluctuateMetrics() {
    // Random subtle walk for metrics
    this.metrics.cpu = Math.max(8, Math.min(85, this.metrics.cpu + (Math.random() * 10 - 5)));
    this.metrics.ram = Math.max(38, Math.min(48, this.metrics.ram + (Math.random() * 2 - 1)));
    this.metrics.temp = Math.max(42, Math.min(68, this.metrics.temp + (Math.random() * 3 - 1.5)));
    this.metrics.security = Math.max(95, Math.min(100, this.metrics.security + (Math.random() * 0.4 - 0.2)));

    this.updateGauge('cpu', this.metrics.cpu);
    this.updateGauge('ram', this.metrics.ram);
    this.updateGauge('temp', this.metrics.temp);
    this.updateGauge('security', this.metrics.security);
  }

  // Force-bump CPU activity during user command executions
  spikeCPU() {
    this.metrics.cpu = Math.min(95, this.metrics.cpu + Math.random() * 30 + 20);
    this.updateGauge('cpu', this.metrics.cpu);
  }

  // Terminal Console Logging Subsystem
  logToTerminal(text, type = 'normal') {
    const container = document.getElementById('terminalLogContainer');
    if (!container) return;

    // Remove cursor line if present
    const cursor = container.querySelector('.terminal-cursor');
    if (cursor) cursor.remove();

    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;

    // Add high-tech prompt symbol
    const prompt = document.createElement('span');
    prompt.className = 'terminal-prompt';
    prompt.innerHTML = '&gt; ';
    line.appendChild(prompt);

    // Text content
    const textNode = document.createElement('span');
    line.appendChild(textNode);
    container.appendChild(line);

    // Re-append cursor
    const newCursor = document.createElement('span');
    newCursor.className = 'terminal-cursor';
    container.appendChild(newCursor);

    // Typewriter print effect for logs
    let index = 0;
    const typeSpeed = 15; // ms per char
    
    const typeWriter = () => {
      if (index < text.length) {
        textNode.textContent += text.charAt(index);
        index++;
        container.scrollTop = container.scrollHeight;
        setTimeout(typeWriter, typeSpeed);
      } else {
        container.scrollTop = container.scrollHeight;
      }
    };
    
    typeWriter();

    // Cap total terminal log lines at 50 to prevent DOM slowdowns
    const lines = container.querySelectorAll('.terminal-line');
    if (lines.length > 50) {
      lines[0].remove();
    }
  }

  // Initialize simulated energy data
  initEnergyHistory() {
    let solarVal = 3.5;
    let consumeVal = 2.1;

    for (let i = 0; i < this.historyLength; i++) {
      solarVal = Math.max(1.0, Math.min(8.0, solarVal + (Math.random() * 1.2 - 0.6)));
      consumeVal = Math.max(1.5, Math.min(5.0, consumeVal + (Math.random() * 0.8 - 0.4)));
      
      this.energyHistory.push({
        solar: solarVal,
        consumer: consumeVal
      });
    }
  }

  // Generate and render energy curve paths
  drawEnergyChart() {
    const solarLineNode = document.getElementById('solarLinePath');
    const solarAreaNode = document.getElementById('solarAreaPath');
    const consumerLineNode = document.getElementById('consumerLinePath');
    const consumerAreaNode = document.getElementById('consumerAreaPath');
    
    if (!solarLineNode || !consumerLineNode) return;

    // Append new data and trim history
    let lastSolar = this.energyHistory[this.energyHistory.length - 1].solar;
    let lastConsume = this.energyHistory[this.energyHistory.length - 1].consumer;
    
    // Day cycle fluctuations simulation
    const hour = new Date().getHours();
    const solarPeakCoeff = Math.max(0.1, Math.sin((hour / 24) * Math.PI)); // Peak during afternoon
    
    const nextSolar = Math.max(0.2, Math.min(9.0, lastSolar + (Math.random() * 1.0 - 0.5) * solarPeakCoeff));
    const nextConsume = Math.max(1.0, Math.min(7.0, lastConsume + (Math.random() * 0.8 - 0.4)));
    
    this.energyHistory.push({ solar: nextSolar, consumer: nextConsume });
    this.energyHistory.shift();

    // Generate path points
    const step = this.chartWidth / (this.historyLength - 1);
    
    let solarPoints = [];
    let consumerPoints = [];

    this.energyHistory.forEach((pt, index) => {
      const x = index * step;
      // Invert Y coordinate so 0 is at bottom (max range is 10kW)
      const ySolar = this.chartHeight - (pt.solar / 10.0) * this.chartHeight;
      const yConsume = this.chartHeight - (pt.consumer / 10.0) * this.chartHeight;

      solarPoints.push(`${x},${ySolar}`);
      consumerPoints.push(`${x},${yConsume}`);
    });

    // Create SVG paths
    const sLineD = `M ${solarPoints.join(' L ')}`;
    const cLineD = `M ${consumerPoints.join(' L ')}`;
    
    const sAreaD = `M 0,${this.chartHeight} L ${solarPoints.join(' L ')} L ${this.chartWidth},${this.chartHeight} Z`;
    const cAreaD = `M 0,${this.chartHeight} L ${consumerPoints.join(' L ')} L ${this.chartWidth},${this.chartHeight} Z`;

    solarLineNode.setAttribute('d', sLineD);
    solarAreaNode.setAttribute('d', sAreaD);
    consumerLineNode.setAttribute('d', cLineD);
    consumerAreaNode.setAttribute('d', cAreaD);

    // Update status bar header
    const netSupply = nextSolar - nextConsume;
    const solarStatusText = document.getElementById('solarStatusText');
    if (solarStatusText) {
      if (netSupply >= 0) {
        solarStatusText.textContent = `NET SUPPLY: +${netSupply.toFixed(2)} kW (ECO ACTIVE)`;
        solarStatusText.style.color = 'var(--emerald-neon)';
      } else {
        solarStatusText.textContent = `NET DRAW: ${Math.abs(netSupply).toFixed(2)} kW (GRID POWER)`;
        solarStatusText.style.color = 'var(--cyan-neon)';
      }
    }
  }

  // Setup hover inspection controls for the energy chart
  initChartTooltip() {
    const container = document.getElementById('energyChartContainer');
    const scanLine = document.getElementById('chartScanLine');
    const tooltip = document.getElementById('chartTooltip');
    
    if (!container || !scanLine || !tooltip) return;

    container.addEventListener('mousemove', (e) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentX = x / rect.width;
      
      // Map x coordinate to history index
      const dataIndex = Math.floor(percentX * this.historyLength);
      const data = this.energyHistory[Math.max(0, Math.min(this.historyLength - 1, dataIndex))];
      
      if (data) {
        const svgX = percentX * this.chartWidth;
        scanLine.setAttribute('x1', svgX);
        scanLine.setAttribute('x2', svgX);
        scanLine.style.display = 'block';

        // Position tooltip relative to cursor
        tooltip.style.left = `${e.clientX - rect.left + 15}px`;
        tooltip.style.top = `${e.clientY - rect.top - 40}px`;
        tooltip.style.display = 'block';
        tooltip.innerHTML = `
          <strong>SOLAR:</strong> ${data.solar.toFixed(2)} kW<br>
          <strong>CONSUME:</strong> ${data.consumer.toFixed(2)} kW<br>
          <strong>NET:</strong> ${(data.solar - data.consumer).toFixed(2)} kW
        `;
      }
    });

    container.addEventListener('mouseleave', () => {
      scanLine.style.display = 'none';
      tooltip.style.display = 'none';
    });
  }
}

export default LukasDiagnosticsHub;
