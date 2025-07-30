import { createRouter, createWebHashHistory } from 'vue-router'
import PdfReader from '../components/PdfReader.vue'

const routes = [
  {
    path: '/pdf-reader',
    name: 'PdfReader',
    component: PdfReader
  },
  {
    path: '/:catchAll(.*)',
    redirect: '/pdf-reader'
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router 