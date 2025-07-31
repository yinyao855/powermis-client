import { app, BrowserWindow, ipcMain, shell, webContents, desktopCapturer } from 'electron'
import path, { join, resolve } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { decryptPdf } from './decrypt.js'
import fs from 'fs'
import os from 'os'
import fetch from 'node-fetch'

let mainWindow
let printWin = null // 隐藏的打印窗口
// 保存临时PDF文件路径，用于退出时清理
let tempPdfFiles = new Set()
// 保存待处理的协议URL（当应用启动时收到协议参数）
let pendingProtocolUrl = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800, // 使用较大的默认尺寸以适应PDF阅读
    height: 600,
    minWidth: 400,
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
    // 窗口准备好后，检查是否有待处理的协议参数
    if (pendingProtocolUrl) {
      console.log('[ready-to-show] 处理待处理的协议参数:', pendingProtocolUrl)
      handleCustomProtocol(pendingProtocolUrl)
      pendingProtocolUrl = null
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 初始加载主界面
  loadMainInterface()

  // 禁用开发者工具
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools()
  })
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

  // 发送开始加载事件
  mainWindow.webContents.send('pdf-loading')

  // 主进程下载并解密PDF，生成本地临时文件
  let localFileUrl = ''
  try {
    const response = await fetch(file_url, {})
    const buffer = await response.buffer()
    const decryptedBuffer = decryptPdf(buffer, file_key)
    const tempPath = path.join(os.tmpdir(), `powermis_${Date.now()}.pdf`)
    fs.writeFileSync(tempPath, decryptedBuffer)
    // 记录临时文件路径，用于退出时清理
    tempPdfFiles.add(tempPath)
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

// 修复electron18.0.0-beta.5 之后版本的BUG: 无法获取当前程序页面视频流
const selfWindows = async () =>
  await Promise.all(
    webContents
      .getAllWebContents()
      .filter((item) => {
        const win = BrowserWindow.fromWebContents(item)
        return win && win.isVisible()
      })
      .map(async (item) => {
        const win = BrowserWindow.fromWebContents(item)
        const thumbnail = await win?.capturePage()
        // 当程序窗口打开DevTool的时候  也会计入
        return {
          name: win?.getTitle() + (item.devToolsWebContents === null ? '' : '-dev'), // 给dev窗口加上后缀
          id: win?.getMediaSourceId(),
          thumbnail,
          display_id: '',
          appIcon: null
        }
      })
  )

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

  // 处理应用启动时的协议参数（当应用未运行时从浏览器唤起）
  const protocolUrl = process.argv.find((arg) => arg.startsWith('powermis://'))
  if (protocolUrl) {
    console.log('[app.whenReady] 启动时收到协议参数:', protocolUrl)
    // 保存待处理的协议URL，等待窗口准备好后处理
    pendingProtocolUrl = protocolUrl
  }

  app.on('open-url', (event, url) => {
    console.log('[open-url] event, url:', url)
    event.preventDefault()
    handleCustomProtocol(url)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)

    // 禁用F12和其他开发者工具快捷键
    window.webContents.on('before-input-event', (event, input) => {
      if (
        input.key === 'F12' ||
        (input.control && input.key === 'Shift' && input.key === 'I') ||
        (input.control && input.key === 'Shift' && input.key === 'C') ||
        (input.control && input.key === 'U')
      ) {
        event.preventDefault()
      }
    })

    // 禁用右键菜单中的开发者工具
    window.webContents.on('context-menu', (event) => {
      event.preventDefault()
    })
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
        show: true, // 应该为false, 但有bug
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false,
          webSecurity: false,
          allowRunningInsecureContent: true,
          contextIsolation: false
        }
      })

      // 禁用打印窗口的开发者工具
      printWin.webContents.on('devtools-opened', () => {
        printWin.webContents.closeDevTools()
      })

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
          ipcMain.off('pdf-loaded', onPdfLoaded)
          ipcMain.off('pdf-load-error', onPdfLoadError)
          printWin.webContents.off('did-fail-load', onPageLoadFail)
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
        // 过滤掉Windows虚拟打印机
        const virtualPrinters = [
          'Microsoft Print to PDF',
          'Microsoft XPS Document Writer',
          'OneNote',
          'Fax',
          'PDF',
          'XPS'
        ]

        const filteredPrinters = printers.filter((printer) => {
          const printerName = (printer.name || printer.displayName || '').toLowerCase()

          // 检查是否包含虚拟打印机关键词
          const isVirtual = virtualPrinters.some((virtual) =>
            printerName.includes(virtual.toLowerCase())
          )

          // 检查是否是Microsoft的虚拟打印机
          const isMicrosoftVirtual =
            printerName.includes('microsoft') &&
            (printerName.includes('pdf') ||
              printerName.includes('xps') ||
              printerName.includes('onenote'))

          return !isVirtual && !isMicrosoftVirtual
        })

        // 格式化返回数据
        return filteredPrinters.map((printer) => ({
          name: printer.name, // 打印机名称（用于指定打印设备）
          displayName: printer.displayName || printer.name // 显示名称
        }))
      }
      return [] // 无可用窗口时返回空列表
    } catch (error) {
      console.error('获取打印机列表失败：', error)
      return [] // 出错时返回空列表，避免渲染进程报错
    }
  })

  // 获取设备窗口信息
  ipcMain.handle('send-desktop-capturer_source', async () => {
    return [
      ...(await desktopCapturer.getSources({ types: ['window', 'screen'] })),
      ...(await selfWindows())
    ]
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

// 应用退出时清理临时文件
app.on('before-quit', () => {
  console.log('[before-quit] 清理临时PDF文件...')
  tempPdfFiles.forEach((filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        console.log(`[before-quit] 已删除临时文件: ${filePath}`)
      }
    } catch (error) {
      console.error(`[before-quit] 删除临时文件失败: ${filePath}`, error)
    }
  })
  tempPdfFiles.clear()
})
