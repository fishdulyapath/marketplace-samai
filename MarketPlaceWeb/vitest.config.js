import { fileURLToPath, URL } from 'url';
import { defineConfig } from 'vitest/config';

// แยกจาก vite.config.js เพื่อไม่ให้ config ของ build ที่ใช้งานอยู่เปลี่ยนแปลง
export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.js']
    }
});
