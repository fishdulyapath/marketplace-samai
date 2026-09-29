# แผนเพิ่มระบบของแถม (Sale Premium) เข้า MarketPlace

## ที่มา

`โปรเจคตัวอย่าง/smlstaff-ubon` มีระบบของแถมที่เขียนขึ้นเอง ไม่มีใน C# SML ERP ต้นฉบับ เอกสารนี้คือแผนย้ายเฉพาะ**ฝั่งขาย** เข้ามาใน MarketPlace

ผลตรวจฐาน `wawacrm` ที่ทำให้แผนนี้เป็นไปได้:

| สิ่งที่ตรวจ | ผล |
|---|---|
| `ic_trans_detail.is_permium` | **มีอยู่แล้ว** (smallint) และมีข้อมูลจริง 21 แถวที่ `= 1` — C# ERP ใช้ช่องนี้อยู่ |
| `ic_purchase_permium*` (ฝั่งซื้อ) | มีครบ 3 ตาราง — มาจาก C# ERP |
| `sml_sale_premium*` (ฝั่งขาย) | ยังไม่มี ต้องสร้าง |
| `staff_cart_order` | ยังไม่มีคอลัมน์ของแถม |
| `item_type` ที่ใช้อยู่ | 0 (15,509), 1 (17), 3 (60) — **`'4'` ว่าง ใช้ได้** |

แปลว่าของแถมที่ MarketPlace สร้างจะไหลเข้า ERP ได้ทันทีโดยไม่ต้องแปลงข้อมูล

---

## แนวคิดของระบบ

### โครงสร้าง — 1 โปรโมชันมี 2 ฝั่ง

```
sml_sale_premium              หัวโปรโมชัน + ช่วงวันที่ (important=0 = เปิดใช้)
├── _condition                ต้องซื้ออะไร เท่าไหร่   (ic_code, unit_code, qty)
└── _free_list                ได้แถมอะไร เท่าไหร่     (ic_code, unit_code, qty)
```

### เอนจินคำนวณ

```
sets = min( floor(จำนวนที่ซื้อ ÷ จำนวนที่กำหนด) )  ของทุก condition
ถ้า sets > 0  →  ของแถมแต่ละตัวได้ qty = qty_ที่กำหนด × sets
```

เป็น AND ทุกเงื่อนไข และ `min()` ทำให้จำนวนชุดถูกจำกัดด้วยตัวที่ซื้อน้อยสุด
(ต้นแบบ: `โปรเจคตัวอย่าง/MarketPlaceWebServiceExpress/src/routes/purchasePermium.js:355-388`)

### จุดออกแบบสำคัญ — ห่อโปรโมชันเป็น "สินค้าเสมือน"

ไม่ได้คำนวณของแถมตอน checkout แต่ทำโปรโมชันทั้งชุดให้เป็นสินค้า 1 รายการ (`salePremiumHelper.js:239-266`):

- `item_type = '4'`
- `price` = ผลรวมราคาของที่ต้องซื้อ
- `stock_qty` = `min(สต็อกแต่ละตัว ÷ จำนวนที่ต้องใช้)` — คำนวณสต็อกของทั้งชุดได้
- ตอนบันทึกจึงค่อยแตกกลับเป็นหลายบรรทัด

ข้อดี: ตะกร้า/รายการสินค้า/สต็อก จัดการของแถมด้วย code path เดียวกับสินค้าปกติ ไม่ต้องเขียน logic คู่ขนาน

### รูปแบบการต่อยอด — expand at the boundary

โปรเจคตัวอย่างใช้สำนวนเดียวกันทุกจุดที่ต้องการบรรทัดจริง:

```js
if (item?.sale_premium_code || String(item.item_type) === '4') {
  detailItems.push(...await expandSalePremiumItemForSave(query, item, ctx));
} else {
  detailItems.push(item);
}
```

พบที่ `cart.js:538`, `product.js:1053`, `pos.js:991` — **แผนนี้ยึดรูปแบบเดียวกัน**

---

## ลำดับความสำคัญ: ต้องปิดช่องราคาก่อน

จากการทดสอบจริงบนฐานทดสอบ ผมส่งสินค้าราคาจริง 92 บาทไปเป็น 1 บาท **ระบบบันทึกเป็น 1 บาท** — `sendorder` เชื่อราคาจาก client ทั้งหมด

โปรเจคตัวอย่างรู้ปัญหานี้และเขียนกันไว้แล้ว (`purchase.js:87`):
> *ของแถม (is_permium=1): บังคับ price/sum_amount = 0 ฝั่ง server กัน client ส่งผิด*

**ถ้าเพิ่มของแถมโดยไม่แก้เรื่องราคาก่อน จะเปิดช่องให้ตั้ง `is_permium=1` กับสินค้าทุกชิ้นเพื่อให้ราคาเป็น 0** เฟส 1 ด้านล่างจึงบังคับ ไม่ใช่ทางเลือก

---

## เฟส 1 — บังคับราคาของแถมฝั่ง server (ต้องทำก่อน)

ทำเฉพาะขอบเขตที่จำเป็นต่อของแถม ไม่ต้องรอ refactor การเงินทั้งระบบ (เฟส 4.2 ของแผนหลัก)

1. ใน `sendorder` ก่อนเขียน `ic_trans_detail` — ถ้าบรรทัดใดมี `is_permium === 1` ให้ **บังคับ** `price = 0`, `sum_amount = 0`, `discount_amount = 0` ทับค่าที่ client ส่งมาเสมอ
2. `is_permium` ต้องมาจากผลลัพธ์ของ `expandSalePremiumItemForSave()` ฝั่ง server **เท่านั้น** — ห้ามรับค่านี้จาก request โดยตรง ให้ลบทิ้งถ้า client ส่งมา
3. เพิ่ม test ยืนยันว่าส่ง `is_permium: 1` มากับสินค้าปกติแล้วไม่มีผล

**ไฟล์:** `src/routes/order.js`
**ตาข่าย:** characterization test 39 ข้อที่มีอยู่ต้องยังเขียว

---

## เฟส 2 — Schema

สร้าง migration จริง ไม่ใช้ `CREATE TABLE IF NOT EXISTS` ตอน runtime แบบต้นฉบับ (ระบบนี้มีปัญหา schema-by-side-effect อยู่แล้ว ไม่ควรเพิ่ม)

**ไฟล์ใหม่:** `src/db/migrations/create_sale_premium.sql`
ยกจาก `โปรเจคตัวอย่าง/MarketPlaceWebServiceExpress/src/db/migrations/create_sale_premium.sql` ได้เกือบทั้งไฟล์

```sql
CREATE TABLE IF NOT EXISTS sml_sale_premium (
  roworder SERIAL PRIMARY KEY,
  premium_code VARCHAR(25) NOT NULL,
  name_1 VARCHAR(255) NOT NULL,
  date_begin DATE, date_end DATE,
  important SMALLINT DEFAULT 0,          -- 0 = เปิดใช้
  remark VARCHAR(255) DEFAULT '',
  guid_code VARCHAR(50) DEFAULT '',
  creator_code VARCHAR(25) DEFAULT '',
  create_date_time_now TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS sml_sale_premium_code_uq ON sml_sale_premium (premium_code);

CREATE TABLE IF NOT EXISTS sml_sale_premium_condition (...);   -- ic_code, unit_code, qty, stand_value, divide_value
CREATE TABLE IF NOT EXISTS sml_sale_premium_free_list (...);   -- โครงเดียวกัน

ALTER TABLE staff_cart_order ADD COLUMN IF NOT EXISTS sale_premium_code VARCHAR(25) DEFAULT '';
ALTER TABLE staff_cart_order ADD COLUMN IF NOT EXISTS sale_premium_name VARCHAR(255) DEFAULT '';
ALTER TABLE staff_cart_order ADD COLUMN IF NOT EXISTS sale_premium_data TEXT DEFAULT '';
```

`ic_trans_detail.is_permium` **ไม่ต้องแตะ** — มีอยู่แล้ว

---

## เฟส 3 — Backend

### 3.1 ยก helper เข้ามา

**ไฟล์ใหม่:** `src/utils/salePremiumHelper.js` (~405 บรรทัด)

ยกจากโปรเจคตัวอย่างได้เกือบทั้งก้อน เพราะเรียกใช้ของที่ MarketPlace มีอยู่แล้ว: `getProductPriceLocalx()` และ `sml_ic_function_stock_balance_warehouse_location`

ต้องปรับ:
- ตัด `ensureSalePremiumSchema()` ออก (ย้ายไป migration ตามเฟส 2)
- `resolveBasketPricingContext` ซ้ำกับที่มีอยู่แล้วใน `product.js:759` และ `cart.js:18` — **อย่าก็อปเป็นตัวที่ 3** ให้ดึงตัวที่มีมาใช้ร่วม
- ให้เคารพ `stock_display_percent` จาก `marketplaceSalesSettings.js` เหมือน code path อื่นของ MarketPlace (ต้นฉบับไม่มีส่วนนี้)

ฟังก์ชันที่ใช้จริง:
| ฟังก์ชัน | หน้าที่ |
|---|---|
| `listSalePremiumProductsForSale()` | รายการโปรโมชันสำหรับหน้าร้าน |
| `loadSalePremiumDetail()` | รายละเอียด 1 โปรโมชัน + ราคา + สต็อกชุด |
| `expandSalePremiumItemForSave()` | แตกเป็นบรรทัดจริงตอนบันทึก |

### 3.2 Endpoint ใหม่

**ไฟล์ใหม่:** `src/routes/salePremium.js` mount ใน `index.js` ใต้ `/service/v1`

| Endpoint | ใช้โดย |
|---|---|
| `GET /sale-premium/list` | หน้าร้าน + หน้าแอดมิน |
| `GET /sale-premium/detail?premium_code=` | หน้ารายละเอียด |
| `POST /sale-premium/save` | แอดมิน |
| `POST /sale-premium/delete` | แอดมิน |

ตาม `.claude/rules/api-conventions.md`: endpoint ใหม่ที่ไม่มีคู่ใน Java ใช้ kebab-case ได้

### 3.3 ต่อเข้า flow เดิม

ใช้สำนวน expand-at-boundary ทุกจุด:

| ไฟล์ | จุด | สิ่งที่ทำ | สถานะ |
|---|---|---|---|
| `order.js` | `sendorder` ก่อน validate สต็อก | expand `item_type='4'` เป็นบรรทัดจริง (`expandOrderItems`) | **เสร็จเฟส 3** |
| `order.js` | `validateOrderStockAndPreorder` | ตรวจสต็อกจากบรรทัดที่ expand แล้ว | **เสร็จเฟส 3** |
| `order.js` | ตอน INSERT `ic_trans_detail` | เพิ่ม `is_permium` เป็นคอลัมน์ที่ 40 | **เสร็จเฟส 1** |
| `cart.js` | `getcartorder`, `validatecartstock`, `getcartorderprice` | expand ก่อนคำนวณ/แสดง | **เลื่อนไปเฟส 4** (endpoint เป็น SQL-CTE อ่าน staff_cart_order ตรง จะ testable เมื่อ frontend ใส่ของแถมลงตะกร้าได้) |
| `product.js` | `getProductList` | ผสมโปรโมชันเข้าไปในรายการสินค้า (`listSalePremiumProductsForSale`) | **เลื่อนไปเฟส 4** (display layer) |

> **เหตุผลที่แยก:** `sendorder` เป็น path ที่เชื่อถือได้และ re-validate สต็อกเอง — ต่อให้ frontend ยังไม่พร้อม เอกสารที่บันทึกก็ถูกต้องเสมอ ส่วน cart-read/product-list เป็น display ที่ต้องมี frontend ใส่ของแถมลงตะกร้าก่อนถึงจะทดสอบ end-to-end ได้ จึงรวมไว้เฟส 4

### การเขียน `ic_trans_detail` — ทำตาม smlstaff เป๊ะ (ตรวจโค้ดยืนยันแล้ว)

**smlstaff โยนเปลือกโปรโมชันทิ้งทั้งหมดตอน save เหลือแต่บรรทัดสินค้าจริง**

```
ตะกร้า:  [ โปรโมชัน A ]  item_type='4'  ราคา 200
                ↓  expandSalePremiumItemForSave()
ic_trans_detail:
  ├── สินค้า X  item_type=0  price=100  is_permium=0
  ├── สินค้า Y  item_type=0  price=100  is_permium=0
  └── ของแถม Z  item_type=0  price=0    is_permium=1   ← ร่องรอยเดียวที่เหลือ
```

หลักฐาน:

| ตรวจ | ผล | อ้างอิง |
|---|---|---|
| เขียน `item_type=4` ลง DB ไหม | **ไม่** — loop วน `detailItems` ที่ expand แล้ว | `pos.js:1219`, `salePremiumHelper.js:368-393` |
| แถวที่ expand มี `item_type` อะไร | ของสินค้าจริงจาก `ic_inventory.item_type` = 0 | `salePremiumHelper.js:100` |
| เขียน `sale_premium_code` ลง `ic_trans_detail` ไหม | **ไม่** — ไม่มีในรายการคอลัมน์ INSERT | `pos.js:1170-1177` |
| เขียนอะไรลง `sml_sale_premium*` ตอนขายไหม | **ไม่มีเลย** | — |
| ใช้คอลัมน์ใหม่ใน `ic_trans_detail` ไหม | **ไม่** — ใช้ `is_permium` ที่ ERP มีอยู่แล้ว | — |

เทียบกับชุดสินค้า (`item_type=3`) ที่**เขียน**บรรทัดหัวชุดลง DB จริง (`pos.js:1240`) — ของแถมจงใจทำต่างออกไป

**กติกาสำหรับ MarketPlace: ห้ามเขียนบรรทัด `item_type=4` ลง `ic_trans_detail` และห้ามเพิ่มคอลัมน์ใหม่ในตาราง ERP**
`item_type='4'` มีชีวิตอยู่แค่ใน `staff_cart_order` และ response ของ API เท่านั้น

**ผลต่อ ERP: ไม่มี** — C# ERP เห็นแค่บรรทัดสินค้าปกติ กับธง `is_permium=1` ที่ตัวเองใช้อยู่แล้ว (ฐาน `wawacrm` มีข้อมูลเดิม 21 แถว)

> **ข้อแลกเปลี่ยนที่ยอมรับแล้ว:** ออกแบบนี้ **ไม่มี audit trail** — ย้อนหลังบอกได้แค่ว่า "บรรทัดนี้เป็นของแถม" แต่บอกไม่ได้ว่ามาจากโปรโมชันไหน
> **ตัดสินแล้วว่ารับได้** (ข้อ 4 ในตารางข้อตัดสินใจ) จึงไม่ต้องมีตารางหรือคอลัมน์เพิ่มเพื่อการนี้

### 3.4 VAT ของของแถม

`calcOrderLineVat` ปัจจุบันคิด VAT จาก `sum_amount` ซึ่งของแถม = 0 → VAT = 0 โดยอัตโนมัติ **น่าจะถูกต้องอยู่แล้ว** แต่ต้องเพิ่ม test ยืนยัน เพราะ `tax_type` ยังติดมาจากสินค้าจริง

ตาข่าย: `tests/routes/orderMath.test.js` ที่มีอยู่

---

## เฟส 4 — Frontend

### 4.1 Service + utils

- **ไฟล์ใหม่:** `src/services/SalePremiumService.js`
  ตอนนี้ทุก service สร้าง axios instance เอง 20 ตัว — **อย่าสร้างตัวที่ 21** ให้รอ/ใช้ client กลางจากเฟส 1 ของแผนหลัก หรือใช้ `src/api/http.js` ที่มีอยู่
- `src/utils/preorderSplit.js` — รายการ `item_type='4'` ห้ามแยกบางส่วนระหว่างพร้อมส่ง/Preorder
  ถ้าชิ้นส่วนใดสต๊อกไม่ครบและทุกชิ้นเปิด Preorder ให้ย้ายโปรโมชั่นทั้งบรรทัดไปใบ Preorder

### 4.2 หน้าลูกค้า

| ไฟล์ | สิ่งที่ทำ |
|---|---|
| `components/catalog/ProductList.vue` | แสดงการ์ดโปรโมชันปนกับสินค้า ติดป้าย "ของแถม" |
| `views/pages/ProductDetail.vue` | แสดงว่าซื้ออะไรได้แถมอะไร |
| `components/cart/StepCart.vue` | แสดงบรรทัดของแถมแบบอ่านอย่างเดียว ราคา 0 |
| `components/cart/StepConfirmation.vue` | **ระวัง — 3,223 บรรทัดอยู่แล้ว** ควรแตกส่วนของแถมเป็น component แยกตั้งแต่แรก ไม่เพิ่มเข้าไปในไฟล์เดิม |

`isSetItem()` ถูกนิยามซ้ำ 6 ที่ในโค้ดเบส (`String(item?.item_type) === '3'`) — ตอนเพิ่ม `isPremiumItem()` **ให้สร้างที่เดียวใน `src/utils/` แล้วรวม `isSetItem` เข้ามาด้วย** อย่าซ้ำรอยเดิม

### 4.3 หน้าแอดมิน

**ไฟล์ใหม่:** `src/views/pages/admin/AdminSalePremium.vue`
ดัดแปลงจาก `โปรเจคตัวอย่าง/smlstaff-ubon/src/views/SalePremiumView.vue`

ต้องเพิ่ม:
- permission code ใหม่ `admin.salePremium` ใน `ADMIN_PERMISSION_CODES` **ทั้ง 2 ฝั่ง** (`MarketPlaceWeb/src/utils/adminPermissions.js` และ `MarketPlaceWebServiceExpress/src/utils/adminPermissions.js`) — ถ้าเพิ่มฝั่งเดียวจะถูก `normalizePermissions` กรองทิ้งเงียบๆ
- route ใน `router/index.js` พร้อม meta `adminPermission`
- ปุ่มใน `AdminMenu.vue`

> **หมายเหตุ:** ตอนนี้ backend ไม่บังคับ permission เลย หน้านี้จึงเปิดให้ใครก็เรียกได้จนกว่าจะทำเฟส 2 ของแผนหลัก

---

### 4.4 ช่องว่างที่ต้นฉบับ ubon ไม่มี — เพราะเป็นคนละประเภทระบบ

ubon เป็น **staff tool** (พนักงานขายหน้าร้าน) แต่ MarketPlace เป็น **หน้าร้านออนไลน์** จึงต้องการมากกว่า

| ประเด็น | ปัญหา | ต้องทำ |
|---|---|---|
| **รูปภาพโปรโมชัน** | `getProductImageUrl()` ดึงรูปจากตาราง `images` ด้วย `item_code` แต่ `premium_code` ไม่ใช่สินค้าจริง → **การ์ดโปรโมชันจะไม่มีรูป** | เพิ่ม `image_guid` ใน `sml_sale_premium` + reuse endpoint รูปเดิม หรือ fallback ใช้รูปของแถมชิ้นแรก |
| **ชื่อหลายภาษา** | `sml_sale_premium` มีแค่ `name_1` — MarketPlace รองรับ th/en/lo และ `languageDisplay.js` ใช้ `name_eng_1` → **โปรโมชันจะเป็นภาษาไทยเสมอ** | เพิ่ม `name_2`, `name_eng_1` ใน schema + ต่อ `withProductDisplay()` |
| **เปิด/ปิดทั้งระบบ** | ไม่มี feature flag | เพิ่ม key `sale_premium_enabled` ใน `marketplace_sales_setting` (ตารางมีอยู่แล้ว) + toggle ใน `AdminSalesSettings.vue` |
| **เลือกว่าโชว์บนเว็บไหม** | สินค้าปกติใช้ `item_pattern='[W]'` คุมการเข้าร่วม marketplace แต่โปรโมชันไม่มีกลไกนี้ | เพิ่มคอลัมน์ `show_on_web` ใน `sml_sale_premium` |
| **สินค้าของแถมไม่ได้เข้าร่วม marketplace** | ของแถมอาจเป็นสินค้าที่ `item_pattern <> '[W]'` (ไม่ขายออนไลน์) แต่ยังต้องแถมได้ | `expandSalePremiumItemForSave` ต้อง**ไม่**กรองด้วย `item_pattern` — ตรวจว่า query สต็อก/ราคาไม่กรองด้วย |

### 4.5 จุดแสดงผลที่ต้องแตะ (ครบทุกหน้า)

| หน้า / ไฟล์ | ต้องทำ | ความสำคัญ |
|---|---|---|
| `components/catalog/ProductList.vue` | การ์ดโปรโมชัน + badge "ของแถม" | **บังคับ** |
| `views/pages/ProductDetail.vue` | แสดงซื้ออะไรได้แถมอะไร | **บังคับ** |
| `components/cart/StepCart.vue` | บรรทัดของแถม ราคา 0 อ่านอย่างเดียว | **บังคับ** |
| `components/cart/StepConfirmation.vue` | สรุปก่อนยืนยัน — **แตก component แยก อย่าเพิ่มในไฟล์ 3,223 บรรทัด** | **บังคับ** |
| `views/pages/MiniCart.vue` | นับจำนวน/แสดงของแถมในตะกร้าลอย | **บังคับ** |
| `views/pages/OrderHistory.vue` | ประวัติต้องแสดงของแถม (ราคา 0) ไม่ใช่ซ่อนหรือแสดงเป็นสินค้าฟรีลอยๆ | **บังคับ** |
| `components/catalog/CategorySelection.vue` | โปรโมชันอยู่หมวดไหน — ต้องกำหนดกติกา | ควรมี |
| ค้นหาสินค้า | ค้นหาชื่อโปรโมชันเจอไหม | ควรมี |
| `views/pages/admin/AdminContent.vue` | `productSections` / `featuredProductCodes` เลือกด้วย `item_code` — **`premium_code` ไม่ใช่ item_code ต้องตรวจว่าพังไหม** | **ต้องตรวจ** |
| `views/pages/DocHistory.vue` | เอกสาร/ใบเสนอราคาแสดงของแถมยังไง | ควรมี |
| `views/pages/Landing.vue` | โชว์โปรโมชันหน้าแรกไหม | ทางเลือก |

### 4.6 ชื่อ `premium` ชนกัน — ต้องตั้งชื่อให้ชัด

โค้ด MarketPlace ปัจจุบัน**มีคำว่า `premium` อยู่แล้ว แต่คนละความหมาย** — เป็น query param `premium=1` ที่ `RecommendService.js` ใช้ดึง**สินค้าแนะนำ** ไม่เกี่ยวกับของแถม

**กติกา: ฝั่งของแถมใช้ `salePremium` / `sale_premium` เต็มเสมอ ห้ามย่อเป็น `premium` เฉยๆ**
(บังเอิญตรงกับที่ ubon ใช้อยู่แล้ว)

---

## เฟส 5 — ทดสอบ

### Unit test (backend)
- เอนจิน `sets = min(floor(ซื้อ ÷ ต้องการ))` — เคสครบ/ไม่ครบ/หลายเงื่อนไข/qty เป็น 0
- `expandSalePremiumItemForSave()` — ของแถมได้ `price=0`, `is_permium=1` เสมอ
- **เคสความปลอดภัย:** ส่ง `is_permium: 1` มากับสินค้าปกติ → ต้องไม่มีผล

### Unit test (frontend)
- `preorderSplit` ย้าย `item_type='4'` ทั้งบรรทัดไป Preorder เมื่อของไม่ครบ และบล็อกเมื่อชิ้นส่วนใดไม่เปิด Preorder

### Integration (ฐานทดสอบ wawacrm)
1. สร้างโปรโมชันทดสอบ → เพิ่มลงตะกร้า → `sendorder`
2. ตรวจ `ic_trans_detail`: ของที่ซื้อ `is_permium=0` ราคาปกติ / ของแถม `is_permium=1` ราคา 0
3. ยอดรวมเอกสารต้องไม่รวมของแถม
4. สต็อกของแถมถูกตัด
5. **ทดสอบโจมตี:** ส่งของแถมพร้อมราคา 999 → server ต้องบังคับเป็น 0

ใช้โครงเดียวกับ `e2e.js` ที่เขียนไว้แล้ว (32 checks) ต่อยอดได้เลย

---

## ประเมินงาน

| เฟส | งาน | เวลา |
|---|---|---|
| 1 | บังคับราคาฝั่ง server | 0.5 วัน |
| 2 | Migration | 0.5 วัน |
| 3 | Backend (helper + endpoint + ต่อ flow) | 2–3 วัน |
| 4 | Frontend (ลูกค้า + แอดมิน + ช่องว่าง 4.4–4.6) | 5–8 วัน |
| 5 | ทดสอบ | 1–2 วัน |
| | **รวม** | **9–14 วัน** |

> ประเมินเดิม 7–11 วัน **ต่ำไป** เพราะยังไม่ได้นับเรื่องรูปภาพ, i18n, feature flag และหน้าแสดงผลอีก 6 หน้า (ดู 4.4–4.6)

---

## ความเสี่ยงที่ต้องเฝ้า

| ความเสี่ยง | ผลกระทบ | การรับมือ |
|---|---|---|
| **ปลอมของแถมเพื่อให้ราคาเป็น 0** | สูงมาก | เฟส 1 บังคับก่อน — ห้ามข้าม |
| ~~C# ERP อ่านบรรทัด `item_type=4` ไม่ออก~~ | — | **ปิดประเด็นแล้ว** — smlstaff ไม่เขียนบรรทัดนี้ลง DB เลย ให้ทำตามเป๊ะ |
| ของแถมไม่ตัดสต็อก → แถมเกินของจริง | กลาง | expand ก่อน `validateOrderStockAndPreorder` |
| โปรโมชั่นถูกแยกซื้อ/แถมคนละเอกสาร | กลาง | คำนวณสต๊อกทั้งชุดและย้าย `item_type='4'` ทั้งบรรทัดไป Preorder + test |
| `StepConfirmation.vue` บวมกว่าเดิม | กลาง | แตก component แยกตั้งแต่แรก |
| `resolveBasketPricingContext` กลายเป็น 3 ชุด | ต่ำ | ใช้ตัวที่มีอยู่ อย่าก็อป |

---

## ขอบเขตผลกระทบต่อระบบหลัก

| ส่วน | กระทบไหม |
|---|---|
| ตาราง ERP (`ic_trans`, `ic_trans_detail`, `ic_inventory`, …) | **ไม่กระทบ** — ไม่เพิ่มคอลัมน์ ไม่เปลี่ยนความหมายเดิม ใช้ `is_permium` ที่ ERP ใช้อยู่แล้ว |
| ตารางใหม่ `sml_sale_premium*` | ตารางของ marketplace เอง ERP ไม่รู้จักและไม่ต้องรู้จัก |
| `staff_cart_order` +3 คอลัมน์ | ตารางของ marketplace เอง (สร้างจาก `001_marketplace_bootstrap.sql`) ไม่ใช่ตาราง ERP |
| C# SML ERP | **ไม่ต้องแก้อะไรเลย** |
| `sendorder` เดิม | เพิ่มสาขาใหม่ ของเดิมไม่เปลี่ยนพฤติกรรม — characterization test 39 ข้อเป็นตาข่าย |

---

## ข้อตัดสินใจทางธุรกิจ (สรุปแล้ว)

| # | คำถาม | คำตอบ | ผลต่อการทำ |
|---|---|---|---|
| 1 | ของแถมนับเป็นยอดขายไหม | **ไม่ต้องสนใจ ปล่อยตามกลไก SML ERP** แค่ใส่ธงลงไปให้ถูก | ไม่ต้องเขียน logic อะไรเพิ่ม |
| 2 | ลูกค้าปฏิเสธของแถมได้ไหม | **ไม่ได้** ของแถมมาอัตโนมัติ | ไม่ต้องมี flag ในตะกร้า UI แสดงแบบอ่านอย่างเดียว ลบ/แก้จำนวนไม่ได้ |
| 3 | โปรโมชันซ้อนกันได้ไหม | **ได้** | ตรงกับกลไกต้นฉบับ — ดูข้อควรระวังด้านล่าง |
| 4 | สืบย้อนว่ามาจากโปรโมชันไหน | **ไม่เอา** — แสดงเป็นสินค้าตาม `ic_trans_detail` ตรงๆ | ไม่ต้องมีตารางเพิ่ม ไม่ต้อง JOIN อะไร |

### ⚠ ชื่อคอลัมน์สะกดว่า `is_permium` ไม่ใช่ `is_premium`

ตรวจจากฐาน `wawacrm` แล้ว: `ic_trans_detail.is_permium` (smallint) — สะกดผิดมาแต่ต้นใน schema ของ ERP
**เขียนลง `is_premium` จะ error ทันที** โค้ดต้องใช้ `is_permium` ตามของเดิม

### ข้อ 3 — โปรโมชันซ้อนกัน: ต้องระบุให้ชัดว่า "ซ้อน" แบบไหน

กลไกต้นฉบับคำนวณแต่ละโปรโมชัน**แยกกันโดยอิสระ ไม่มีการหักยอดที่ใช้ไปแล้ว**

ตัวอย่าง: ซื้อสินค้า X จำนวน 10 ชิ้น มี 2 โปรโมชัน
- โปร A: ซื้อ X ครบ 10 → แถม Y 1 ชิ้น
- โปร B: ซื้อ X ครบ 5 → แถม Z 2 ชิ้น

ผลตามกลไกต้นฉบับ: **ได้ทั้ง Y 1 ชิ้น และ Z 4 ชิ้น** (โปร B เข้าเงื่อนไข 2 ชุด) เพราะ 10 ชิ้นถูกนับซ้ำทั้งสองโปร

ถ้าต้องการแบบ "หักยอดที่ใช้ไปแล้ว" (ซื้อ 10 ใช้กับ A ไป 10 แล้ว B ไม่เข้าเงื่อนไข) **ต้องเขียนเพิ่มเอง ต้นฉบับไม่มี**

**ยืนยันแล้ว: ใช้กลไกต้นฉบับ (นับซ้ำได้ ไม่หักยอด)** — ไม่ต้องเขียน logic เพิ่ม

**กติกาเมื่อของแถมชิ้นเดียวกันมาจากหลายโปรโมชัน:** แยกเป็นคนละบรรทัดใน `ic_trans_detail` ไม่รวมยอด
(เป็นผลลัพธ์ตามธรรมชาติของการ expand ทีละโปรโมชันอยู่แล้ว — การรวมบรรทัดต่างหากที่ต้องเขียนเพิ่ม)

---

## การแสดงผลของแถมในประวัติ (ข้อ 4)

**ไม่ต้องมีตารางสืบย้อน** — หน้าเว็บอ่านจาก `ic_trans_detail` ตรงๆ เหมือนสินค้าปกติ

- บรรทัดที่ `is_permium = 1` → แสดงป้าย "ของแถม" และราคา 0
- ไม่บอกว่ามาจากโปรโมชันไหน (ยอมรับได้ตามที่ตัดสิน)
- `getOrderDetail` / `getOrderHistory` แค่เพิ่ม `is_permium` เข้าไปใน SELECT ไม่ต้อง JOIN อะไรเพิ่ม

ผลพลอยได้: **ไม่มีตารางใหม่ฝั่งเอกสารเลย** เอกสารที่ ERP สร้างเองก็แสดงผลบนเว็บได้ถูกต้องด้วย ถ้าเอกสารนั้นมี `is_permium=1` (ฐาน `wawacrm` มีอยู่แล้ว 21 แถว)
