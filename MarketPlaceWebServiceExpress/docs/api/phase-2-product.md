# Phase 2 — Product

Base path: `/service/v1`

---

## 1. รายการหมวดหมู่

```
GET /service/v1/getCategoryList
```

ดึงหมวดหมู่สินค้าทั้งหมดจากตาราง `ic_category`

### Query Parameters

ไม่มี

### Request Example

```
GET /service/v1/getCategoryList
```

### Response (200)

```json
{
  "success": true,
  "data": [
    { "code": "CAT001", "name": "เครื่องดื่ม" },
    { "code": "CAT002", "name": "อาหารแห้ง" }
  ]
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `data[].code` | string | รหัสหมวดหมู่ |
| `data[].name` | string | ชื่อหมวดหมู่ (`name_1`) |

---

## 2. รายการสินค้า

```
GET /service/v1/getProductList
```

ดึงรายการสินค้าพร้อม filter และ pagination — เฉพาะสินค้าที่ `item_pattern='[W]'`

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `cust_code` | string | No | `""` | รหัสลูกค้า — ใช้สำหรับตรวจ promotion และ favorite |
| `search` | string | No | `""` | ค้นหาใน `name_1`, `code`, `name_eng_2` (space = AND หลาย keyword) |
| `category` | string | No | `""` | filter ด้วย `item_category` |
| `offset` | integer | No | `0` | จำนวน record ที่ข้ามไป (สำหรับ pagination) |
| `limit` | integer | No | `20` | จำนวน record ต่อหน้า |
| `premium` | string | No | `""` | `"1"` = เฉพาะสินค้า premium (`is_premium='1'`) |
| `ispromotion` | string | No | `""` | `"1"` = เฉพาะสินค้าที่มีโปรโมชันสำหรับ cust_code นี้ |
| `isstock` | string | No | `""` | `"1"` = เฉพาะสินค้าที่มีสต็อก > minimum_qty |
| `favorite` | string | No | `""` | `"1"` = เฉพาะสินค้าที่ลูกค้า mark ว่า favorite |
| `isproductset` | string | No | `""` | `"1"` = เฉพาะสินค้าชุด (`item_type='3'`) |

### Request Example

```
GET /service/v1/getProductList?cust_code=C00001&search=น้ำ&limit=20&offset=0&isstock=1
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "item_code": "ITM001",
      "item_name": "น้ำดื่มตรา ABC 600ml",
      "item_type": "0",
      "sold_out": "0",
      "is_promotion": "1",
      "favorite_item": "1",
      "is_return": "0"
    }
  ],
  "pagination": {
    "total": 150,
    "perPage": 20,
    "page": 0,
    "totalPage": 8
  }
}
```

### Response Fields — Data

| Field | Type | Description |
|---|---|---|
| `item_code` | string | รหัสสินค้า |
| `item_name` | string | ชื่อสินค้า |
| `item_type` | string | ประเภทสินค้า: `"0"` = ปกติ, `"3"` = ชุด (Set) |
| `sold_out` | string | `"1"` = สต็อกหมด/ต่ำกว่า minimum |
| `is_promotion` | string | `"1"` = มีโปรโมชันสำหรับลูกค้านี้ |
| `favorite_item` | string/int | `"1"` = ลูกค้า mark favorite, `"0"` = ไม่ใช่ |
| `is_return` | string | `"1"` = สินค้าคืน (`item_grade='R'`) |

### Response Fields — Pagination

| Field | Type | Description |
|---|---|---|
| `total` | integer | จำนวนสินค้าทั้งหมดที่ตรงเงื่อนไข |
| `perPage` | integer | จำนวนต่อหน้า |
| `page` | integer | หน้าปัจจุบัน (0-based: `floor(offset/limit)`) |
| `totalPage` | integer | จำนวนหน้าทั้งหมด |

### Notes

- `page` ใน response เป็น **0-based** (`offset / limit`) ต่างจาก cart endpoints ที่เป็น 1-based
- Filter `ispromotion=1` ตรวจสอบตาราง `ic_inventory_price` โดยใช้ `cust_code` และ `group_main` ของลูกค้า

---

## 3. รายละเอียดสินค้า

```
GET /service/v1/getProductDetail
```

ดึงรายละเอียดสินค้า พร้อมราคาทุก unit และโปรโมชัน — ใช้ `getProductPriceLocalx()` คำนวณราคา

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `item_code` | string | Yes | รหัสสินค้า |
| `cust_code` | string | No | รหัสลูกค้า — ใช้คำนวณราคาลูกค้าเฉพาะราย |

### Request Example

```
GET /service/v1/getProductDetail?item_code=ITM001&cust_code=C00001
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "barcode": "",
      "item_type": "0",
      "item_code": "ITM001",
      "item_name": "น้ำดื่มตรา ABC 600ml",
      "unit_code": "ขวด",
      "balance_qty": 240,
      "sold_out": "0",
      "sum_sale": 1500,
      "wh_code": "WH01",
      "shelf_code": "A01",
      "stand_value": 1,
      "divide_value": 1,
      "ratio": 1,
      "favorite_item": "1",
      "price": "12.00",
      "is_return": "0",
      "description": "",
      "type": "1",
      "mode": "2",
      "price_type": "3",
      "promotion": [
        {
          "from_qty": 10,
          "to_qty": 50,
          "unit_name": "ขวด",
          "price": "11.00",
          "line_number": 1
        }
      ]
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `item_code` | string | รหัสสินค้า |
| `item_name` | string | ชื่อสินค้า |
| `unit_code` | string | รหัสหน่วย |
| `balance_qty` | number | ยอดคงเหลือในหน่วยนี้ (คำนวณจาก `sum_balance_qty / ratio`) |
| `sold_out` | string | `"1"` = สต็อกหมด |
| `sum_sale` | number | ยอดขาย YTD ในหน่วยนี้ |
| `wh_code` | string | รหัสคลังสินค้าหลัก |
| `shelf_code` | string | รหัส shelf/ชั้นวาง |
| `stand_value` | number | ค่าตัวตั้ง (หน่วยการแปลง) |
| `divide_value` | number | ค่าตัวหาร |
| `ratio` | number | อัตราส่วนเทียบหน่วยมาตรฐาน |
| `price` | string | ราคาต่อหน่วย (string ทศนิยม) |
| `type` | string | price type จาก `getProductPriceLocalx` |
| `mode` | string | price mode |
| `price_type` | string | roworder — `"3"` = customer specific, `"4"` = group |
| `description` | string | คำอธิบายสินค้า |
| `is_return` | string | `"1"` = สินค้าคืน |
| `promotion` | array | รายการโปรโมชัน (มีเฉพาะถ้า type IN 1,2,3) |
| `promotion[].from_qty` | number | ปริมาณขั้นต่ำ |
| `promotion[].to_qty` | number | ปริมาณสูงสุด |
| `promotion[].price` | number | ราคาโปรโมชัน |
| `promotion[].unit_name` | string | ชื่อหน่วย |
| `promotion[].line_number` | integer | ลำดับ (1-based) |

### Notes

- Response array มีหนึ่งรายการต่อหนึ่ง unit_code ที่สินค้านี้มี
- **เฉพาะ rows ที่ `price !== "0"` เท่านั้นที่ถูก return** — สินค้าที่ไม่มีราคาสำหรับลูกค้านี้จะถูกกรองออก
- `promotion` จะว่างเปล่าถ้า `type` ไม่ใช่ 1, 2 หรือ 3

---

## 4. รายละเอียดสินค้าชุด (Set)

```
GET /service/v1/getProductSetDetail
```

ดึงข้อมูลสินค้าที่เป็น Set — ราคาคำนวณจาก `sum_amount` ของทุก component ในชุด

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `item_code` | string | Yes | รหัสสินค้าชุด (`ic_inventory_set_detail.ic_set_code`) |
| `cust_code` | string | No | รหัสลูกค้า (ใช้ตรวจ favorite) |

### Request Example

```
GET /service/v1/getProductSetDetail?item_code=SET001&cust_code=C00001
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "barcode": "",
      "item_type": "3",
      "item_code": "SET001",
      "display_name": "Set ABC",
      "name_display_mode": "name_1",
      "name_display_source": "default",
      "item_name": "ชุดสินค้า ABC",
      "unit_code": "ชุด",
      "balance_qty": 10,
      "sold_out": "0",
      "sum_sale": 0,
      "wh_code": "WH01",
      "shelf_code": "A01",
      "stand_value": 1,
      "divide_value": 1,
      "ratio": 1,
      "favorite_item": "0",
      "price": "250.00",
      "is_return": "0",
      "description": "",
      "hidden_detail_fields": ["sales"],
      "hidden_detail_fields_csv": "sales",
      "sales_display_mode": "1",
      "sales_star_thresholds": "100,500,1000,5000",
      "product_video_url": "",
      "preorder_mode": "default",
      "preorder_allowed": 0,
      "preorder_only_available": 0,
      "online_visibility": 0,
      "promotion": []
    }
  ]
}
```

### Notes

- `price` = ผลรวม `sum_amount` ของทุกรายการใน `ic_inventory_set_detail`
- `balance_qty` = `MIN(TRUNC(balance_component / qty_in_set))` — คือจำนวนชุดที่ประกอบได้
- `promotion` จะเป็น `[]` เสมอสำหรับสินค้าชุด

---

## 5. รายการสินค้าย่อยในชุด

```
GET /service/v1/getProductSetItem
```

ดึงรายการสินค้าย่อย (component) ทั้งหมดที่อยู่ในสินค้าชุดนั้น

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `item_code` | string | Yes | รหัสสินค้าชุด |

### Request Example

```
GET /service/v1/getProductSetItem?item_code=SET001
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "item_code": "ITM001",
      "item_name": "น้ำดื่ม ABC 600ml",
      "unit_code": "ขวด",
      "qty": 6,
      "balance_qty": 120,
      "price": "12.00",
      "sum_amount": "72.00",
      "barcode": "8851234567890",
      "price_ratio": 1,
      "stand_value": 1,
      "divide_value": 1
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `item_code` | string | รหัสสินค้าย่อย |
| `item_name` | string | ชื่อสินค้าย่อย |
| `unit_code` | string | หน่วย |
| `qty` | number | จำนวนต่อชุด |
| `balance_qty` | integer | สต็อกคงเหลือของสินค้าย่อยนี้ |
| `price` | number | ราคาต่อหน่วยในชุด |
| `sum_amount` | number | ราคารวม (price × qty) |
| `barcode` | string | barcode ของสินค้าย่อย |
| `price_ratio` | number | สัดส่วนราคา |
| `stand_value` | number | ค่าตัวตั้ง |
| `divide_value` | number | ค่าตัวหาร |

---

## 6. ยอดคงเหลือและราคาตาม Barcode/Unit

```
GET /service/v1/getProductBalancePrice
```

ดึงข้อมูลสต็อกและราคาจากตาราง `ic_inventory_barcode` — ใช้เมื่อ scan barcode

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `item_code` | string | Yes | รหัสสินค้า |
| `unit_code` | string | Yes | รหัสหน่วย |
| `cust_code` | string | No | รหัสลูกค้า — ใช้คำนวณราคา |

### Request Example

```
GET /service/v1/getProductBalancePrice?item_code=ITM001&unit_code=ขวด&cust_code=C00001
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "barcode": "8851234567890",
      "item_code": "ITM001",
      "item_name": "น้ำดื่ม ABC 600ml",
      "unit_code": "ขวด",
      "balance_qty": 240,
      "sold_out": "0",
      "sum_sale": 1500,
      "wh_code": "WH01",
      "shelf_code": "A01",
      "stand_value": 1,
      "divide_value": 1,
      "ratio": 1,
      "favorite_item": "1",
      "price": "12.00"
    }
  ]
}
```

### Notes

- `sold_out` ในรายการนี้ใช้เกณฑ์ต่างกับ `getProductList` — คิดเป็น `≤ (maximum_qty × 5%) / 100`
- `balance_qty` คำนวณจาก `MAX(balance_qty)` ทุก warehouse ของ unit นี้
- ราคามาจาก `getProductPriceLocalx()` — ถ้าไม่มีราคาจะเป็น `"0"`
