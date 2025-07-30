<template>
  <div class="print-dialog-mask">
    <div class="print-dialog">
      <h3>打印设置</h3>
      <!-- 加载状态 -->
      <div v-if="isLoadingPrinters" class="loading-tip">
        <p>正在获取打印机列表...</p>
      </div>
      <!-- 错误提示 -->
      <div v-if="printerError" class="error-tip">
        <p>{{ printerError }}</p>
      </div>
      <!-- 正常表单（打印机列表加载完成） -->
      <template v-if="!isLoadingPrinters && !printerError">
        <div class="form-item">
          <label>打印机：</label>
          <select 
            v-model="printer" 
            :disabled="printers.length === 0"
            class="form-control"
          >
            <!-- 有打印机时渲染列表 -->
            <option 
              v-for="p in printers" 
              :key="p.name" 
              :value="p.name"
            >
              {{ p.name }} 
              <!-- 状态提示（可选，若主进程返回了状态） -->
              <span 
                class="printer-status" 
                :class="{ 
                  online: p.statusText === '在线', 
                  offline: p.statusText === '离线' 
                }"
              >
                ({{ p.statusText }})
              </span>
            </option>
            <!-- 无打印机时兜底 -->
            <option 
              v-if="printers.length === 0" 
              value="" 
              disabled
            >
              无可用打印机
            </option>
          </select>
        </div>
        <div class="form-item">
          <label>份数：</label>
          <input 
            type="number" 
            v-model.number="copies" 
            min="1" 
            :disabled="printers.length === 0"
            class="form-control"
          />
        </div>
        <div class="form-item">
          <label>单双面：</label>
          <select 
            v-model="duplex" 
            :disabled="printers.length === 0"
            class="form-control"
          >
            <option value="simplex">单面</option>
            <option value="duplex">双面</option>
          </select>
        </div>
        <div class="button-row">
          <button 
            @click="onPrint" 
            :disabled="printers.length === 0"
            class="btn confirm-btn"
          >
            确定
          </button>
          <button 
            @click="$emit('close')" 
            class="btn cancel-btn"
          >
            取消
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

// 打印机列表 & 状态
const printers = ref([])
const isLoadingPrinters = ref(true)
const printerError = ref('')

// 打印参数
const printer = ref('')
const copies = ref(1)
const duplex = ref('simplex')

// 初始化：获取打印机列表
onMounted(async () => {
  if (window.electron && window.electron.ipcRenderer) {
    try {
      isLoadingPrinters.value = true
      const printerList = await window.electron.ipcRenderer.invoke('get-printers')
      printers.value = printerList
      // 优先选默认打印机
      const defaultPrinter = printers.value.find(p => p.isDefault)
      printer.value = defaultPrinter ? defaultPrinter.name : (printers.value[0]?.name || '')
    } catch (err) {
      printerError.value = `获取打印机失败：${err.message || '未知错误'}`
      console.error('获取打印机列表失败：', err)
    } finally {
      isLoadingPrinters.value = false
    }
  } else {
    isLoadingPrinters.value = false
    printerError.value = '无法连接到打印服务'
  }
})

// 事件发射
const emit = defineEmits(['close', 'print'])

// 触发打印
function onPrint() {
  if (!printer.value) {
    alert('请选择打印机')
    return
  }
  emit('print', {
    printer: printer.value,
    copies: copies.value,
    duplex: duplex.value
  })
  emit('close')
}

async function testPrintLoad() {
  if (window.electron && window.electron.ipcRenderer) {
    const fileUrl = 'https://arxiv.org/pdf/2507.22052.pdf' // 测试用的PDF文件URL;
    try {
      // 传递 fileUrl 给主进程
      const result = await window.electron.ipcRenderer.invoke('test-print-load', fileUrl); 
      if (result.success) {
        console.log('测试打印加载成功');
      } else {
        console.error('测试打印加载失败：', result.error);
      }
    } catch (err) {
      console.error('测试打印加载失败：', err);
    }
  } else {
    console.warn('无法连接到打印服务');
  }
}
</script>

<style scoped>
/* 遮罩层 */
.print-dialog-mask {
  position: fixed; 
  left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.3); 
  z-index: 9999;
  display: flex; 
  align-items: center; 
  justify-content: center;
}

/* 弹窗容器 */
.print-dialog {
  background: #fff;
  padding: 24px 32px;
  border-radius: 8px;
  min-width: 400px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 标题 */
.print-dialog h3 {
  margin: 0;
  font-size: 18px;
  color: #333;
  font-weight: 600;
}

/* 表单行 */
.form-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 标签样式 */
.form-item label {
  width: 70px;
  color: #666;
  font-size: 14px;
  text-align: right;
}

/* 输入框/选择框通用样式 */
.form-control {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #dcdcdc;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}
.form-control:focus {
  border-color: #409eff;
}

/* 打印机状态提示（可选） */
.printer-status {
  font-size: 12px;
  color: #999;
  margin-left: 4px;
}
.printer-status.online {
  color: #4caf50; /* 在线绿色 */
}
.printer-status.offline {
  color: #f44336; /* 离线红色 */
}

/* 按钮行 */
.button-row {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* 按钮通用样式 */
.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

/* 确认按钮 */
.confirm-btn {
  background: #409eff;
  color: #fff;
}
.confirm-btn:hover {
  background: #66b1ff;
}
.confirm-btn:disabled {
  background: #bfdbf7;
  cursor: not-allowed;
}

/* 取消按钮 */
.cancel-btn {
  background: #f4f4f4;
  color: #666;
  border: 1px solid #dcdcdc;
}
.cancel-btn:hover {
  background: #f8f8f8;
}

/* 加载提示 */
.loading-tip {
  color: #999;
  text-align: center;
  padding: 20px 0;
}

/* 错误提示 */
.error-tip {
  color: #f44336;
  text-align: center;
  padding: 20px 0;
}
</style>