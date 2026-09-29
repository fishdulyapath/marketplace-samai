// รูปแทนเมื่อสินค้าไม่มีภาพ
//
// เดิมทุกจุดชี้ไป https://upload.wikimedia.org/.../No_Image_Available.jpg (9 จุดทั่วโปรเจกต์)
// ซึ่งหมายถึงยิง request ออก internet ทุกครั้งที่รูปสินค้าหาย และหน้าจะพังถ้าลูกค้า
// อยู่หลัง firewall หรือใช้งานออฟไลน์ — เป็น data URI จึงไม่มี network request เลย
//
// ใช้ currentColor ไม่ได้ใน data URI จึงฝังสีกลางๆ ที่เข้ากับทั้งธีมสว่างและเข้ม
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="no image">
<rect width="160" height="160" fill="#f1f4f6"/>
<rect x="34" y="46" width="92" height="68" rx="6" fill="none" stroke="#c3ccd4" stroke-width="3"/>
<circle cx="60" cy="70" r="8" fill="#c3ccd4"/>
<path d="M40 106l26-26 18 18 14-12 20 20z" fill="#c3ccd4"/>
</svg>`;

export const PRODUCT_IMAGE_PLACEHOLDER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PLACEHOLDER_SVG)}`;

export function getProductImagePlaceholder() {
    return PRODUCT_IMAGE_PLACEHOLDER;
}
