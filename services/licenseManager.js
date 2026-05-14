const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

class LicenseManager {
  constructor() {
    this.LICENSE_SECRET = 'openclaw-license-secret-2024';
    this.VERIFY_INTERVAL_MS = 60 * 60 * 1000;
    this.verifyInterval = null;
    this.notifyLicenseInvalid = null;
    this.licenseDir = null;
  }

  getLicensePath() {
    let licensePath;
    
    if (this.licenseDir) {
      licensePath = path.join(this.licenseDir, 'license.json');
    } else if (process.env.APP_DATA_DIR) {
      licensePath = path.join(process.env.APP_DATA_DIR, 'license.json');
    } else {
      const isPackaged = process.env.NODE_ENV === 'production' || 
                         process.versions.electron && !require('electron').app.isPackaged === false;
      
      if (isPackaged && process.versions.electron) {
        const { app } = require('electron');
        licensePath = path.join(app.getPath('userData'), 'license.json');
      } else {
        licensePath = path.join(__dirname, '../license.json');
      }
    }
    
    return licensePath;
  }

  setLicenseDir(dir) {
    this.licenseDir = dir;
  }

  getMachineId() {
    try {
      const { spawnSync } = require('child_process');
      const platform = process.platform;

      if (platform === 'win32') {
        const cpuResult = spawnSync('wmic', ['cpu', 'get', 'ProcessorId'], { encoding: 'utf-8' });
        const cpu = cpuResult.stdout?.split('\n')[1]?.trim() || '';

        const boardResult = spawnSync('wmic', ['baseboard', 'get', 'SerialNumber'], { encoding: 'utf-8' });
        const board = boardResult.stdout?.split('\n')[1]?.trim() || '';

        const diskResult = spawnSync('wmic', ['diskdrive', 'get', 'SerialNumber'], { encoding: 'utf-8' });
        const disk = diskResult.stdout?.split('\n')[1]?.trim() || '';

        const raw = `${cpu}-${board}-${disk}`.replace(/\s/g, '');
        return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
      } else if (platform === 'darwin') {
        const result = spawnSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf-8' });
        const match = result.stdout?.match(/IOPlatformSerialNumber.*"(.+)"/);
        const serial = match ? match[1] : '';
        return crypto.createHash('sha256').update(serial).digest('hex').slice(0, 32);
      } else {
        const result = spawnSync('cat', ['/sys/class/dmi/id/product_uuid'], { encoding: 'utf-8' });
        const uuid = result.stdout?.trim() || '';
        return crypto.createHash('sha256').update(uuid).digest('hex').slice(0, 32);
      }
    } catch {
      const fallbackPath = path.join(this.getLicenseDir(), '.machine-id');
      if (fs.existsSync(fallbackPath)) {
        return fs.readFileSync(fallbackPath, 'utf8').trim();
      }
      const id = crypto.randomUUID();
      fs.writeFileSync(fallbackPath, id);
      return id;
    }
  }

  getLicenseDir() {
    const licensePath = this.getLicensePath();
    return path.dirname(licensePath);
  }

  generateToken(licenseKey, machineId, expiresAt) {
    const payload = `${licenseKey}|${machineId}|${expiresAt}`;
    const sig = crypto.createHmac('sha256', this.LICENSE_SECRET).update(payload).digest('hex');
    return Buffer.from(JSON.stringify({ payload, sig })).toString('base64');
  }

  verifyToken(token) {
    try {
      const { payload, sig } = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
      const expected = crypto.createHmac('sha256', this.LICENSE_SECRET).update(payload).digest('hex');
      if (sig !== expected) return null;
      const [licenseKey, machineId, expiresAt] = payload.split('|');
      if (new Date(expiresAt) < new Date()) return null;
      return { licenseKey, machineId, expiresAt };
    } catch {
      return null;
    }
  }

  readLicense() {
    try {
      const filePath = this.getLicensePath();
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  saveLicense(data) {
    try {
      const dir = this.getLicenseDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.getLicensePath(), JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('保存许可证失败:', error);
      return false;
    }
  }

  clearLicense() {
    try {
      const filePath = this.getLicensePath();
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
      console.error('清除许可证失败:', error);
    }
  }

  httpPost(url, body, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      try {
        const urlObj = new URL(url);
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(JSON.stringify(body))
          },
          timeout: timeoutMs
        };

        const req = (urlObj.protocol === 'https:' ? https : http).request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({});
            }
          });
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('timeout'));
        });

        req.write(JSON.stringify(body));
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  getServerUrl() {
    try {
      const configPath = path.join(__dirname, '../config/openclaw.json');
      if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (cfg?.openclaw?.cms?.url) return cfg.openclaw.cms.url;
        if (cfg?.cms?.url) return cfg.cms.url;
      }
    } catch {
      // ignore
    }
    return 'https://claw.devhub.asia';
  }

  async activateLicense(licenseKey, serverUrl = null) {
    const url = serverUrl || this.getServerUrl();
    const machineId = this.getMachineId();

    try {
      const resp = await this.httpPost(`${url}/api/activate`, { licenseKey, machineId });
      console.log('[License Activation] Response:', resp);

      if (!resp.valid) {
        return {
          activated: false,
          message: resp.message || '激活失败'
        };
      }

      const expiresAt = resp.expiresAt || this.calculateDefaultExpiry();
      const token = this.generateToken(licenseKey, machineId, expiresAt);

      this.saveLicense({
        licenseKey,
        machineId,
        token,
        expiresAt,
        activatedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString()
      });

      this.startPeriodicVerify();

      return {
        activated: true,
        message: resp.message || '激活成功',
        expiresAt
      };
    } catch (e) {
      console.error('[License Activation] Error:', e);
      if (e.message === 'timeout' || e.code === 'ECONNREFUSED') {
        return {
          activated: false,
          message: `无法连接激活服务器 (${url})，请确认服务已启动`
        };
      }
      return {
        activated: false,
        message: `激活请求失败：${e.message}`
      };
    }
  }

  calculateDefaultExpiry() {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString();
  }

  async checkLicenseOnline(serverUrl = null) {
    const url = serverUrl || this.getServerUrl();
    const stored = this.readLicense();
    const machineId = this.getMachineId();

    if (!stored) {
      return {
        activated: false,
        message: '未激活'
      };
    }

    try {
      const resp = await this.httpPost(`${url}/api/license/check`, {
        licenseKey: stored.licenseKey,
        machineId
      });

      if (!resp.valid) {
        this.clearLicense();
        this.notifyLicenseInvalid?.();
        return {
          activated: false,
          message: resp.message || '服务器验证失败，请重新激活'
        };
      }

      this.saveLicense({
        ...stored,
        expiresAt: resp.expiresAt || stored.expiresAt,
        lastSyncedAt: new Date().toISOString()
      });

      return {
        activated: true,
        message: '已激活',
        expiresAt: resp.expiresAt
      };
    } catch (e) {
      console.log('[License] Online check failed:', e.message);
      this.clearLicense();
      this.notifyLicenseInvalid?.();
      return {
        activated: false,
        message: '无法连接激活服务器，请检查网络'
      };
    }
  }

  async checkLicense() {
    return await this.checkLicenseOnline();
  }

  async periodicVerify() {
    try {
      await this.checkLicenseOnline();
      console.log('[License] Periodic verify completed');
    } catch (e) {
      console.log('[License] Periodic verify failed:', e);
    }
  }

  startPeriodicVerify() {
    if (this.verifyInterval) {
      clearInterval(this.verifyInterval);
    }

    const stored = this.readLicense();
    if (!stored) return;

    this.verifyInterval = setInterval(() => {
      this.periodicVerify();
    }, this.VERIFY_INTERVAL_MS);

    console.log('[License] Periodic verify started, interval:', this.VERIFY_INTERVAL_MS, 'ms');
  }

  stopPeriodicVerify() {
    if (this.verifyInterval) {
      clearInterval(this.verifyInterval);
      this.verifyInterval = null;
    }
  }

  clearActivation() {
    this.clearLicense();
    this.stopPeriodicVerify();
  }

  async getLicenseInfo() {
    const stored = this.readLicense();
    if (!stored) {
      return {
        activated: false
      };
    }

    const result = await this.checkLicenseOnline();
    return {
      activated: result.activated,
      licenseKey: stored.licenseKey,
      expiresAt: result.expiresAt,
      message: result.message,
      lastSyncedAt: stored.lastSyncedAt
    };
  }

  init(onInvalid) {
    this.notifyLicenseInvalid = onInvalid;
    const stored = this.readLicense();
    if (stored) {
      this.startPeriodicVerify();
    }
  }
}

module.exports = LicenseManager;
