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
      return path.join(__dirname, '../resources');
    }
    return path.join(__dirname, '../');
  }

  getNodePath() {
    return path.join(this.getResourcesPath(), '/node/node.exe');
  }

  getOpenclawPath() {
    return path.join(this.getResourcesPath(), '/openclaw/openclaw.mjs');
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

      this.log('正在启动 OpenClaw 服务...');

      const args = [this.getOpenclawPath(), 'gateway', 'run'];
      
      this.log(`启动命令: ${this.getNodePath()} ${args.join(' ')}`);

      this.process = spawn(this.getNodePath(), args, {
        cwd: path.dirname(this.getOpenclawPath()),
        env: {
          ...process.env,
          NODE_ENV: 'production'
        }
      });

      this.process.on('error', (err) => {
        this.log(`服务启动失败: ${err.message}`, 'error');
        this.isRunning = false;
        this.process = null;
        if (this.errorCallback) {
          this.errorCallback(err.message);
        }
        reject(err);
      });

      this.process.on('exit', (code) => {
        if (this.isRunning) {
          this.log(`服务异常退出，退出码: ${code}`, 'error');
          this.isRunning = false;
          this.process = null;
          if (this.errorCallback) {
            this.errorCallback(`服务异常退出，退出码: ${code}`);
          }
        }
      });

      this.process.stdout.on('data', (data) => {
        const output = data.toString('utf-8').trim();
        if (output) {
          this.log(output);
        }
      });

      this.process.stderr.on('data', (data) => {
        const output = data.toString('utf-8').trim();
        if (output) {
          this.log(output, 'error');
        }
      });

      // 轮询检测服务是否启动成功
      const checkInterval = setInterval(async () => {
        const status = await this.checkGatewayStatus();
        if (status.isRunning) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          this.port = status.port;
          this.isRunning = true;
          this.log(`服务已启动，端口: ${this.port}`);
          if (this.startCallback) {
            this.startCallback({ port: this.port, pid: status.pid });
          }
          resolve({ port: this.port, pid: status.pid });
        }
      }, 1000);

      // 30秒超时
      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        this.log('服务启动超时', 'error');
        if (this.errorCallback) {
          this.errorCallback('服务启动超时');
        }
        reject(new Error('服务启动超时'));
      }, 30000);
    });
  }

  async killProcessTree(pid) {
    return new Promise((resolve) => {
      // Windows 下用 taskkill 杀进程树
      const killProcess = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], {
        windowsHide: true
      });
      
      killProcess.on('exit', () => resolve());
      killProcess.on('error', () => resolve());
      
      // 超时保护
      setTimeout(() => {
        try { killProcess.kill(); } catch {}
        resolve();
      }, 5000);
    });
  }

  stop() {
    return new Promise(async (resolve) => {
      if (!this.isRunning || !this.process) {
        resolve();
        return;
      }

      this.log('正在停止 OpenClaw 服务...');

      const pid = this.process.pid;
      
      // 先用 taskkill 杀进程树（包括所有子进程）
      if (pid) {
        await this.killProcessTree(pid);
      }

      // 确保进程已停止
      if (this.process) {
        try {
          this.process.kill('SIGTERM');
        } catch (err) {
          // ignore
        }
      }

      this.log('服务已停止');
      this.isRunning = false;
      this.process = null;
      this.port = null;
      if (this.stopCallback) {
        this.stopCallback();
      }
      resolve();
    });
  }

  async checkGatewayStatus() {
    return new Promise((resolve) => {
      const args = [this.getOpenclawPath(), 'gateway', 'status', '--json'];
      
      const checkProcess = spawn(this.getNodePath(), args, {
        cwd: path.dirname(this.getOpenclawPath()),
        env: { ...process.env, NODE_ENV: 'production' }
      });
      
      let output = '';
      
      checkProcess.stdout.on('data', (data) => {
        output += data.toString('utf-8');
      });
      
      checkProcess.stderr.on('data', () => {});
      
      checkProcess.on('exit', (code) => {
        if (code === 0 && output) {
          try {
            const status = JSON.parse(output);
            resolve({
              isRunning: status.running === true,
              port: status.port || null,
              pid: status.pid || null
            });
          } catch {
            resolve({ isRunning: false, port: null, pid: null });
          }
        } else {
          resolve({ isRunning: false, port: null, pid: null });
        }
      });
      
      checkProcess.on('error', () => {
        resolve({ isRunning: false, port: null, pid: null });
      });
    });
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
        env: {
          ...process.env,
          NODE_ENV: 'production'
        }
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
        env: {
          ...process.env,
          NODE_ENV: 'production'
        },
        detached: true,
        stdio: 'ignore'
      });

      dashboardProcess.unref();
      
      this.log('控制台已启动');
      resolve();
    });
  }
}

module.exports = ServiceManager;
