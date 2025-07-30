import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { decryptPdf } from './decrypt.js'
import fs from 'fs'
import os from 'os'
import path from 'path'
import fetch from 'node-fetch'

let mainWindow
let printWin = null // 隐藏的打印窗口
// 保存浏览器唤起时的初始参数
// let initialProtocolParams = null

// 辅助函数：将打印机状态码转为直观文本（可选，根据需要添加）
function getPrinterStatusText(statusCode) {
  const statusMap = {
    0: '在线',
    1: '离线',
    2: '正在打印',
    3: '需要注意'
    // 其他状态码可参考Electron文档补充
  }
  return statusMap[statusCode] || `未知状态(${statusCode})`
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, // 使用较大的默认尺寸以适应PDF阅读
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false // 需要此选项以加载本地PDF文件
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 页面加载完成后，处理暂存的协议参数
  // mainWindow.webContents.on('did-finish-load', () => {
  //   if (initialProtocolParams) {
  //     const { file_url, file_key } = initialProtocolParams;
  //     displayPdfInMainWindow(file_url, file_key);
  //     initialProtocolParams = null; // 清空参数，避免重复处理
  //   }
  // });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 初始加载主界面
  loadMainInterface()

  // 打开开发者工具
  mainWindow.webContents.openDevTools()
}

// 加载主界面（无PDF状态）
function loadMainInterface() {
  const hash = '/pdf-reader'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

// 在主窗口中显示PDF
async function displayPdfInMainWindow(file_url, file_key) {
  console.log('[displayPdfInMainWindow] file_url:', file_url)
  console.log('[displayPdfInMainWindow] file_key:', file_key)

  // 主进程下载并解密PDF，生成本地临时文件
  let localFileUrl = ''
  try {
    const response = await fetch(file_url)
    const buffer = await response.buffer()
    const decryptedBuffer = decryptPdf(buffer, file_key)
    const tempPath = path.join(os.tmpdir(), `powermis_${Date.now()}.pdf`)
    fs.writeFileSync(tempPath, decryptedBuffer)
    localFileUrl = 'file://' + tempPath
    console.log('[displayPdfInMainWindow] localFileUrl:', localFileUrl)
  } catch (err) {
    console.error('[displayPdfInMainWindow] 下载或解密PDF失败:', err)
    // 显示错误消息
    mainWindow.webContents.send('pdf-error', '无法加载PDF文件')
    return
  }

  // 更新主窗口中的PDF显示
  mainWindow.webContents.send('pdf-load', localFileUrl)
}

// 显示无PDF提示
function showNoPdfMessage() {
  mainWindow.webContents.send('pdf-error', '没有可显示的PDF文件')
}

function handleCustomProtocol(url) {
  console.log('[handleCustomProtocol] called with url:', url)
  try {
    const urlObj = new URL(url)
    console.log('[handleCustomProtocol] urlObj:', urlObj)
    const pathVal = urlObj.pathname || urlObj.host || ''
    console.log('[handleCustomProtocol] path:', pathVal)
    console.log('[handleCustomProtocol] params:', urlObj.searchParams.toString())
    if (pathVal === '/reader' || pathVal === 'reader' || pathVal === '//reader') {
      const file_url = urlObj.searchParams.get('file_url')
      const file_key = urlObj.searchParams.get('file_key')
      console.log('[handleCustomProtocol] file_url:', file_url)
      console.log('[handleCustomProtocol] file_key:', file_key)
      if (file_url && file_key) {
        // 检查主窗口是否已加载（页面 + 渲染进程组件就绪）
        // if (mainWindow?.webContents?.isLoaded()) {
        //   displayPdfInMainWindow(file_url, file_key);
        // } else {
        //   // 暂存参数，等待页面加载完成后处理
        //   initialProtocolParams = { file_url, file_key };
        // }
        displayPdfInMainWindow(file_url, file_key)
      } else {
        showNoPdfMessage()
      }
    } else {
      showNoPdfMessage()
    }
  } catch (error) {
    showNoPdfMessage()
    console.error('[handleCustomProtocol] 处理powermis协议失败:', error)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  // 注册自定义协议处理
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      console.log('[app.whenReady] 注册powermis协议（defaultApp模式）')
      app.setAsDefaultProtocolClient('powermis', process.execPath, [resolve(process.argv[1])])
    }
  } else {
    console.log('[app.whenReady] 注册powermis协议')
    app.setAsDefaultProtocolClient('powermis')
  }

  // 确保应用只运行一个实例
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    console.log('[app.whenReady] 没有获得单例锁，退出')
    app.quit()
  } else {
    app.on('second-instance', (event, commandLine) => {
      console.log('[second-instance] commandLine:', commandLine)
      // 遍历命令行参数，找到以powermis://开头的URL
      const url = commandLine.find((arg) => arg.startsWith('powermis://'))
      if (url) {
        handleCustomProtocol(url) // 只处理有效的协议URL
      }
      // 如果应用已经运行，聚焦到主窗口
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
    })
  }

  app.on('open-url', (event, url) => {
    console.log('[open-url] event, url:', url)
    event.preventDefault()
    handleCustomProtocol(url)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 处理渲染进程消息
  ipcMain.on('ping', () => console.log('pong'))

  // 测试打印窗口加载
  ipcMain.handle('test-print-load', async (event, fileUrl) => {
    // 接收fileUrl参数
    console.log('测试打印窗口加载, fileUrl:', fileUrl)
    try {
      printWin = new BrowserWindow({
        width: 900,
        height: 1200,
        show: true, // 测试
        webPreferences: {
          sandbox: false,
          webSecurity: false, // 允许加载本地文件
          allowRunningInsecureContent: true
        }
      })

      // 加载打印页面（包含PDF内容），使用传入的fileUrl
      let printPageUrl = `file://${path.join(__dirname, '../renderer/print.html')}?file=${encodeURIComponent(fileUrl)}`

      // 等待页面加载完成（使用Promise封装事件）
      await new Promise((resolve, reject) => {
        // 页面加载成功
        printWin.webContents.on('did-finish-load', resolve)

        // 页面加载失败
        printWin.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
          reject(new Error(`页面加载失败：${errorDescription}（错误码：${errorCode}）`))
        })

        // 加载页面（捕获加载错误）
        printWin.loadURL(printPageUrl).catch(reject)
      })

      // 页面加载完成后销毁页面
      // printWin.close();
      // printWin = null; // 重置，避免重复使用
      return { success: true } // 返回成功信息，供渲染进程判断
    } catch (error) {
      console.error('测试打印加载失败:', error)
      return { success: false, error: error.message } // 返回错误信息
    }
  })

  // 处理静默打印请求（渲染进程调用）
  ipcMain.handle('silent-print', async (event, fileUrl, printOptions = {}) => {
    try {
      // 先检查是否有可用打印机
      const allWins = BrowserWindow.getAllWindows()
      const anyWin = allWins.find((w) => !w.isDestroyed() && w.webContents)
      if (anyWin) {
        const printers = await anyWin.webContents.getPrintersAsync()
        if (printers.length === 0) {
          return { success: false, error: '无可用打印机' }
        }
      } else {
        return { success: false, error: '无法访问浏览器窗口' }
      }

      // 关闭已有打印窗口
      if (printWin && !printWin.isDestroyed()) {
        printWin.close()
      }

      // 创建隐藏的打印窗口
      printWin = new BrowserWindow({
        width: 900,
        height: 1200,
        show: true, // 临时设为true用于调试，生产环境改为false
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false,
          webSecurity: false,
          allowRunningInsecureContent: true,
          contextIsolation: false
        }
      })

      // 打开开发者工具用于调试
      printWin.webContents.openDevTools()

      // 加载打印页面
      const printPageUrl = `file://${path.join(__dirname, '../renderer/print.html')}?file=${encodeURIComponent(fileUrl)}`

      // 等待PDF加载完成
      await new Promise((resolve, reject) => {
        let timeoutTimer

        const onPdfLoaded = () => {
          console.log('PDF加载完成，准备打印')
          cleanup()
          resolve()
        }

        const onPdfLoadError = (event, errorMsg) => {
          console.log('PDF加载错误: ' + errorMsg)
          cleanup()
          reject(new Error(`PDF加载失败：${errorMsg}`))
        }

        const onPageLoadFail = (_, errorCode, errorDescription) => {
          console.log('页面加载失败: ', errorCode)
          cleanup()
          reject(new Error(`页面加载失败：${errorDescription}（错误码：${errorCode}）`))
        }

        const cleanup = () => {
          ipcMain.removeListener('pdf-loaded', onPdfLoaded)
          ipcMain.removeListener('pdf-load-error', onPdfLoadError)
          printWin.webContents.removeListener('did-fail-load', onPageLoadFail)
          clearTimeout(timeoutTimer)
        }

        // 注册监听器
        ipcMain.once('pdf-loaded', onPdfLoaded)
        ipcMain.once('pdf-load-error', onPdfLoadError)
        printWin.webContents.once('did-fail-load', onPageLoadFail)

        // 超时保护
        timeoutTimer = setTimeout(() => {
          cleanup()
          reject(new Error('PDF加载超时（10秒）'))
        }, 10000)

        // 加载页面
        printWin.loadURL(printPageUrl).catch((err) => {
          cleanup()
          reject(new Error(`页面加载失败：${err.message}`))
        })
      })

      // 执行打印
      return await new Promise((resolve, reject) => {
        printWin.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName: printOptions.printer || '',
            copies: printOptions.copies || 1,
            duplexMode: printOptions.duplex === 'duplex' ? 'longEdge' : 'simplex',
            pageRanges: '', // 打印所有页面
            printSelectionOnly: false, // 不限制选择区域
            // landscape: false, // 纵向打印
            margins: {
              marginType: 'printableArea'
            }
          },
          (success, errorType) => {
            // 关闭窗口
            if (printWin && !printWin.isDestroyed()) {
              printWin.close()
              printWin = null
            }

            if (success) {
              resolve({ success: true, message: '打印成功' })
            } else {
              reject(new Error(`打印失败：${errorType || '未知错误'}`))
            }
          }
        )
      })
    } catch (error) {
      // 异常处理：关闭窗口并返回错误
      if (printWin && !printWin.isDestroyed()) {
        printWin.close()
        printWin = null
      }
      return { success: false, error: error.message }
    }
  })

  // 辅助：获取可用打印机列表（异步方法，供渲染进程检查）
  ipcMain.handle('get-printers', async () => {
    try {
      const allWins = BrowserWindow.getAllWindows()
      // 找到一个可用的窗口（未被销毁且有webContents）
      const anyWin = allWins.find((w) => !w.isDestroyed() && w.webContents)

      if (anyWin) {
        // 调用异步方法获取打印机列表，需要await
        const printers = await anyWin.webContents.getPrintersAsync()
        console.log(printers)
        // 格式化返回数据（只保留需要的字段）
        return printers.map((printer) => ({
          name: printer.name, // 打印机名称（用于指定打印设备）
          isDefault: printer.isDefault, // 是否默认打印机
          status: printer.status, // 状态码（0=在线，1=离线等，根据Electron定义）
          statusText: getPrinterStatusText(printer.status) // 状态文本（可选，更直观）
        }))
      }
      return [] // 无可用窗口时返回空列表
    } catch (error) {
      console.error('获取打印机列表失败：', error)
      return [] // 出错时返回空列表，避免渲染进程报错
    }
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
