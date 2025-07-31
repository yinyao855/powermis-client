<template>
  <div class="pdf-reader">
    <div class="pdf-toolbar">
      <span class="pdf-title">PDF阅读器</span>
      <button v-if="fileUrl && !errorMessage && !isLoading" class="print-btn" @click="handlePrint">
        打印
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import PrintDialog from './PrintDialog.vue'

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
onMounted(() => {
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
})

// 组件卸载时移除事件监听（防止内存泄漏）
onUnmounted(() => {
  if (ipcRenderer) {
    ipcRenderer.removeListener('pdf-load', handlePdfLoad)
    ipcRenderer.removeListener('pdf-error', handlePdfError)
    ipcRenderer.removeListener('pdf-loading', handlePdfLoading)
  }
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
</style>
