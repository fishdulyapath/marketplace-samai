// กติกาการเลือก section สินค้าบนหน้าแรก (แยกออกจาก Landing.vue เพื่อให้เทสต์ได้)
//
// ของเดิมยัด section 'new' + 'recommend' กลับมาเสมอแม้แอดมินลบทิ้งไปแล้ว
// ทำให้ยิง API เปล่าทุกครั้งที่โหลดหน้าแรก และได้กล่องหัวข้อว่างถ้าไม่มีสินค้าติดธง feature_type
//
// กติกาใหม่: แอดมินตั้งค่าไว้แล้ว = มีเจตนา ไม่ยัดอะไรกลับ
//            ยังไม่เคยตั้งค่าเลย = ใส่ค่าเริ่มต้นให้มีอะไรแสดง
export function resolveHomeProductSections(sections, createDefaultSection) {
    const source = Array.isArray(sections) ? [...sections] : [];
    if (source.length > 0) return source;
    if (typeof createDefaultSection !== 'function') return [];
    return [createDefaultSection('new'), createDefaultSection('recommend')];
}
