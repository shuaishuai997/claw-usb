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
    this.deviceApprovalTimer = null;
  }

  getResourcesPath() {
    // if (process.resourcesPath) {
    //   return process.resourcesPath;
    // }
    return path.join(__dirname, '../resources');
  }

  getConfigDir() {
    // 配置文件目录：项目根目录下的 config/
    return path.join(this.getResourcesPath(), '..', 'config');
  }

  getNodePath() {
   return path.join(this.getResourcesPath(), '/node/node.exe');
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
      try {
        this.logCallback(logMessage);
      } catch (e) {
      }
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
          
          this.startDeviceApprovalWatcher();
          
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
    this.log('正在停止 OpenClaw 服务...');

    const killProcess = (pid, label = '') => {
      if (!pid) return;
      try {
        const result = require('child_process').execSync(
          `taskkill /pid ${pid} /f /t 2>&1`,
          { stdio: 'pipe' }
        ).toString();
        this.log(`Taskkill ${label}(PID ${pid}): ${result}`);
      } catch (e) {
        this.log(`Taskkill ${label}(PID ${pid}) 失败: ${e.message}`, 'warn');
      }
    };

    const killProcessTree = (pid, label = '') => {
      if (!pid) return;
      try {
        const result = require('child_process').execSync(
          `wmic process where parentprocessid=${pid} call terminate 2>&1`,
          { stdio: 'pipe' }
        ).toString();
        this.log(`WMIC 杀子进程 ${label}(PID ${pid}): ${result}`);
      } catch (e) {
      }
      killProcess(pid, label);
    };

    // 1. 杀掉当前管理的进程（包括子进程树）
    if (this.process && this.process.pid) {
      killProcessTree(this.process.pid, 'main');
    }

    // 2. 检查端口占用并清理（只杀 LISTENING 状态的，包括子进程）
    try {
      const port = this.port || '18789';
      const netstat = require('child_process').execSync(
        `netstat -ano | findstr :${port}`,
        { stdio: 'pipe' }
      ).toString();
      
      const lines = netstat.split('\n');
      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const match = line.match(/\s+(\d+)$/);
          if (match) {
            const pid = match[1];
            this.log(`检测到端口 ${port} 被 PID ${pid} 占用，正在清理...`);
            killProcessTree(pid, 'port');
          }
        }
      }
    } catch (e) {
      this.log('端口未被占用');
    }

    // 3. 额外检查：杀掉所有 openclaw 相关的 node 进程
    try {
      const tasklist = require('child_process').execSync(
        `tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH`,
        { stdio: 'pipe' }
      ).toString();
      
      const processes = tasklist.split('\n');
      for (const proc of processes) {
        const pidMatch = proc.match(/"(\d+)"/);
        if (pidMatch) {
          const pid = pidMatch[1];
          try {
            const cmdline = require('child_process').execSync(
              `wmic process where processid=${pid} get commandline 2>&1`,
              { stdio: 'pipe' }
            ).toString();
            
            if (cmdline.includes('openclaw') || cmdline.includes('gateway')) {
              this.log(`清理 openclaw 相关进程 PID ${pid}`);
              killProcessTree(pid, 'openclaw');
            }
          } catch (e) {
          }
        }
      }
    } catch (e) {
    }

    this.process = null;
    this.isRunning = false;
    this.port = null;

    this.stopDeviceApprovalWatcher();

    if (this.stopCallback) {
      this.stopCallback();
    }

    this.log('OpenClaw 服务已停止');
    return { success: true };
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
        '--skip-health',
        '--workspace', path.join(this.getConfigDir(), 'workspace')
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

  listPendingDevices() {
    return new Promise((resolve) => {
      const child = spawn(this.getNodePath(), [this.getOpenclawPath(), 'devices', 'list'], {
        cwd: path.dirname(this.getOpenclawPath()),
        env: this.getEnv(),
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ devices: [] });
      }, 30000);

      child.on('close', () => {
        clearTimeout(timer);
        try {
          const combined = stdout.trim() || stderr.trim();
          const parsed = JSON.parse(combined);
          if (Array.isArray(parsed)) {
            const devices = parsed.map((item) => ({
              id: String(item.id || ''),
              name: typeof item.name === 'string' ? item.name : undefined
            })).filter((d) => d.id);
            resolve({ devices });
          } else {
            resolve({ devices: [] });
          }
        } catch {
          resolve({ devices: [] });
        }
      });

      child.on('error', () => {
        clearTimeout(timer);
        resolve({ devices: [] });
      });
    });
  }

  approveDevice(deviceId) {
    return new Promise((resolve) => {
      const trimmed = deviceId.trim();
      if (!trimmed) {
        resolve({ ok: false, message: '设备ID不能为空' });
        return;
      }

      const child = spawn(this.getNodePath(), [this.getOpenclawPath(), 'devices', 'approve', trimmed], {
        cwd: path.dirname(this.getOpenclawPath()),
        env: this.getEnv(),
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ ok: false, message: '设备授权超时' });
      }, 30000);

      child.on('close', (code) => {
        clearTimeout(timer);
        const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
        resolve({
          ok: code === 0,
          message: combined || undefined
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, message: err.message });
      });
    });
  }

  async autoApprovePendingDevices() {
    try {
      const { devices } = await this.listPendingDevices();
      if (devices.length === 0) {
        return;
      }

      this.log(`检测到 ${devices.length} 个待配对设备`);
      for (const device of devices) {
        this.log(`正在自动授权设备: ${device.id}${device.name ? ` (${device.name})` : ''}`);
        const result = await this.approveDevice(device.id);
        if (result.ok) {
          this.log(`设备授权成功: ${device.id}`);
          if (this.deviceApprovalTimer) {
            clearInterval(this.deviceApprovalTimer);
            this.deviceApprovalTimer = null;
            this.log('设备授权监听器已停止 - 所有设备已授权');
          }
        } else {
          this.log(`设备授权失败 ${device.id}: ${result.message || '未知错误'}`, 'error');
        }
      }
    } catch (err) {
      this.log(`设备自动授权过程中出错: ${err.message}`, 'error');
    }
  }

  startDeviceApprovalWatcher() {
    if (this.deviceApprovalTimer) return;
    this.log('启动设备授权监听器');
    this.autoApprovePendingDevices();
    this.deviceApprovalTimer = setInterval(() => {
      this.autoApprovePendingDevices();
    }, 5000);
  }

  stopDeviceApprovalWatcher() {
    if (this.deviceApprovalTimer) {
      clearInterval(this.deviceApprovalTimer);
      this.deviceApprovalTimer = null;
      this.log('设备授权监听器已停止');
    }
  }
}

module.exports = ServiceManager;
