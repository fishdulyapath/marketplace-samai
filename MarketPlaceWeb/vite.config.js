import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'url';
import { defineConfig, splitVendorChunkPlugin } from 'vite';

export default defineConfig({
    plugins: [vue(), splitVendorChunkPlugin()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            vue: 'vue/dist/vue.esm-bundler.js'
        }
    },
    server: {
        port: 8080
    },
    base: '/'
});
