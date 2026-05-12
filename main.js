const { app, BrowserWindow, Menu, Tray, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const ServiceManager = require('./services/serviceManager')
const ConfigManager = require('./services/configManager')

let mainWindow
let tray = null
const serviceManager = new ServiceManager()
const configManager = new ConfigManager()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'OpenClaw U盘版 v1.1.1',
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  })

  mainWindow.loadFile('index.html')

  mainWindow.on('minimize', (e) => {
    e.preventDefault()
    mainWindow.hide()
  })

  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault()
      mainWindow.hide()
    }
    return false
  })
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.ico'))
  updateTrayMenu()
  tray.setToolTip('OpenClaw U盘版')
  tray.on('click', () => {
    mainWindow.show()
  })
}

function updateTrayMenu() {
  const status = serviceManager.getStatus()
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => mainWindow.show() },
    { 
      label: status.isRunning ? '停止服务' : '启动服务',
      click: async () => {
        if (status.isRunning) {
          await serviceManager.stop()
        } else {
          await serviceManager.start()
        }
        updateTrayMenu()
      }
    },
    { label: '退出', click: () => {
      app.isQuiting = true
      serviceManager.stop()
      app.quit()
    }}
  ])
  tray.setContextMenu(contextMenu)
}

function setupServiceCallbacks() {
  serviceManager.setLogCallback((message) => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('log-update', message)
    }
  })

  serviceManager.setStartCallback((data) => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('service-started', data)
    }
    updateTrayMenu()
  })

  serviceManager.setErrorCallback((error) => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('service-error', error)
    }
    updateTrayMenu()
  })

  serviceManager.setStopCallback(() => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('service-stopped')
    }
    updateTrayMenu()
  })
}

ipcMain.on('start-service', async (event) => {
  try {
    const result = await serviceManager.start()
    event.reply('service-status', { success: true, isRunning: true, pid: result.pid, port: result.port })
  } catch (error) {
    event.reply('service-status', { success: false, error: error.message })
  }
})

ipcMain.on('stop-service', async (event) => {
  try {
    await serviceManager.stop()
    event.reply('service-status', { success: true, isRunning: false })
  } catch (error) {
    event.reply('service-status', { success: false, error: error.message })
  }
})

ipcMain.on('get-service-status', (event) => {
  event.reply('service-status', serviceManager.getStatus())
})

ipcMain.on('get-api-key', (event) => {
  event.reply('api-key', configManager.getApiKey())
})

ipcMain.on('set-api-key', (event, apiKey) => {
  const success = configManager.setApiKey(apiKey)
  event.reply('api-key-saved', success)
})

ipcMain.on('get-config', (event) => {
  event.reply('config', configManager.getAll())
})

ipcMain.on('restore-defaults', (event) => {
  const success = configManager.restoreDefaults()
  event.reply('restore-complete', success)
})

ipcMain.on('get-license', (event) => {
  event.reply('license', configManager.getLicense())
})

ipcMain.on('activate-license', (event, key) => {
  const success = configManager.activateLicense(key)
  event.reply('license-activated', success)
})

ipcMain.on('minimize-window', () => {
  mainWindow.minimize()
})

ipcMain.on('hide-window', () => {
  mainWindow.hide()
})

ipcMain.on('open-dashboard', async (event) => {
  try {
    await serviceManager.openDashboard()
    event.reply('dashboard-opened', { success: true })
  } catch (error) {
    event.reply('dashboard-opened', { success: false, error: error.message })
  }
})

ipcMain.on('setup', async (event) => {
  try {
    await serviceManager.setup()
    event.reply('setup-completed', { success: true })
  } catch (error) {
    event.reply('setup-completed', { success: false, error: error.message })
  }
})

ipcMain.on('get-all-config', (event) => {
  const config = configManager.getAll()
  event.reply('all-config', config)
})

ipcMain.on('set-provider-url', (event, url) => {
  const result = configManager.setProviderUrl(url)
  event.reply('config-saved', { success: result })
})

ipcMain.on('set-api-key-env', (event, envName) => {
  const result = configManager.setApiKeyEnv(envName)
  event.reply('config-saved', { success: result })
})

ipcMain.on('set-port', (event, port) => {
  const result = configManager.setPort(port)
  event.reply('config-saved', { success: result })
})

ipcMain.on('set-workspace', (event, workspace) => {
  const result = configManager.setWorkspace(workspace)
  event.reply('config-saved', { success: result })
})

ipcMain.on('apply-model-config', (event, config) => {
  try {
    const openclawConfigPath = path.join(__dirname, 'config', 'openclaw.json')
    
    if (!fs.existsSync(openclawConfigPath)) {
      event.reply('model-config-applied', { success: false, error: '配置文件不存在' })
      return
    }

    const raw = fs.readFileSync(openclawConfigPath, 'utf-8')
    const openclawConfig = JSON.parse(raw)

    if (!openclawConfig.models) {
      openclawConfig.models = { mode: 'merge', providers: {} }
    }
    if (!openclawConfig.models.providers) {
      openclawConfig.models.providers = {}
    }

    const providerId = config.provider
    const apiType = config.api || 'openai-completions'
    
    if (!openclawConfig.models.providers[providerId]) {
      openclawConfig.models.providers[providerId] = {
        api: apiType,
        baseUrl: config.baseUrl
      }
    } else {
      openclawConfig.models.providers[providerId].api = apiType
      openclawConfig.models.providers[providerId].baseUrl = config.baseUrl
    }

    if (config.apiKey) {
      openclawConfig.models.providers[providerId].apiKey = config.apiKey
    } else if (openclawConfig.models.providers[providerId].apiKey) {
      delete openclawConfig.models.providers[providerId].apiKey
    }

    if (!openclawConfig.models.providers[providerId].models) {
      openclawConfig.models.providers[providerId].models = []
    }

    const existingModelIndex = openclawConfig.models.providers[providerId].models.findIndex(m => m.id === config.model)
    if (existingModelIndex >= 0) {
      openclawConfig.models.providers[providerId].models[existingModelIndex].name = config.model
    } else {
      openclawConfig.models.providers[providerId].models.push({
        id: config.model,
        name: config.model,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096
      })
    }

    openclawConfig.agents = openclawConfig.agents || {}
    openclawConfig.agents.defaults = openclawConfig.agents.defaults || {}
    openclawConfig.agents.defaults.model = `${providerId}/${config.model}`

    fs.writeFileSync(openclawConfigPath, JSON.stringify(openclawConfig, null, 2))

    if (config.apiKey) {
      const envVarName = `${providerId.toUpperCase()}_API_KEY`
      process.env[envVarName] = config.apiKey
    }

    event.reply('model-config-applied', { success: true })
  } catch (error) {
    event.reply('model-config-applied', { success: false, error: error.message })
  }
})

app.whenReady().then(() => {
  createWindow()
  createTray()
  setupServiceCallbacks()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  serviceManager.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

module.exports = { serviceManager, configManager }