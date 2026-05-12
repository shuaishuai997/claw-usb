const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor() {
    this.configPath = path.join(__dirname, '../config.json');
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('加载配置文件失败:', error);
    }
    return this.getDefaultConfig();
  }

  getDefaultConfig() {
    return {
      apiKey: '',
      model: 'DeepSeek Chat',
      wechatEnabled: true,
      autoStart: false,
      logLevel: 'info',
      license: {
        activated: false,
        key: '',
        expires: '',
        features: []
      }
    };
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      return true;
    } catch (error) {
      console.error('保存配置文件失败:', error);
      return false;
    }
  }

  getApiKey() {
    return this.config.apiKey || '';
  }

  setApiKey(apiKey) {
    this.config.apiKey = apiKey;
    return this.saveConfig();
  }

  getModel() {
    return this.config.model || 'DeepSeek Chat';
  }

  setModel(model) {
    this.config.model = model;
    return this.saveConfig();
  }

  getLicense() {
    return this.config.license || { activated: false };
  }

  activateLicense(key) {
    this.config.license = {
      activated: true,
      key: key,
      expires: this.calculateExpiry(),
      features: ['wechat', 'api', 'restore']
    };
    return this.saveConfig();
  }

  calculateExpiry() {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().split('T')[0];
  }

  restoreDefaults() {
    this.config = this.getDefaultConfig();
    return this.saveConfig();
  }

  getAll() {
    return { ...this.config };
  }
}

module.exports = ConfigManager;