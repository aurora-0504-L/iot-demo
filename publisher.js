require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const mqtt = require('mqtt');

// ─── 配置 ─────────────────────────────────────────────
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const TOPIC = process.env.TOPIC || 'iot/demo/temperature';
const WEB_PORT = parseInt(process.env.WEB_PORT, 10) || 3000;
const MAX_BUFFER = 200;        // 内存环形缓冲区上限
const PUBLISH_INTERVAL = 2000; // 模拟发布间隔（毫秒）

// ─── 内存数据缓冲区 ────────────────────────────────────
const dataBuffer = [];

function pushToBuffer(sample) {
  dataBuffer.push(sample);
  if (dataBuffer.length > MAX_BUFFER) dataBuffer.shift();
}

// ─── Express + HTTP Server ─────────────────────────────
const app = express();
const server = http.createServer(app);

// 静态文件
app.use(express.static('public'));

// REST API
app.get('/api/data', (_req, res) => {
  res.json(dataBuffer);
});

app.get('/api/latest', (_req, res) => {
  res.json(dataBuffer.length ? dataBuffer[dataBuffer.length - 1] : null);
});

// ─── WebSocket Server（挂载到同一 HTTP server） ────────
const wss = new WebSocketServer({ server });

function broadcast(sample) {
  const payload = JSON.stringify(sample);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected. Total:', wss.clients.size);
  ws.on('close', () => {
    console.log('[WS] Client disconnected. Total:', wss.clients.size);
  });
});

// ─── HTTP 启动 ─────────────────────────────────────────
server.listen(WEB_PORT, () => {
  console.log(`[WEB] Dashboard running at http://localhost:${WEB_PORT}`);
});

// ─── MQTT Publisher ────────────────────────────────────
const client = mqtt.connect(MQTT_URL, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  reconnectPeriod: 3000,
});

let mqttConnected = false;

client.on('connect', () => {
  mqttConnected = true;
  console.log('[PUB] Connected:', MQTT_URL);
  startPublishing();
});

client.on('reconnect', () => {
  mqttConnected = false;
  console.log('[PUB] Reconnecting to', MQTT_URL);
});

client.on('close', () => {
  mqttConnected = false;
});

client.on('error', (err) => {
  console.error('[PUB] Error:', err.message);
});

let publishTimer = null;

function startPublishing() {
  if (publishTimer) clearInterval(publishTimer);

  publishTimer = setInterval(() => {
    const sample = {
      deviceId: 'sensor-001',
      ts: Date.now(),
      temperature: parseFloat((20 + Math.random() * 5).toFixed(2)),
      humidity: parseFloat((40 + Math.random() * 10).toFixed(2)),
    };

    const payload = JSON.stringify(sample);

    client.publish(TOPIC, payload, { qos: 0 }, (err) => {
      if (err) {
        console.error('[PUB] Publish error:', err.message);
      } else {
        pushToBuffer(sample); // 无论 MQTT 是否成功，都缓存并推送
        broadcast(sample);
        console.log('[PUB] Sent:', payload);
      }
    });
  }, PUBLISH_INTERVAL);
}
