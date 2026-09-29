import { onBeforeUnmount, readonly, ref } from 'vue';

// จุดตัดขนาดจอชุดเดียวของทั้งแอป — ต้องตรงกับ tailwind.config.js และ _breakpoints.scss
// ก่อนหน้านี้มี 3 ระบบขนานกัน: Tailwind (sm=576), media query เขียนมือ (640/900/1024)
// และ JS `innerWidth` (640/991) ทำให้ CSS กับ JS ตัดสินคนละจุดในจอเดียวกัน
export const BREAKPOINTS = {
    xs: 420,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
    '2xl': 1920,
};

// ใช้ matchMedia แทน innerWidth + resize listener เพราะ browser แจ้งเฉพาะตอนข้ามเส้นจริง
// ไม่ต้อง throttle เอง และไม่อ่าน layout ทุก event (กัน layout thrash)
function useMediaQuery(query) {
    const matches = ref(false);
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return readonly(matches);
    }

    const mql = window.matchMedia(query);
    matches.value = mql.matches;
    const onChange = (event) => {
        matches.value = event.matches;
    };

    // Safari < 14 ไม่มี addEventListener บน MediaQueryList
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else mql.addListener(onChange);

    onBeforeUnmount(() => {
        if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
        else mql.removeListener(onChange);
    });

    return readonly(matches);
}

// -0.02px กันช่องว่าง 1px ที่ขอบ (จอกว้าง 991.5px ต้องยังนับเป็น mobile)
export function useBreakpointDown(name) {
    const px = BREAKPOINTS[name];
    if (!px) throw new Error(`unknown breakpoint: ${name}`);
    return useMediaQuery(`(max-width: ${px - 0.02}px)`);
}

export function useBreakpointUp(name) {
    const px = BREAKPOINTS[name];
    if (!px) throw new Error(`unknown breakpoint: ${name}`);
    return useMediaQuery(`(min-width: ${px}px)`);
}

// 🚨 สองตัวนี้คนละความหมาย อย่าสลับกัน:
//    isMobileNav   = ใช้สลับแถบเมนู (บน ↔ ล่าง)
//    isSmallScreen = ใช้ตัดสินพฤติกรรมของจอแคบจริงๆ เช่น กดตะกร้าแล้วไปหน้า /cart แทนเปิด MiniCart
//                    ถ้าเอา isMobileNav ไปใช้แทน แท็บเล็ตจะเลิกเห็น MiniCart โดยไม่ตั้งใจ
export function useIsMobileNav() {
    return useBreakpointDown('lg');
}

export function useIsSmallScreen() {
    return useBreakpointDown('sm');
}
