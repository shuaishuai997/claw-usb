const { app, BrowserWindow, Menu, Tray, ipcMain } = require('electron')
const path = require('path')
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