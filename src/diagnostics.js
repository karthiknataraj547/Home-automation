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
    
    // Virtualized logs config
    this.logs = [];
    this.maxLogs = 500;
    this.lineHeight = 18;
    this.scrollSpacer = null;
    this.visibleContent = null;
    
    this.initEnergyHistory();
  }

  // Set up gauges with initial values
  initGauges() {
    // Parse existing lines in container on load
    const container = document.getElementById('terminalLogContainer');
    if (container) {
      const existingLines = container.querySelectorAll('.terminal-line');
      existingLines.forEach(line => {
        const text = line.textContent.replace(/^>\s*/, '').replace(/_$/, '').trim();
        let type = 'normal';
        if (line.classList.contains('info')) type = 'info';
        else if (line.classList.contains('warn')) type = 'warn';
        else if (line.classList.contains('error')) type = 'error';
        this.logs.push({ text, type, isTyping: false });
      });
      container.innerHTML = '';
      
      this.setupVirtualDOM(container);
      this.renderVirtualLogs();
    }

    // Bind terminal control events
    const filterSelect = document.getElementById('terminalFilter');
    if (filterSelect) {
      filterSelect.addEventListener('change', () => {
        this.renderVirtualLogs();
      });
    }

    const exportBtn = document.getElementById('terminalExportCSV');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.exportLogsToCSV();
      });
    }

    this.updateGauge('cpu', this.metrics.cpu);
    this.updateGauge('ram', this.metrics.ram);
    this.updateGauge('temp', this.metrics.temp);
    this.updateGauge('security', this.metrics.security);

    // Continuous subtle metric fluctuations
    setInterval(() => {
      this.fluctuateMetrics();
    }, 3000);
  }

  setupVirtualDOM(container) {
    container.style.position = 'relative';
    container.style.overflowY = 'auto';
    
    // Create scroll spacer
    this.scrollSpacer = document.createElement('div');
    this.scrollSpacer.className = 'terminal-scroll-spacer';
    this.scrollSpacer.style.height = '0px';
    this.scrollSpacer.style.position = 'relative';
    this.scrollSpacer.style.width = '100%';
    
    // Create visible content container
    this.visibleContent = document.createElement('div');
    this.visibleContent.className = 'terminal-visible-content';
    this.visibleContent.style.position = 'absolute';
    this.visibleContent.style.top = '0';
    this.visibleContent.style.left = '0';
    this.visibleContent.style.right = '0';
    
    this.scrollSpacer.appendChild(this.visibleContent);
    container.appendChild(this.scrollSpacer);
    
    container.addEventListener('scroll', () => {
      this.renderVirtualLogs();
    });
  }

  renderVirtualLogs() {
    const container = document.getElementById('terminalLogContainer');
    if (!container || !this.visibleContent || !this.scrollSpacer) return;

    // Get selected filter value
    const filterSelect = document.getElementById('terminalFilter');
    const filter = filterSelect ? filterSelect.value : 'all';

    // Filter the logs — supports severity filters ('info', 'warn', 'error')
    // and agent-namespace filters ('agent:supervisor', 'agent:master', etc.)
    let filteredLogs;
    if (filter === 'all') {
      filteredLogs = this.logs;
    } else if (filter.startsWith('agent:')) {
      const agentTag = filter.slice(6); // e.g. 'supervisor'
      filteredLogs = this.logs.filter(log => log.agent === agentTag);
    } else {
      filteredLogs = this.logs.filter(log => log.type === filter);
    }

    const totalHeight = filteredLogs.length * this.lineHeight;
    this.scrollSpacer.style.height = `${totalHeight}px`;

    const containerHeight = container.clientHeight || 200;
    const scrollTop = container.scrollTop;

    let startIndex = Math.floor(scrollTop / this.lineHeight);
    let endIndex = Math.ceil((scrollTop + containerHeight) / this.lineHeight);

    // Buffer visible area slightly to prevent clipping during scroll
    startIndex = Math.max(0, startIndex - 2);
    endIndex = Math.min(filteredLogs.length, endIndex + 2);

    this.visibleContent.innerHTML = '';
    this.visibleContent.style.transform = `translateY(${startIndex * this.lineHeight}px)`;

    for (let i = startIndex; i < endIndex; i++) {
      const log = filteredLogs[i];
      const line = document.createElement('div');
      line.className = `terminal-line ${log.type || 'normal'}`;
      line.style.height = `${this.lineHeight}px`;
      line.style.display = 'flex';
      line.style.alignItems = 'center';

      // Prompt symbol
      const prompt = document.createElement('span');
      prompt.className = 'terminal-prompt';
      prompt.innerHTML = '&gt; ';
      line.appendChild(prompt);

      // Text content
      const textNode = document.createElement('span');
      textNode.textContent = log.text;
      line.appendChild(textNode);

      // If it is the last item and is currently typing (or if it is the very last item in the console), show the blinking cursor
      if (i === filteredLogs.length - 1) {
        const cursor = document.createElement('span');
        cursor.className = 'terminal-cursor';
        line.appendChild(cursor);
      }

      this.visibleContent.appendChild(line);
    }
  }

  exportLogsToCSV() {
    try {
      const csvRows = [
        ['Timestamp', 'Severity', 'Agent', 'Log Message']
      ];
      
      this.logs.forEach(log => {
        const timestamp = new Date().toISOString();
        csvRows.push([timestamp, log.type.toUpperCase(), log.agent || '', log.text]);
      });
      
      const csvContent = "data:text/csv;charset=utf-8," 
        + csvRows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
        
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `lukas_diagnostics_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log("[Diagnostics] CSV Export completed.");
    } catch (e) {
      console.error("[Diagnostics] CSV Export failed:", e);
    }
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
  // @param {string} text - Log message
  // @param {string} type - 'normal' | 'info' | 'warn' | 'error'
  // @param {string} agent - Optional agent tag, e.g. 'supervisor', 'master', 'planner'
  logToTerminal(text, type = 'normal', agent = '') {
    const container = document.getElementById('terminalLogContainer');
    if (!container) return;

    // Create a new log entry
    const newEntry = { text: "", type, agent, targetText: text, isTyping: true };
    this.logs.push(newEntry);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Typewriter animation on the array entry
    let index = 0;
    const typeSpeed = 15;

    const typeWriter = () => {
      if (index < text.length) {
        newEntry.text += text.charAt(index);
        index++;
        this.renderVirtualLogs();
        container.scrollTop = container.scrollHeight;
        setTimeout(typeWriter, typeSpeed);
      } else {
        newEntry.isTyping = false;
        this.renderVirtualLogs();
        container.scrollTop = container.scrollHeight;
      }
    };

    typeWriter();
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
