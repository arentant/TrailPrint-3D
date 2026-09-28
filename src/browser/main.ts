import { createBrowserApi } from './client'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import BrowserApp from './BrowserApp.vue'
import 'leaflet/dist/leaflet.css'
import '../styles/global.css'

window.trailPrint = createBrowserApi()
createApp(BrowserApp).use(createPinia()).mount('#app')
