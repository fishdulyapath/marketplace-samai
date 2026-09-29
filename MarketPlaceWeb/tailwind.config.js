/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['selector', '[class*="app-dark"]'],
    content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
    plugins: [require('tailwindcss-primeui')],
    theme: {
        // ⚠️ ห้ามแก้ค่า sm/md/lg/xl/2xl ที่มีอยู่ — utility class ถูกใช้ทั่วโปรเจกต์
        //    ขยับ 1 ค่าแล้ว layout จะเพี้ยนในหน้าที่ไม่ได้แตะ
        //    เพิ่ม xs ได้เพราะยังไม่มีใครใช้ (มาแทน media query 480px ที่เขียนมือ)
        screens: {
            xs: '420px',
            sm: '576px',
            md: '768px',
            lg: '992px',
            xl: '1200px',
            '2xl': '1920px'
        }
    }
};
