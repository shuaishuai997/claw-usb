const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor() {
    this.configPath = path.join(__dirname, '../config.json');
    this.openclawConfigPath = path.join(__dirname, '../config/openclaw.json');
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return { ...this.getDefaultConfig(), ...JSON.parse(data) };
      }
    } catch (error) {
      console.error('加载配置文件失败:', error);
    }
    return this.getDefaultConfig();
  }

  getDefaultConfig() {
    return {
      apiKey: '',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      model: 'deepseek',
      providerUrl: 'https://api.deepseek.com/v1',
      port: 18789,
      workspace: './config/workspace',
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
    this.updateOpenclawConfig();
    return this.saveConfig();
  }

  getModel() {
    return this.config.model || 'deepseek';
  }

  setModel(model) {
    this.config.model = model;
    return this.saveConfig();
  }

  getProviderUrl() {
    return this.config.providerUrl || 'https://api.deepseek.com/v1';
  }

  setProviderUrl(url) {
    this.config.providerUrl = url;
    this.updateOpenclawConfig();
    return this.saveConfig();
  }

  getApiKeyEnv() {
    return this.config.apiKeyEnv || 'DEEPSEEK_API_KEY';
  }

  setApiKeyEnv(envName) {
    this.config.apiKeyEnv = envName;
    this.updateOpenclawConfig();
    return this.saveConfig();
  }

  getPort() {
    return this.config.port || 18789;
  }

  setPort(port) {
    this.config.port = port;
    return this.saveConfig();
  }

  getWorkspace() {
    return this.config.workspace || './config/workspace';
  }

  setWorkspace(workspace) {
    this.config.workspace = workspace;
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
    try {
      if (fs.existsSync(this.openclawConfigPath)) {
        fs.unlinkSync(this.openclawConfigPath);
      }
      this.config = this.getDefaultConfig();
      return this.saveConfig();
    } catch (error) {
      console.error('恢复默认配置失败:', error);
      return false;
    }
  }

  getAll() {
    return { ...this.config };
  }

  updateOpenclawConfig() {
    try {
      if (fs.existsSync(this.openclawConfigPath)) {
        const data = fs.readFileSync(this.openclawConfigPath, 'utf8');
        const openclawConfig = JSON.parse(data);
        
        if (openclawConfig.models && openclawConfig.models.providers) {
          const providerKey = Object.keys(openclawConfig.models.providers)[0];
          if (providerKey) {
            openclawConfig.models.providers[providerKey].baseUrl = this.getProviderUrl();
            openclawConfig.models.providers[providerKey].apiKey = `\${${this.getApiKeyEnv()}}`;
          }
        }

        fs.writeFileSync(this.openclawConfigPath, JSON.stringify(openclawConfig, null, 2));
      }
    } catch (error) {
      console.error('更新 OpenClaw 配置失败:', error);
    }
  }
}

module.exports = ConfigManager;
