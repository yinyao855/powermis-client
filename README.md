# PowerMIS PDF阅读器

这是一个基于Electron的PDF阅读器应用，专门为PowerMIS系统设计。

## 功能特性

- 🔒 **安全阅读**: PDF文件在内存中解密，用户无法直接保存文件
- 🖨️ **打印支持**: 支持PDF打印功能
- 📱 **现代化界面**: 基于Vue 3和Electron的现代化界面
- 🔍 **PDF.js集成**: 使用pdf.js提供强大的PDF渲染能力

## 安装和运行

### 前置要求

- Node.js 20+
- npm 或 yarn

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建应用

```bash
# 构建所有平台
npm run build

# 构建特定平台
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

## 使用说明

1. **启动应用**: 运行 `npm run dev` 启动开发模式
2. **等待请求**: 应用启动后会显示"等待PDF阅读请求..."
3. **从前端调用**: 在PowerMIS前端中点击PDF阅读按钮
4. **自动处理**: 应用会自动下载、解密并显示PDF文件

## 技术架构

### 主要组件

- **主进程** (`src/main/index.js`): 处理窗口创建、IPC通信、PDF下载和解密
- **渲染进程** (`src/renderer/`): Vue应用，包含PDF阅读器界面
- **预加载脚本** (`src/preload/index.js`): 暴露安全的API给渲染进程
- **解密模块** (`src/main/decrypt.js`): 实现与后端AESUtil.java相同的解密逻辑

### 安全特性

- PDF文件在内存中解密，不保存到磁盘
- 使用与后端相同的AES-128-ECB加密算法
- 支持打印但禁止下载/另存为
- 窗口关闭时自动清理内存中的PDF数据

### 与前端集成

前端通过以下方式调用PDF阅读器：

```javascript
// 在PowerMIS前端中
window.postMessage({
  type: 'open-pdf',
  id: articleId,
  type: articleType,
  name: articleName,
  backendUrl: backendUrl
}, '*')
```

## 文件结构

```
powermis-client/
├── src/
│   ├── main/
│   │   ├── index.js          # 主进程
│   │   └── decrypt.js        # PDF解密模块
│   ├── preload/
│   │   └── index.js          # 预加载脚本
│   └── renderer/
│       ├── src/
│       │   ├── components/
│       │   │   └── PdfReader.vue # PDF阅读器
│       │   ├── router/
│       │   │   └── index.js      # 路由配置
│       │   ├── App.vue           # 主应用
│       │   └── main.js           # 渲染进程入口
│       └── index.html
├── package.json                  # 项目配置
└── README.md                     # 详细文档
```

## 故障排除

### 常见问题

1. **PDF加载失败**
   - 检查后端API是否正常运行
   - 确认网络连接正常
   - 查看控制台错误信息

2. **解密失败**
   - 确认fileKey是否正确
   - 检查PDF文件是否已正确加密

3. **应用无法启动**
   - 确认Node.js版本符合要求
   - 重新安装依赖: `npm install`

### 调试

开发模式下按F12打开开发者工具查看详细错误信息。

## 许可证

本项目遵循MIT许可证。
