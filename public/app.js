// ─── 配置 ─────────────────────────────────────────────
const MAX_POINTS = 200;
const WS_RECONNECT_BASE = 3000; // ms

// ─── 状态引用 ─────────────────────────────────────────
let tempData = []; // { t: Date, v: number }
let humData = [];

// ─── ECharts 初始化 ───────────────────────────────────
const tempChart = echarts.init(document.getElementById('temp-chart'), null, { renderer: 'canvas' });
const humChart = echarts.init(document.getElementById('hum-chart'), null, { renderer: 'canvas' });

function buildOption(titleText, color, yMin, yMax) {
  return {
    backgroundColor: 'transparent',
    grid: { left: 50, right: 20, top: 30, bottom: 40 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15,23,42,0.9)',
      borderColor: color,
      textStyle: { color: '#e2e8f0' },
    },
    xAxis: {
      type: 'category',
      data: [],
      axisLabel: { color: '#94a3b8' },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      min: yMin,
      max: yMax,
      axisLabel: { color: '#94a3b8' },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: [{
      name: titleText,
      type: 'line',
      smooth: true,
      showSymbol: false,
      lineStyle: { color, width: 2 },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color + 'aa' },
          { offset: 1, color: color + '00' },
        ]),
      },
      data: [],
    }],
  };
}

tempChart.setOption(buildOption('温度', '#f87171', 15, 30));
humChart.setOption(buildOption('湿度', '#60a5fa', 35, 55));

window.addEventListener('resize', () => {
  tempChart.resize();
  humChart.resize();
});

// ─── 更新数据卡片 ──────────────────────────────────────
function updateCards(sample) {
  document.getElementById('temp-value').textContent = sample.temperature.toFixed(2);
  document.getElementById('hum-value').textContent = sample.humidity.toFixed(2);
  document.getElementById('device-value').textContent = sample.deviceId;
  const d = new Date(sample.ts);
  const pad = (n) => n.toString().padStart(2, '0');
  document.getElementById('time-value').textContent =
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pushChartData(sample) {
  const tStr = new Date(sample.ts).toLocaleTimeString();
  tempChart.appendData({ seriesIndex: 0, data: [[tStr, sample.temperature]] });
  humChart.appendData({ seriesIndex: 0, data: [[tStr, sample.humidity]] });

  if (tempChart.getOption().series[0].data.length > MAX_POINTS) {
    // 移除前 1 个点（setOption merge 更新）
    const opt = tempChart.getOption();
    opt.xAxis[0].data.shift();
    opt.series[0].data.shift();
    tempChart.setOption(opt);

    const opt2 = humChart.getOption();
    opt2.xAxis[0].data.shift();
    opt2.series[0].data.shift();
    humChart.setOption(opt2);
  }
}

// ─── 历史数据加载 ──────────────────────────────────────
async function loadHistory() {
  try {
    const res = await fetch('/api/data');
    const arr = await res.json();
    if (!arr.length) return;
    const xs = arr.map((s) => new Date(s.ts).toLocaleTimeString());
    const ts = arr.map((s) => s.temperature);
    const hs = arr.map((s) => s.humidity);

    tempChart.setOption({ xAxis: [{ data: xs }], series: [{ data: ts }] });
    humChart.setOption({ xAxis: [{ data: xs }], series: [{ data: hs }] });

    updateCards(arr[arr.length - 1]);
    setMqttStatus(true);
  } catch (e) {
    console.warn('History load failed:', e.message);
  }
}

// ─── 状态指示器 ────────────────────────────────────────
function setWsStatus(ok) {
  document.getElementById('ws-dot').className = 'dot' + (ok ? ' dot-ok' : ' dot-bad');
  document.getElementById('ws-status').textContent = ok ? '已连接' : '重连中…';
}
function setMqttStatus(ok) {
  document.getElementById('mqtt-dot').className = 'dot dot-mqtt' + (ok ? ' dot-ok' : ' dot-bad');
  document.getElementById('mqtt-status').textContent = ok ? '正常' : '等待数据…';
}

// ─── WebSocket 连接（自动重连） ────────────────────────
let reconnectDelay = WS_RECONNECT_BASE;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = new WebSocket(proto + location.host);

  ws.onopen = () => {
    setWsStatus(true);
    reconnectDelay = WS_RECONNECT_BASE;
  };

  ws.onmessage = (ev) => {
    try {
      const sample = JSON.parse(ev.data);
      updateCards(sample);
      pushChartData(sample);
      setMqttStatus(true);
    } catch (_) {
      /* ignore */
    }
  };

  ws.onclose = () => {
    setWsStatus(false);
    setTimeout(connectWS, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000); // 指数退避上限 15s
  };

  ws.onerror = () => {
    ws.close();
  };
}

// ─── 启动 ─────────────────────────────────────────────
loadHistory();
connectWS();
