# OpenClaw U盘版

基于 Electron 开发的 OpenClaw 便携式桌面管理工具，免安装，配置数据存储在 U 盘上。

## 功能特性

- 许可证激活管理
- 一键初始化 OpenClaw 环境
- 服务启动/停止控制
- API 配置（支持 DeepSeek 等 provider）
- 控制面板快捷访问
- 免安装便携式设计

## 系统要求

- Windows 10 及以上版本
- 管理员权限（用于系统服务管理）

## 目录结构

```
claw-usb/
├── main.js              # Electron 主进程
├── index.html           # 界面渲染
├── package.json         # 项目配置
├── electron-builder.json # 打包配置
├── services/
│   ├── serviceManager.js   # 服务管理
│   ├── configManager.js    # 配置管理
│   └── licenseManager.js   # 许可证管理
└── config/              # 配置文件目录（运行时生成）
```

## 开发

```bash
# 安装依赖
npm install

# 启动开发模式
npm start

# 打包
npm run build
```

## 构建

```bash
# 构建 Windows 版本
npm run build:win
```

构建完成后，可执行文件位于 `dist/` 目录。

## 使用流程

1. 双击运行 `OpenClaw U盘版.exe`
2. 输入许可证密钥进行激活
3. 点击"一键初始化"配置 OpenClaw 环境
4. 配置 API Provider（默认 DeepSeek）
5. 点击"启动服务"开始使用

## 配置文件

- `config/openclaw.json` - OpenClaw 主配置
- `config.json` - 应用程序配置
- `config/agents/` - Agent 配置
- `config/tasks/` - 任务记录
