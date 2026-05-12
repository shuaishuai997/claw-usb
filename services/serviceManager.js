const { spawn } = require('child_process');
const path = require('path');

class ServiceManager {
  constructor() {
    this.process = null;
    this.isRunning = false;
    this.logCallback = null;
    this.port = null;
    this.startCallback = null;
    this.errorCallback = null;
    this.stopCallback = null;
  }

  getResourcesPath() {
    if (process.resourcesPath) {
      return process.resourcesPath;
    }
    return path.join(__dirname, '../resources');
  }

  getConfigDir() {
    // 配置文件目录：项目根目录下的 config/
    return path.join(this.getResourcesPath(), '..', 'config');
  }

  getNodePath() {
    // 用系统 node
    return 'node';
  }

  getOpenclawPath() {
    return path.join(this.getResourcesPath(), '/openclaw/openclaw.mjs');
  }

  getEnv() {
    return {
      ...process.env,
      NODE_ENV: 'production',
      OPENCLAW_STATE_DIR: this.getConfigDir()
    };
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

  async start() {
    if (this.isRunning) {
      throw new Error('服务已经在运行中');
    }

    return new Promise((resolve, reject) => {
      this.log('正在启动 OpenClaw 服务...');

      const args = [
        this.getOpenclawPath(),
        'gateway',
        'run',
        '--port', '18789'
      ];

      this.log(`启动命令: ${this.getNodePath()} ${args.join(' ')}`);

      this.process = spawn(this.getNodePath(), args, {
        cwd: path.dirname(this.getOpenclawPath()),
        env: this.getEnv(),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.process.unref();

      let output = '';
      let detectedPort = null;

      this.process.stdout.on('data', (data) => {
        const text = data.toString('utf-8');
        output += text;
        this.log(text.trim());
        
        const portMatch = text.match(/http:\/\/.*:(\d+)/);
        if (portMatch) {
          detectedPort = portMatch[1];
        }
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString('utf-8');
        output += text;
        this.log(text.trim(), 'error');
      });

      this.process.on('error', (err) => {
        this.log(`启动失败: ${err.message}`, 'error');
        reject(err);
      });

      setTimeout(() => {
        if (this.process && this.process.pid) {
          this.isRunning = true;
          this.port = detectedPort || '18789';
          const pid = this.process.pid;
          
          this.log(`OpenClaw 服务已启动 (PID: ${pid}, 端口: ${this.port})`);
          
          if (this.startCallback) {
            this.startCallback({
              pid: pid,
              port: this.port
            });
          }
          
          resolve({
            success: true,
            pid: pid,
            port: this.port
          });
        } else {
          reject(new Error('服务启动失败，未获取到 PID'));
        }
      }, 3000);
    });
  }

  async stop() {
    if (!this.isRunning || !this.process) {
      this.log('服务未运行');
      return { success: true };
    }

    return new Promise((resolve) => {
      this.log('正在停止 OpenClaw 服务...');

      if (this.process && this.process.pid) {
        try {
          const result = require('child_process').execSync(
            `taskkill /pid ${this.process.pid} /f /t 2>&1`,
            { stdio: 'pipe' }
          ).toString();
          this.log(`Taskkill 结果: ${result}`);
        } catch (e) {
          this.log(`Taskkill 失败: ${e.message}`, 'warn');
        }
      }

      // 额外检查端口占用并清理
      try {
        const port = this.port || '18789';
        const netstat = require('child_process').execSync(
          `netstat -ano | findstr :${port}`,
          { stdio: 'pipe' }
        ).toString();
        
        const lines = netstat.split('\n');
        for (const line of lines) {
          const match = line.match(/\s+(\d+)$/);
          if (match) {
            const pid = match[1];
            this.log(`检测到端口 ${port} 被 PID ${pid} 占用，正在清理...`);
            try {
              require('child_process').execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'pipe' });
            } catch (e) {
              // 忽略错误
            }
          }
        }
      } catch (e) {
        // 端口未被占用
      }

      this.process = null;
      this.isRunning = false;
      this.port = null;

      if (this.stopCallback) {
        this.stopCallback();
      }

      this.log('OpenClaw 服务已停止');
      resolve({ success: true });
    });
  }

  async checkGatewayStatus() {
    const defaultPort = '18789';
    
    try {
      const netstat = require('child_process').execSync(
        `netstat -ano | findstr :${defaultPort}`,
        { stdio: 'pipe' }
      ).toString();
      
      const lines = netstat.split('\n');
      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const match = line.match(/\s+(\d+)$/);
          if (match) {
            const pid = match[1];
            this.log(`检测到 OpenClaw 运行中 (PID: ${pid}, 端口: ${defaultPort})`);
            this.isRunning = true;
            this.port = defaultPort;
            return { isRunning: true, port: defaultPort, pid: pid };
          }
        }
      }
    } catch (e) {
      // 端口未被占用
    }
    
    this.isRunning = false;
    this.port = null;
    return { isRunning: false, port: null, pid: null };
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      port: this.port
    };
  }

  async refreshStatus() {
    const status = await this.checkGatewayStatus();
    this.isRunning = status.isRunning;
    this.port = status.port;
    return status;
  }

  async isSetupNeeded() {
    const fs = require('fs');
    
    // 检查项目配置目录下的 openclaw.json 是否存在
    const configDir = this.getConfigDir();
    const configFile = path.join(configDir, 'openclaw.json');
    
    // 如果配置文件存在，认为已经初始化过
    if (fs.existsSync(configFile)) {
      return false;
    }
    
    return true;
  }

  setup() {
    return new Promise((resolve, reject) => {
      this.log('正在执行一键初始化...');
      
      const args = [
        this.getOpenclawPath(), 
        'onboard', 
        '--non-interactive', 
        '--mode', 'local', 
        '--accept-risk', 
        '--skip-daemon', 
        '--skip-skills', 
        '--skip-health'
      ];

      this.log(`初始化命令: ${this.getNodePath()} ${args.join(' ')}`);

      const setupProcess = spawn(this.getNodePath(), args, {
        cwd: path.dirname(this.getOpenclawPath()),
        env: this.getEnv()
      });

      let output = '';

      setupProcess.on('error', (err) => {
        this.log(`初始化失败: ${err.message}`, 'error');
        reject(err);
      });

      setupProcess.stdout.on('data', (data) => {
        output += data.toString('utf-8');
        this.log(data.toString('utf-8').trim());
      });

      setupProcess.stderr.on('data', (data) => {
        output += data.toString('utf-8');
        this.log(data.toString('utf-8').trim(), 'error');
      });

      setupProcess.on('exit', (code) => {
        if (code === 0) {
          this.log('一键初始化完成');
          resolve(output);
        } else {
          this.log(`初始化失败，退出码: ${code}`, 'error');
          reject(new Error(`初始化失败，退出码: ${code}`));
        }
      });
    });
  }

  openDashboard() {
    return new Promise((resolve, reject) => {
      this.log('正在打开 OpenClaw 控制台...');
      
      const args = [this.getOpenclawPath(), 'dashboard'];

      this.log(`控制台命令: ${this.getNodePath()} ${args.join(' ')}`);

      const dashboardProcess = spawn(this.getNodePath(), args, {
        cwd: path.dirname(this.getOpenclawPath()),
        env: this.getEnv()
      });

      let output = '';

      dashboardProcess.stdout.on('data', (data) => {
        output += data.toString('utf-8');
        this.log(data.toString('utf-8').trim());
      });

      dashboardProcess.stderr.on('data', (data) => {
        output += data.toString('utf-8');
        this.log(data.toString('utf-8').trim(), 'error');
      });

      dashboardProcess.on('exit', (code) => {
        if (code === 0) {
          this.log('控制台已打开');
          resolve();
        } else {
          this.log(`打开控制台失败，退出码: ${code}`, 'error');
          reject(new Error(output || `退出码: ${code}`));
        }
      });

      dashboardProcess.on('error', (err) => {
        this.log(`打开控制台失败: ${err.message}`, 'error');
        reject(err);
      });
    });
  }
}

module.exports = ServiceManager;
