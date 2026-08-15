import { join } from 'path'
import electron from 'electron'
import Store from './utils/store'

const { app, BrowserWindow, ipcMain, Menu, session } = electron

let store: Store
let mainWindow: InstanceType<typeof BrowserWindow> | null = null

function createWindow() {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Gipfel商赛系统',
    icon: join(__dirname, '../public/app-icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  // Store 必须在 app ready 之后实例化，否则 app.getPath 不可用
  store = new Store()
  // session 必须等 app ready 才能访问（顶层访问会抛 “Session can only be received when app is ready”）。
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode === 0) {
      callback(-3)
    } else {
      callback(0)
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 内网 / 可信 frp 转发常使用自签证书，Electron 默认会拒绝握手导致 https 服务器连接失败。
// 1) app 级 certificate-error：覆盖导航与主进程 net 请求（兜底）。
app.on('certificate-error', (_event, _webContents, _url, _error, _certificate, callback) => {
  _event.preventDefault()
  callback(true)
})

// 2) session 级 setCertificateVerifyProc：覆盖【整个会话】的所有 TLS 校验，
//    包括渲染进程里的 axios(XHR/fetch) 与 socket.io(WebSocket)，
//    这才是真正拦住 renderer 请求证书错误的关键。仅当校验本身失败（如自签 errorCode!=0）
//    才放行；正常可信证书仍走 Chromium 默认校验（callback(-3) 采用 Chromium 结果）。
//    注意：session.defaultSession 只能在 app ready 之后访问，故置于 whenReady 回调内。

ipcMain.handle('config:get', (_event, key: string) => store.get(key))
ipcMain.handle('config:set', (_event, key: string, value: any) => store.set(key, value))
ipcMain.handle('config:getAll', () => store.getAll())
// 暴露 Electron 应用版本（取自 client/package.json 的 version），供客户端「版本更新提示」与自身版本比较。
ipcMain.handle('app:getVersion', () => app.getVersion())
