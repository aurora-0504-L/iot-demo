# Express 数据可视化网页界面实施计划

## 仓库调研结论

**当前状态：**
- `publisher.js`：连接 MQTT Broker，每 2 秒模拟发送一条传感器数据（deviceId、ts、temperature、humidity），纯终端输出，无数据留存
- `subscriber.js`：订阅同一 topic 打印消息
- `package.json`：依赖 `mqtt@^5.16.1` + `dotenv@^18.0.8`，CommonJS 模块
- 无 Web 服务、无数据存储、无前端页面

**关键设计决策：** 需要在 publisher 发送数据的同时，将数据缓存到内存中供 Express API 查询，并通过 WebSocket 实时推送到前端，实现真正的"可视化"。

---

## 文件与模块变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 新增 `express`、`ws` 依赖；新增 `start` 脚本 |
| `publisher.js` | 重构 | 整合 Express 服务 + MQTT 发布 + 数据缓存 + WebSocket 推送 |
| `public/index.html` | 新建 | 可视化仪表盘页面（ECharts 实时折线图 + 最新数据卡片） |
| `public/app.js` | 新建 | 前端逻辑：WebSocket 接入 + 图表更新 + 数据显示 |
| `public/style.css` | 新建 | 仪表盘样式（暗色科技风） |

---

## 实施步骤

### 1. 安装依赖
```
npm install express ws
```

### 2. 重构 `publisher.js`
单一入口整合四个职责：
- **MQTT 发布**（保留原逻辑，每 2 秒生成一条模拟传感器数据）
- **内存环形缓冲区**：用数组缓存最近 200 条数据，超过上限 `shift()` 丢弃旧数据
- **Express 服务器**（端口默认 `3000`，可通过 `WEB_PORT` 环境变量配置）：
  - `GET /` → 返回 `public/index.html`
  - `GET /api/data` → 返回当前缓冲区所有数据（JSON）
  - `GET /api/latest` → 返回最新一条数据（JSON）
  - 静态文件托管 `public/` 目录
- **WebSocket 服务器**： Express 启动后在同端口挂载 `ws`，客户端连接后，每当新数据生成时通过 WebSocket 广播 `JSON.stringify(data)`

### 3. 创建前端页面 `public/index.html`
- 顶部标题栏："IoT 传感器数据仪表盘" + 当前 MQTT 连接状态指示器
- 数据卡片区：展示最新温度、湿度、设备 ID、时间戳（大字号 + 实时刷新）
- 图表区：使用 ECharts（通过 CDN 引入 `echarts.min.js`），两个折线图：
  - 温度趋势（Y 轴 15-30℃，红色曲线）
  - 湿度趋势（Y 轴 35-55%，蓝色曲线）
- 连接状态提示（WebSocket 断开时显示重连中）

### 4. 创建前端逻辑 `public/app.js`
- DOMContentLoaded 后初始化 ECharts 实例
- 建立 WebSocket 连接（`ws://${location.host}`）
- 收到消息时：
  - 更新最新数据卡片
  - 调用 `chart.appendData()`（增量更新，不重绘）
  - 维护前端数据长度限制（与后端一致，保留 200 点）
- 断线自动重连（3 秒间隔 + 指数退避）
- 页面加载时先通过 `GET /api/data` 获取历史数据填充图表

### 5. 创建样式 `public/style.css`
- CSS Grid 布局：卡片一行、图表一行，响应式
- 暗色主题（深色背景 + 亮色数据），适合监控大屏
- 温度卡片红色系、湿度卡片蓝色系区分

### 6. 更新 `package.json`
- 新增 `start` 脚本：`node publisher.js`
- 新增依赖 `express` 和 `ws`

---

## 依赖与注意事项

- **express**（最新稳定版）：Web 框架，端口可通过 `WEB_PORT` 环境变量覆盖
- **ws**（最新稳定版）：WebSocket 实现，比原生 `net` 更方便与 Express 集成
- **ECharts**：通过 CDN（`https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js`）在前端引入，无需 npm 包
- **单一进程**：publisher.js 既是 MQTT 客户端又是 Web 服务器，简化部署，一条命令启动全部
- **数据缓存策略**：内存环形缓冲区（固定 200 条），进程重启即清空——对于"可视化演示"场景足够，无需引入数据库
- **MQTT Broker 依赖**：publisher.js 仍需要 MQTT Broker 运行（如 Eclipse Mosquitto），否则会在 connect 阶段报错；但 Express 和 WebSocket 服务仍可正常启动并显示历史数据（只是不会有新数据涌入）
- **`.env` 文件**：新增可选变量 `WEB_PORT=3000`

---

## 验证

| 验证项 | 方法 |
|--------|------|
| 依赖安装 | `npm install` 无报错 |
| 服务启动 | `node publisher.js` 同时输出 `[PUB] Connected` 和 `[WEB] Server listening on :3000` |
| REST API | `curl http://localhost:3000/api/latest` 返回 JSON |
| 静态页面 | 浏览器打开 `http://localhost:3000/` 看到仪表盘 |
| 实时更新 | 观察温度/湿度折线图每 2 秒新增一个数据点，数据卡片同步刷新 |
| MQTT 兼容 | `node subscriber.js` 同时运行仍能正常订阅到消息 |
| 断线重连 | 关闭 MQTT Broker 后 Web 服务不崩溃，图表停止新增数据但页面仍可访问 |

---

## 风险

| 风险 | 处理方案 |
|------|----------|
| 用户本地无 MQTT Broker，publisher 连接失败导致整个进程提前退出 | 在 MQTT connect 失败时不阻塞 Express 启动；MQTT 事件监听增加 `reconnectPeriod`（复用 subscriber.js 的做法）；Express 独立启动，WebSocket 可以等 MQTT 恢复后继续推送 |
| ws 与 Express 同端口挂载方式易出错 | 使用 `new ws.Server({ server })` 挂载到 Express 的 HTTP server 实例，而非单独 listen |
| 大数据量前端图表卡顿 | 前后端均限制缓存 200 条；前端使用 ECharts `appendData` 增量更新而非 `setOption` 全量重绘 |
| `.env` 缺少 WEB_PORT 配置导致启动地址不一致 | 默认端口 3000，README/日志中明确打印访问地址 |
