import { contextBridge, ipcRenderer, app } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import path from 'path'

// Custom APIs for renderer
const api = {
  // PDF相关API
  openPdf: (url, title) => ipcRenderer.invoke('open-pdf', { url, title }),
  downloadPdf: (articleId, articleType, backendUrl) => ipcRenderer.invoke('download-pdf', { articleId, articleType, backendUrl }),
  getResourcesPath: () => {
    const devPath = path.join(__dirname, '..', 'resources');
    const prodPath = path.join(app.getAppPath(), '..', 'resources');
    return app.isPackaged ? prodPath : devPath;
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
