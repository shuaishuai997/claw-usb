const { spawn } = require('child_process');
const path = require('path');

class ServiceManager {
  constructor() {
    this.process = null;
    this.isRunning = false;
    this.logCallback = null;
    this.port = null;
    this.nodePath = path.join(__dirname, '../resources/node/node.exe');
    this.openclawPath = path.join(__dirname, '../resources/openclaw/openclaw.mjs');
    this.startCallback = null;
    this.errorCallback = null;
    this.stopCallback = null;
  }

  setLogCallback(callback) {
    this.logCallback = callback;
  }

  setStartCallback(callback) {
    this.startCallback = callback;
  }

  setErrorCallback(callback) {
    this.errorCallback = callback;
  }

  setStopCallback(callback) {
    this.stopCallback = callback;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
    const logMessage = `[${timestamp}:${type.toUpperCase()}] ${message}`;
    if (this.logCallback) {
      this.logCallback(logMessage);
    }
    console.log(logMessage);
  }

  start() {
    return new Promise((resolve, reject) => {
      if (this.isRunning) {
        reject(new Error('服务已在运行中'));
        return;
      }

      this.port = null;
      this.log('正在启动 OpenClaw 服务...');
      this.log(`Node 路径: ${this.nodePath}`);
      this.log(`OpenClaw 路径: ${this.openclawPath}`);
      
      const args = [this.openclawPath, 'gateway'];
      
      this.process = spawn(this.nodePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '../resources/openclaw'),
        env: {
          ...process.env,
          PATH: path.dirname(this.nodePath) + ';' + process.env.PATH,
          OPENCLAW_CONFIG_PATH: path.join(__dirname, '../config/openclaw.json'),
          OPENCLAW_STATE_DIR: path.join(__dirname, '../config')
        },
        shell: false
      });

      const startupTimeout = setTimeout(() => {
        if (!this.isRunning && this.process) {
          this.log('服务启动超时', 'error');
          this.process.kill();
          this.process = null;
          this.isRunning = false;
          if (this.errorCallback) {
            this.errorCallback('服务启动超时');
          }
          reject(new Error('服务启动超时'));
        }
      }, 15000);

      this.process.stdout.on('data', (data) => {
        const output = data.toString();
        const lines = output.split('\n');
        lines.forEach(line => {
          const trimmedLine = line.trim();
          if (trimmedLine) {
            this.log(trimmedLine);
            
            const portMatch = trimmedLine.match(/https?:\/\/127\.0\.0\.1:(\d+)/i);
            if (portMatch) {
              this.port = parseInt(portMatch[1]);
              this.log(`检测到服务端口: ${this.port}`);
            }
          }
        });

        if (output.includes('starting HTTP server') || output.includes('host mounted at')) {
          clearTimeout(startupTimeout);
          if (!this.port) {
            this.port = 18789;
          }
          this.isRunning = true;
          this.log('OpenClaw 服务启动成功');
          if (this.startCallback) {
            this.startCallback({ pid: this.process.pid, port: this.port });
          }
          resolve({ pid: this.process.pid, port: this.port });
        }
      });

      this.process.stderr.on('data', (data) => {
        const output = data.toString().trim();
        this.log(output, 'error');
        
        const portMatch = output.match(/port (\d+)/i);
        if (portMatch) {
          this.port = parseInt(portMatch[1]);
        }

        if (output.includes('EADDRINUSE') || output.includes('port is already in use')) {
          clearTimeout(startupTimeout);
          const error = new Error(`端口 ${this.port || '未知'} 已被占用`);
          this.isRunning = false;
          if (this.errorCallback) {
            this.errorCallback(error.message);
          }
          reject(error);
        }
      });

      this.process.on('close', (code) => {
        clearTimeout(startupTimeout);
        const wasRunning = this.isRunning;
        this.isRunning = false;
        this.process = null;
        this.port = null;
        if (code !== 0) {
          this.log(`服务异常退出，退出码: ${code}`, 'error');
          if (wasRunning && this.errorCallback) {
            this.errorCallback(`服务异常退出，退出码: ${code}`);
          }
        } else {
          this.log('服务已停止', 'warn');
          if (this.stopCallback) {
            this.stopCallback();
          }
        }
      });

      this.process.on('error', (error) => {
        clearTimeout(startupTimeout);
        this.log(`启动失败: ${error.message}`, 'error');
        this.isRunning = false;
        this.process = null;
        if (this.errorCallback) {
          this.errorCallback(error.message);
        }
        reject(error);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.isRunning || !this.process) {
        resolve();
        return;
      }

      this.log('正在停止 OpenClaw 服务...');
      
      const killTimeout = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.log('强制终止服务...', 'warn');
          this.process.kill('SIGKILL');
        }
      }, 3000);

      this.process.on('close', () => {
        clearTimeout(killTimeout);
        this.isRunning = false;
        this.process = null;
        this.port = null;
        this.log('OpenClaw 服务已停止');
        if (this.stopCallback) {
          this.stopCallback();
        }
        resolve();
      });

      if (process.platform === 'win32') {
        this.process.kill('SIGINT');
      } else {
        this.process.kill('SIGTERM');
      }
    });
  }

  setup() {
    return new Promise((resolve, reject) => {
      this.log('正在执行一键初始化...');
      
      const args = [this.openclawPath, 'onboard', '--non-interactive', '--mode', 'local', '--accept-risk', '--skip-daemon', '--skip-skills', '--skip-health'];
      
      const setupProcess = spawn(this.nodePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '../resources/openclaw'),
        env: {
          ...process.env,
          PATH: path.dirname(this.nodePath) + ';' + process.env.PATH,
          OPENCLAW_CONFIG_PATH: path.join(__dirname, '../config/openclaw.json'),
          OPENCLAW_STATE_DIR: path.join(__dirname, '../config')
        },
        shell: false
      });

      setupProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        this.log(output);
      });

      setupProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        this.log(output, 'error');
      });

      setupProcess.on('close', (code) => {
        if (code === 0) {
          this.log('一键初始化完成');
          resolve();
        } else {
          this.log(`初始化失败，退出码: ${code}`, 'error');
          reject(new Error(`初始化失败`));
        }
      });

      setupProcess.on('error', (error) => {
        this.log(`初始化失败: ${error.message}`, 'error');
        reject(error);
      });
    });
  }

  openDashboard() {
    return new Promise((resolve, reject) => {
      if (!this.isRunning) {
        reject(new Error('请先启动服务'));
        return;
      }

      this.log('正在打开网页端控制面板...');
      
      const args = [this.openclawPath, 'dashboard'];
      
      const dashboardProcess = spawn(this.nodePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '../resources/openclaw'),
        env: {
          ...process.env,
          PATH: path.dirname(this.nodePath) + ';' + process.env.PATH,
          OPENCLAW_CONFIG_PATH: path.join(__dirname, '../config/openclaw.json'),
          OPENCLAW_STATE_DIR: path.join(__dirname, '../config')
        },
        shell: false,
        detached: true,
        windowsHide: true
      });

      dashboardProcess.on('close', (code) => {
        if (code === 0) {
          this.log('网页端控制面板已打开');
          resolve();
        } else {
          this.log(`打开控制面板失败，退出码: ${code}`, 'error');
          reject(new Error(`打开控制面板失败`));
        }
      });

      dashboardProcess.on('error', (error) => {
        this.log(`打开控制面板失败: ${error.message}`, 'error');
        reject(error);
      });
    });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      pid: this.process ? this.process.pid : null,
      port: this.port
    };
  }

  async isSetupNeeded() {
    const fs = require('fs');
    const configPath = path.join(__dirname, '../config/openclaw.json');
    
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return !config.models || !config.models.providers || Object.keys(config.models.providers).length === 0;
      }
      return true;
    } catch (error) {
      this.log(`检查初始化状态失败: ${error.message}`, 'error');
      return true;
    }
  }
}

module.exports = ServiceManager;