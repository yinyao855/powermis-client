<template>
  <div class="pdf-reader">
    <div class="pdf-toolbar">
      <span class="pdf-title">PDF阅读器</span>
      <button v-if="fileUrl && !errorMessage && !isLoading" class="print-btn" @click="handlePrint">
        打印
      </button>
      <button
        v-if="fileUrl && !errorMessage && !isLoading"
        class="print-btn"
        :disabled="!worker"
        :title="!worker ? 'OCR 引擎初始化中...' : 'OCR 识别'"
        @click="screenshot"
      >
        {{ !worker ? 'OCR 初始化中...' : 'OCR 识别' }}
      </button>
    </div>
    <div class="param-info" :class="{ 'no-content': !fileUrl || errorMessage }">
      <!-- 加载状态显示 -->
      <div v-if="isLoading" class="loading-tip">
        <div class="loading-icon">⏳</div>
        <div class="loading-text">正在加载PDF文件...</div>
      </div>
      <!-- 错误信息显示（优先显示事件传递的错误） -->
      <div v-else-if="errorMessage" class="error-tip">
        <div class="error-icon">⚠️</div>
        <div class="error-text">{{ errorMessage }}</div>
      </div>
      <!-- 原参数错误提示（事件未触发时显示） -->
      <div v-else-if="!fileUrl" class="empty-tip">
        <div class="empty-icon">📄</div>
        <div class="empty-text">暂无可显示的PDF文件</div>
      </div>
    </div>
    <div class="pdf-container" :class="{ 'no-content': !fileUrl || errorMessage || isLoading }">
      <iframe
        v-if="fileUrl && !errorMessage && !isLoading"
        ref="pdfIframe"
        :src="iframeSrc"
        class="pdf-iframe"
        allowfullscreen
      ></iframe>
    </div>
    <PrintDialog v-if="showPrintDialog" @close="showPrintDialog = false" @print="onPrint" />

    <!-- OCR识别结果对话框 -->
    <div v-if="ocrDialogVisible" class="ocr-dialog-overlay" @click="closeOcrDialog">
      <div class="ocr-dialog" @click.stop>
        <div class="ocr-dialog-header">
          <h3>识别结果</h3>
          <button class="ocr-dialog-close" @click="closeOcrDialog">×</button>
        </div>
        <div class="ocr-dialog-content">
          <div v-if="ocrLoading" class="ocr-loading">
            <div class="ocr-loading-spinner"></div>
            <div class="ocr-loading-text">正在识别中...</div>
          </div>
          <div v-else class="ocr-text-container">
            <div class="ocr-text" v-text="ocrText"></div>
          </div>
        </div>
        <div class="ocr-dialog-footer">
          <button
            v-if="ocrText && ocrText !== '未识别到文字' && !ocrText.startsWith('识别失败')"
            class="ocr-copy-btn"
            title="复制到剪贴板"
            @click="copyToClipboard"
          >
            📋 复制
          </button>
          <button class="ocr-dialog-btn" @click="closeOcrDialog">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import PrintDialog from './PrintDialog.vue'
import ScreenShot from 'js-web-screen-shot'
import { createWorker, OEM } from 'tesseract.js'

// 引入ipcRenderer（从Electron预加载脚本获取）
const { ipcRenderer } = window.electron || {}

const route = useRoute()
// 存储PDF文件路径（优先使用事件传递的路径，其次使用路由参数）
const fileUrl = ref('')
// 存储错误信息（来自主进程的事件）
const errorMessage = ref('')
// 存储加载状态
const isLoading = ref(false)
const showPrintDialog = ref(false)
// OCR相关
const ocrDialogVisible = ref(false)
const ocrText = ref('')
const ocrLoading = ref(false)
const worker = ref(null)

// 计算iframe的PDF查看器路径
const iframeSrc = computed(() => {
  if (fileUrl.value && !errorMessage.value) {
    // 开发环境：根路径（/pdfjs → 对应 public/pdfjs）
    // 生产环境：相对路径（./pdfjs → 对应 dist/pdfjs，与 index.html 同级）
    const base = import.meta.env.DEV ? '/' : './'
    return `${base}pdfjs/web/viewer.html?file=${encodeURIComponent(fileUrl.value)}`
  } else {
    return ''
  }
})

// 处理打印按钮点击
function handlePrint() {
  showPrintDialog.value = true
}

// 关闭OCR对话框
function closeOcrDialog() {
  ocrDialogVisible.value = false
  ocrText.value = ''
  ocrLoading.value = false
}

// 截图并OCR识别
const screenshot = async () => {
  // 下面这两块自己考虑
  const sources = await getDesktopCapturerSource() // 这里返回的是设备上的所有窗口信息
  // 这里可以对`sources`数组下面id进行判断  找到当前的electron窗口  这里为了简单直接拿了第一个
  // console.log(sources)
  const stream = await getInitStream(sources.filter((e) => e.name === 'PowerMIS')[0])

  function triggerCallback() {
    const toolPanel = document.getElementById('toolPanel')
    const ocr = document.createElement('div')
    ocr.className = 'item-panel ocr'
    ocr.addEventListener('click', async () => {
      const canvasCtx = screenshot.getCanvasController().getContext('2d')
      const cutBoxSizePanel = document.getElementById('cutBoxSizePanel')
      const dpr = window.devicePixelRatio || 1
      const x = parseInt(cutBoxSizePanel.style.left) * dpr
      const y = (parseInt(cutBoxSizePanel.style.top) + 35) * dpr
      const [w, h] = cutBoxSizePanel.textContent.split(' * ').map((e) => parseInt(e) * dpr)
      const img = canvasCtx.getImageData(x, y, w, h)
      const newCanvas = document.createElement('canvas')
      newCanvas.width = w
      newCanvas.height = h
      newCanvas.getContext('2d').putImageData(img, 0, 0)

      // 显示OCR对话框并开始识别
      ocrDialogVisible.value = true
      ocrLoading.value = true

      try {
        // 检查 worker 是否已初始化
        if (!worker.value) {
          throw new Error('OCR 引擎未初始化，请稍后重试')
        }

        const res = await worker.value.recognize(newCanvas)
        // 去除汉字间的空格
        ocrText.value = res.data.text.replace(
          /(?<=[\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef]) +(?=[\u4e00-\u9fa5\u3000-\u303F\uff00-\uffef])/g,
          ''
        )
        if (ocrText.value === '') {
          ocrText.value = '未识别到文字'
        }
      } catch (error) {
        ocrText.value = '识别失败：' + error.message
      } finally {
        ocrLoading.value = false
      }
    })
    toolPanel.insertBefore(ocr, document.querySelector('.item-panel.save'))
  }

  const screenshot = new ScreenShot({
    enableWebRtc: true,
    screenFlow: stream, // 传入屏幕流数据
    level: 99,
    completeCallback: async () => {
      // 显示成功消息
      alert('截图成功')
    },
    triggerCallback
  })
}

// 复制到剪贴板
async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(ocrText.value)
    alert('复制成功')
  } catch (error) {
    console.error('复制失败:', error)
    // 降级方案：使用传统方法
    try {
      const textArea = document.createElement('textarea')
      textArea.value = ocrText.value
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      alert('复制成功')
    } catch (fallbackError) {
      console.error('降级复制也失败:', fallbackError)
      alert('复制失败')
    }
  }
}

const getDesktopCapturerSource = async () => {
  return await ipcRenderer.invoke('send-desktop-capturer_source', [])
}

// 获取指定id设备的视频流
function getInitStream(source, audio) {
  return new Promise((resolve) => {
    // 获取指定窗口的媒体流
    // 此处遵循的是webRTC的接口类型  暂时TS类型没有支持  只能断言成any
    navigator.mediaDevices
      .getUserMedia({
        audio: audio
          ? {
              mandatory: {
                chromeMediaSource: 'desktop'
              }
            }
          : false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.id
          }
        }
      })
      .then((stream) => {
        resolve(stream)
      })
      .catch((error) => {
        console.log(error)
        resolve(null)
      })
  })
}

// 处理打印确认
async function onPrint(params) {
  if (ipcRenderer && fileUrl.value) {
    try {
      // 调用静默打印接口并等待结果
      const printResult = await ipcRenderer.invoke('silent-print', fileUrl.value, params)

      // 根据返回结果显示提示
      if (printResult.success) {
        alert(printResult.message)
        // 关闭打印对话框
        showPrintDialog.value = false
      } else {
        // 打印失败时显示错误信息
        alert(`打印失败：${printResult.error}`)
      }
    } catch (err) {
      // 捕获调用过程中的异常（如接口调用失败）
      alert(`打印请求失败：${err.message || '未知错误'}`)
    }
  } else {
    // 没有文件路径时的提示
    alert('没有可打印的PDF文件')
  }
}

// 处理主进程发送的pdf-load事件（加载新PDF）
function handlePdfLoad(_event, localFileUrl) {
  errorMessage.value = '' // 清空错误
  isLoading.value = false // 加载完成
  fileUrl.value = localFileUrl // 更新PDF路径
}

// 处理主进程发送的pdf-error事件（显示错误）
function handlePdfError(_event, message) {
  errorMessage.value = message // 显示错误信息
  isLoading.value = false // 加载完成（即使是错误）
  fileUrl.value = '' // 清空PDF路径（避免错误时仍显示旧内容）
}

// 处理主进程发送的pdf-loading事件（开始加载PDF）
function handlePdfLoading() {
  isLoading.value = true // 开始加载
  errorMessage.value = '' // 清空错误信息
}

// 组件挂载时注册事件监听
onMounted(async () => {
  // 初始化时先从路由参数获取一次（兼容原有逻辑）
  if (route.query.file_url) {
    fileUrl.value = route.query.file_url
  }
  // 注册主进程事件监听
  if (ipcRenderer) {
    ipcRenderer.on('pdf-load', handlePdfLoad)
    ipcRenderer.on('pdf-error', handlePdfError)
    ipcRenderer.on('pdf-loading', handlePdfLoading)
  }

  // 初始化Tesseract worker
  try {
    const prefix = import.meta.env.DEV ? '/' : './'
    console.log('正在初始化 OCR 引擎...')
    worker.value = await createWorker('chi_sim', OEM.LSTM_ONLY, {
      corePath: prefix + 'tesseract.js-core',
      langPath: prefix + '4.0.0_best_int',
      workerPath: prefix + 'worker.min.js'
    })
    console.log('OCR 引擎初始化成功')
  } catch (error) {
    console.error('OCR 引擎初始化失败:', error)
  }
})

// 组件卸载时移除事件监听（防止内存泄漏）
onUnmounted(async () => {
  if (ipcRenderer) {
    ipcRenderer.removeListener('pdf-load', handlePdfLoad)
    ipcRenderer.removeListener('pdf-error', handlePdfError)
    ipcRenderer.removeListener('pdf-loading', handlePdfLoading)
  }
  await worker.value?.terminate()
})
</script>

<style scoped>
.pdf-reader {
  height: 100vh;
  width: 100vw;
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  background: snow;
}
.pdf-toolbar {
  background: #f5f5f5;
  padding: 10px 24px 10px 24px;
  border-bottom: 1px solid #ddd;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
}
.pdf-title {
  font-weight: bold;
  color: #333;
  font-size: 20px;
}
.print-btn {
  margin-left: 20px;
  padding: 7px 24px;
  background: #007bff;
  color: #fff;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 500;
  transition: background 0.2s;
}
.print-btn:hover {
  background: #0056b3;
}

.print-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
  opacity: 0.6;
}

.print-btn:disabled:hover {
  background: #ccc;
}
.param-info {
  padding: 0 0 0 0;
  background: transparent;
  border-bottom: none;
  font-size: 14px;
  min-height: 0;
}
.param-info.no-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  background: transparent;
  margin-top: 40px;
}
.pdf-container {
  flex: 1;
  width: 100vw;
  height: 100%;
  position: relative;
  overflow: hidden;
  margin: 0;
  padding: 0;
  background: none;
  display: flex;
  flex-direction: column;
}
.pdf-container.no-content {
  background: none;
}
.pdf-iframe {
  width: 100vw;
  height: 100%;
  border: none;
  margin: 0;
  padding: 0;
  display: block;
  background: #222;
}
/* 空内容、错误提示和加载提示美化 */
.empty-tip,
.error-tip,
.loading-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-top: 60px;
  margin-bottom: 40px;
}
.empty-icon {
  font-size: 54px;
  color: #bbb;
  margin-bottom: 12px;
}
.empty-text {
  color: #888;
  font-size: 18px;
  font-weight: 500;
}
.error-tip {
  color: #f44336;
}
.error-icon {
  font-size: 48px;
  margin-bottom: 10px;
}
.error-text {
  font-size: 17px;
  font-weight: 500;
  color: #f44336;
}

.loading-icon {
  font-size: 48px;
  margin-bottom: 10px;
  animation: spin 2s linear infinite;
}

.loading-text {
  font-size: 17px;
  font-weight: 500;
  color: #2196f3;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* OCR对话框样式 */
.ocr-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999; /* 提高层级，确保在所有元素之上 */
}

.ocr-dialog {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  min-height: 400px;
  display: flex;
  flex-direction: column;
}

.ocr-dialog-header {
  padding: 20px 24px 0 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #eee;
  padding-bottom: 16px;
}

.ocr-dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.ocr-dialog-close {
  background: none;
  border: none;
  font-size: 24px;
  color: #999;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.ocr-dialog-close:hover {
  background-color: #f5f5f5;
  color: #666;
}

.ocr-dialog-content {
  padding: 20px 24px;
  flex: 1;
  min-height: 200px;
  max-height: 400px;
}

.ocr-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
}

.ocr-loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.ocr-loading-text {
  color: #666;
  font-size: 16px;
}

.ocr-text-container {
  width: 100%;
}

.ocr-text {
  white-space: pre-line;
  line-height: 1.6;
  color: #333;
  font-size: 14px;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 8px; /* 为滚动条留出空间 */
}

.ocr-copy-btn {
  padding: 8px 16px;
  background: #28a745;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
  margin-right: 12px;
}

.ocr-copy-btn:hover {
  background: #218838;
}

.ocr-copy-btn:active {
  background: #1e7e34;
}

.ocr-dialog-footer {
  padding: 16px 24px 20px 24px;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}

.ocr-dialog-btn {
  padding: 8px 24px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
}

.ocr-dialog-btn:hover {
  background: #0056b3;
}

/* 截图工具面板样式 */
:global(#toolPanel),
:global(#optionPanel) {
  border-radius: 6px;
  height: auto !important;
}

:global(#toolPanel .ocr) {
  background-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIGZpbGw9ImN1cnJlbnRDb2xvciIgZD0iTTkuOTUyIDYuMjVjLS40MyAwLS44MzIgMC0xLjE2LjA0OWMtLjM3MS4wNTUtLjc1Mi4xODYtMS4wNTcuNTI1Yy0uMjk0LjMyNy0uMzk4LjcxNy0uNDQzIDEuMDg5Yy0uMDQyLjM0OC0uMDQyLjc4LS4wNDIgMS4yNjd2LjU3YS43NS43NSAwIDAgMCAxLjUgMHYtLjUyOGMwLS41NDMuMDAxLS44ODIuMDMxLTEuMTI5YS45NzYuOTc2IDAgMCAxIC4wNDYtLjIyYS4xMzMuMTMzIDAgMCAxIC4wMjMtLjA0NmguMDAxYy4wMDEtLjAwMi4wMDItLjAwMy4wMTEtLjAwOGEuNTkyLjU5MiAwIDAgMSAuMTUyLS4wMzdjLjIwNC0uMDMuNDkxLS4wMzIuOTg2LS4wMzJoMS4yNXY4LjVIOS41YS43NS43NSAwIDAgMCAwIDEuNUgxNWEuNzUuNzUgMCAwIDAgMC0xLjVoLTIuMjV2LTguNUgxNGMuNDk1IDAgLjc4Mi4wMDIuOTg2LjAzMmMuMDkyLjAxNC4xMzUuMDMuMTUyLjAzN2wuMDExLjAwN3YuMDAxYS4xMy4xMyAwIDAgMSAuMDI0LjA0NWMuMDE0LjAzOC4wMzIuMTA1LjA0Ni4yMjFjLjAzLjI0Ny4wMzEuNTg2LjAzMSAxLjEzdi41MjdhLjc1Ljc1IDAgMCAwIDEuNSAwdi0uNTdjMC0uNDg4IDAtLjkxOS0uMDQyLTEuMjY3Yy0uMDQ1LS4zNzItLjE0OS0uNzYyLS40NDMtMS4wOWMtLjMwNS0uMzM4LS42ODYtLjQ2OS0xLjA1Ny0uNTI0Yy0uMzI4LS4wNS0uNzMtLjA1LTEuMTYtLjA0OXoiLz48cGF0aCBmaWxsPSJjdXJyZW50Q29sb3IiIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTExLjk0MyAxLjI1Yy0yLjMwOSAwLTQuMTE4IDAtNS41My4xOWMtMS40NDQuMTk0LTIuNTg0LjYtMy40NzkgMS40OTRjLS44OTUuODk1LTEuMyAyLjAzNS0xLjQ5NCAzLjQ4Yy0uMTkgMS40MTEtLjE5IDMuMjItLjE5IDUuNTI5di4xMTRjMCAyLjMwOSAwIDQuMTE4LjE5IDUuNTNjLjE5NCAxLjQ0NC42IDIuNTg0IDEuNDk0IDMuNDc5Yy44OTUuODk1IDIuMDM1IDEuMyAzLjQ4IDEuNDk0YzEuNDExLjE5IDMuMjIuMTkgNS41MjkuMTloLjExNGMyLjMwOSAwIDQuMTE4IDAgNS41My0uMTljMS40NDQtLjE5NCAyLjU4NC0uNiAzLjQ3OS0xLjQ5NGMuODk1LS44OTUgMS4zLTIuMDM1IDEuNDk0LTMuNDhjLjE5LTEuNDExLjE5LTMuMjIuMTktNS41Mjl2LS4xMTRjMC0yLjMwOSAwLTQuMTE4LS4xOS01LjUzYy0uMTk0LTEuNDQ0LS42LTIuNTg0LTEuNDk0LTMuNDc5Yy0uODk1LS44OTUtMi4wMzUtMS4zLTMuNDgtMS40OTRjLTEuNDExLS4xOS0zLjIyLS4xOS01LjUyOS0uMTl6TTMuOTk1IDMuOTk1Yy41Ny0uNTcgMS4zNC0uODk3IDIuNjE5LTEuMDY5YzEuMy0uMTc0IDMuMDA4LS4xNzYgNS4zODYtLjE3NnM0LjA4Ni4wMDIgNS4zODYuMTc2YzEuMjc5LjE3MiAyLjA1LjUgMi42MiAxLjA2OWMuNTY5LjU3Ljg5NiAxLjM0IDEuMDY4IDIuNjE5Yy4xNzQgMS4zLjE3NiAzLjAwOC4xNzYgNS4zODZzLS4wMDIgNC4wODYtLjE3NiA1LjM4NmMtLjE3MiAxLjI3OS0uNSAyLjA1LTEuMDY5IDIuNjJjLS41Ny41NjktMS4zNC44OTYtMi42MTkgMS4wNjhjLTEuMy4xNzQtMy4wMDguMTc2LTUuMzg2LjE3NnMtNC4wODYtLjAwMi01LjM4Ni0uMTc2Yy0xLjI3OS0uMTcyLTIuMDUtLjUtMi42Mi0xLjA2OWMtLjU2OS0uNTctLjg5Ni0xLjM0LTEuMDY4LTIuNjE5Yy0uMTc0LTEuMy0uMTc2LTMuMDA4LS4xNzYtNS4zODZzLjAwMi00LjA4Ni4xNzYtNS4zODZjLjE3Mi0xLjI3OS41LTIuMDUgMS4wNjktMi42MiIgY2xpcC1ydWxlPSJldmVub2RkIi8+PC9zdmc+);
  background-size: cover;
}

:global(#toolPanel .ocr:hover) {
  background-image: url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIGZpbGw9IiMxMWI2ZjUiIGQ9Ik05Ljk1MiA2LjI1Yy0uNDMgMC0uODMyIDAtMS4xNi4wNDljLS4zNzEuMDU1LS43NTIuMTg2LTEuMDU3LjUyNWMtLjI5NC4zMjctLjM5OC43MTctLjQ0MyAxLjA4OWMtLjA0Mi4zNDgtLjA0Mi43OC0uMDQyIDEuMjY3di41N2EuNzUuNzUgMCAwIDAgMS41IDB2LS41MjhjMC0uNTQzLjAwMS0uODgyLjAzMS0xLjEyOWEuOTc2Ljk3NiAwIDAgMSAuMDQ2LS4yMmEuMTMzLjEzMyAwIDAgMSAuMDIzLS4wNDZoLjAwMWMuMDAxLS4wMDIuMDAyLS4wMDMuMDExLS4wMDhhLjU5Mi41OTIgMCAwIDEgLjE1Mi0uMDM3Yy4yMDQtLjAzLjQ5MS0uMDMyLjk4Ni0uMDMyaDEuMjV2OC41SDkuNWEuNzUuNzUgMCAwIDAgMCAxLjVIMTVhLjc1Ljc1IDAgMCAwIDAtMS41aC0yLjI1di04LjVIMTRjLjQ5NSAwIC43ODIuMDAyLjk4Ni4wMzJjLjA5Mi4wMTQuMTM1LjAzLjE1Mi4wMzdsLjAxMS4wMDd2LjAwMWEuMTMuMTMgMCAwIDEgLjAyNC4wNDVjLjAxNC4wMzguMDMyLjEwNS4wNDYuMjIxYy4wMy4yNDcuMDMxLjU4Ni4wMzEgMS4xM3YuNTI3YS43NS43NSAwIDAgMCAxLjUgMHYtLjU3YzAtLjQ4OCAwLS45MTktLjA0Mi0xLjI2N2MtLjA0NS0uMzcyLS4xNDktLjc2Mi0uNDQzLTEuMDljLS4zMDUtLjMzOC0uNjg2LS40NjktMS4wNTctLjUyNGMtLjMyOC0uMDUtLjczLS4wNS0xLjE2LS4wNDl6Ii8+PHBhdGggZmlsbD0iIzExYjZmNSIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMTEuOTQzIDEuMjVjLTIuMzA5IDAtNC4xMTggMC01LjUzLjE5Yy0xLjQ0NC4xOTQtMi41ODQuNi0zLjQ3OSAxLjQ5NGMtLjg5NS44OTUtMS4zIDIuMDM1LTEuNDk0IDMuNDhjLS4xOSAxLjQxMS0uMTkgMy4yMi0uMTkgNS41Mjl2LjExNGMwIDIuMzA5IDAgNC4xMTguMTkgNS41M2MuMTk0IDEuNDQ0LjYgMi41ODQgMS40OTQgMy40NzljLjg5NS44OTUgMi4wMzUgMS4zIDMuNDggMS40OTRjMS40MTEuMTkgMy4yMi4xOSA1LjUyOS4xOWguMTE0YzIuMzA5IDAgNC4xMTggMCA1LjUzLS4xOWMxLjQ0NC0uMTk0IDIuNTg0LS42IDMuNDc5LTEuNDk0Yy44OTUtLjg5NSAxLjMtMi4wMzUgMS40OTQtMy40OGMuMTktMS40MTEuMTktMy4yMi4xOS01LjUyOXYtLjExNGMwLTIuMzA5IDAtNC4xMTgtLjE5LTUuNTNjLS4xOTQtMS40NDQtLjYtMi41ODQtMS40OTQtMy40NzljLS44OTUtLjg5NS0yLjAzNS0xLjMtMy40OC0xLjQ5NGMtMS40MTEtLjE5LTMuMjItLjE5LTUuNTI5LS4xOXpNMy45OTUgMy45OTVjLjU3LS41NyAxLjM0LS44OTcgMi42MTktMS4wNjljMS4zLS4xNzQgMy4wMDgtLjE3NiA1LjM4Ni0uMTc2czQuMDg2LjAwMiA1LjM4Ni4xNzZjMS4yNzkuMTcyIDIuMDUuNSAyLjYyIDEuMDY5Yy41NjkuNTcuODk2IDEuMzQgMS4wNjggMi42MTljLjE3NCAxLjMuMTc2IDMuMDA4LjE3NiA1LjM4NnMtLjAwMiA0LjA4Ni0uMTc2IDUuMzg2Yy0uMTcyIDEuMjc5LS41IDIuMDUtMS4wNjkgMi42MmMtLjU3LjU2OS0xLjM0Ljg5Ni0yLjYxOSAxLjA2OGMtMS4zLjE3NC0zLjAwOC4xNzYtNS4zODYuMTc2cy00LjA4Ni0uMDAyLTUuMzg2LS4xNzZjLTEuMjc5LS4xNzItMi4wNS0uNS0yLjYyLTEuMDY5Yy0uNTY5LS41Ny0uODk2LTEuMzQtMS4wNjgtMi42MTljLS4xNzQtMS4zLS4xNzYtMy4wMDgtLjE3Ni01LjM4NnMuMDAyLTQuMDg2LjE3Ni01LjM4NmMuMTcyLTEuMjc5LjUtMi4wNSAxLjA2OS0yLjYyIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiLz48L3N2Zz4=);
}

/* 确保截图工具面板在顶层显示，但低于OCR对话框 */
:global(#toolPanel) {
  z-index: 10000 !important;
}

:global(#optionPanel) {
  z-index: 10000 !important;
}
</style>
