# Phase 3 — Cart

Base path: `/service/v1`  
ตะกร้าสินค้าเก็บข้อมูลใน table `ws_cart_order_temp`

---

## 1. เพิ่มสินค้าลงตะกร้า

```
POST /service/v1/additemtocart
```

รับ JSON array — แต่ละ item จะ **DELETE เดิมก่อน แล้ว INSERT ใหม่** (ไม่ใช่ upsert)  
ดังนั้น qty ที่ส่งมาจะ **แทนที่** ค่าเดิมทั้งหมด

### Headers

```
Content-Type: application/json
```

### Request Body

Array of item objects:

```json
[
  {
    "cust_code": "C00001",
    "emp_code": "EMP001",
    "guid_code": "550e8400-e29b-41d4-a716-446655440000",
    "item_code": "ITM001",
    "item_name": "น้ำดื่ม ABC 600ml",
    "unit_code": "ขวด",
    "barcode": "8851234567890",
    "qty": 6,
    "price": "12.00",
    "item_type": "0",
    "wh_code": "WH01",
    "shelf_code": "A01",
    "stand_value": 1,
    "divide_value": 1,
    "ratio": 1
  }
]
```

### Request Body Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `cust_code` | string | Yes | `""` | รหัสลูกค้า |
| `emp_code` | string | No | `""` | รหัสพนักงาน (creator) |
| `guid_code` | string | Yes | `""` | UUID สำหรับระบุรายการ (ใช้ deleteItem) |
| `item_code` | string | Yes | `""` | รหัสสินค้า |
| `item_name` | string | No | `""` | ชื่อสินค้า |
| `unit_code` | string | Yes | `""` | รหัสหน่วย |
| `barcode` | string | No | `""` | barcode |
| `qty` | number | No | `1` | จำนวน |
| `price` | number | No | `0` | ราคา |
| `item_type` | string/int | No | `"0"` | ประเภท: `"0"` = ปกติ, `"3"` = Set |
| `wh_code` | string | No | `""` | รหัสคลัง |
| `shelf_code` | string | No | `""` | รหัส shelf |
| `stand_value` | number | No | `1` | ค่าตัวตั้ง |
| `divide_value` | number | No | `1` | ค่าตัวหาร |
| `ratio` | number | No | `1` | ratio |

### Response (200)

```json
{
  "success": true,
  "msg": "success"
}
```

### Response — Error (400)

```json
{ "ERROR": "Data must be a JSON array" }
```

### Notes

- DELETE key คือ `(item_code, unit_code, barcode, cust_code)` — ถ้าส่งหลาย barcode ของสินค้าเดียวกัน จะ delete แยกกัน
- Body ยังรับ string JSON ได้ (backward compat กับ Java client เดิม)

---

## 2. รายการสินค้าในตะกร้า

```
GET /service/v1/getcartitemlist
```

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `cust_code` | string | Yes | — | รหัสลูกค้า |
| `page` | integer | No | `1` | หน้าที่ (1-based) |
| `page_size` | integer | No | `20` | จำนวนต่อหน้า (max 200) |
| `search` | string | No | `""` | ค้นหาใน `item_code` หรือ `item_name` |

### Request Example

```
GET /service/v1/getcartitemlist?cust_code=C00001&page=1&page_size=20
```

### Response (200)

```json
{
  "success": true,
  "page": 1,
  "page_size": 20,
  "total_count": 5,
  "data": [
    {
      "cust_code": "C00001",
      "guid_code": "550e8400-e29b-41d4-a716-446655440000",
      "item_code": "ITM001",
      "item_name": "น้ำดื่ม ABC 600ml",
      "unit_code": "ขวด",
      "item_type": "0",
      "barcode": "8851234567890",
      "qty": "6",
      "price": "12.00",
      "wh_code": "WH01",
      "shelf_code": "A01",
      "creator_code": "EMP001",
      "create_datetime": "2024-01-15T08:30:00.000Z",
      "stand_value": "1",
      "divide_value": "1",
      "ratio": "1",
      "balance_qty": 0
    }
  ]
}
```

### Notes

- `balance_qty` จะเป็น `0` เสมอ — ไม่ได้ตรวจสต็อก ณ ตอนนี้ ใช้ `/validatecartstock` แทน

---

## 3. สรุปยอดตะกร้า (ไม่คำนวณราคาใหม่)

```
GET /service/v1/getCartSummary
```

คำนวณยอดรวมจาก `qty × price` ที่บันทึกไว้ใน `ws_cart_order_temp` โดยตรง — **ไม่** เรียก priceHelper

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cust_code` | string | Yes | รหัสลูกค้า |

### Response (200)

```json
{
  "success": true,
  "total_price": "1250.50",
  "total_qty": "18",
  "total_items": 3
}
```

| Field | Type | Description |
|---|---|---|
| `total_price` | numeric string | ราคารวม (SUM qty × price) |
| `total_qty` | numeric string | จำนวนชิ้นรวม |
| `total_items` | integer | จำนวน row ในตะกร้า |

---

## 4. ตรวจสต็อกสินค้าหลายรายการ

```
POST /service/v1/getcartitemstock
```

### Headers

```
Content-Type: application/json
```

### Request Body

```json
{
  "items": [
    { "item_code": "ITM001", "unit_code": "ขวด" },
    { "item_code": "ITM002", "unit_code": "แพ็ค" }
  ]
}
```

### Response (200)

```json
{
  "success": true,
  "data": [
    { "item_code": "ITM001", "unit_code": "ขวด", "balance_qty": 240 },
    { "item_code": "ITM002", "unit_code": "แพ็ค", "balance_qty": 15 }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `balance_qty` | integer | สต็อกคงเหลือในหน่วยที่ระบุ (`TRUNC(sum_qty / ratio)`) |

---

## 5. รายการตะกร้าพร้อม tax_type และ price_confirm

```
GET /service/v1/getcartorder
```

เหมือน `getcartitemlist` แต่ join กับ `ic_inventory` เพื่อดึง `tax_type` และคำนวณ `price_confirm`

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `cust_code` | string | Yes | — | รหัสลูกค้า |
| `page` | integer | No | `1` | หน้าที่ (1-based) |
| `page_size` | integer | No | `20` | จำนวนต่อหน้า (max 200) |

### Response (200)

```json
{
  "success": true,
  "page": 1,
  "page_size": 20,
  "total_count": 5,
  "data": [
    {
      "tax_type": 1,
      "cust_code": "C00001",
      "guid_code": "550e8400-...",
      "item_code": "ITM001",
      "item_name": "น้ำดื่ม ABC 600ml",
      "unit_code": "ขวด",
      "item_type": "0",
      "barcode": "",
      "qty": "6",
      "price": "12.00",
      "wh_code": "WH01",
      "shelf_code": "A01",
      "creator_code": "EMP001",
      "create_datetime": "2024-01-15T08:30:00.000Z",
      "stand_value": "1",
      "divide_value": "1",
      "ratio": "1",
      "price_confirm": "0"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `tax_type` | integer | ประเภทภาษีจาก `ic_inventory` |
| `price_confirm` | string | `"0"` ถ้า item_type ≠ `"3"`, หรือ price ของสินค้าชุด |

### Notes

- `price_confirm` ในรายการนี้ **ยังไม่ได้คำนวณจาก priceHelper** — ใช้ `getcartorderprice` ถ้าต้องการราคาจริง

---

## 6. คำนวณราคาจริงของสินค้าในตะกร้า

```
POST /service/v1/getcartorderprice
```

เรียก `getProductPriceLocalx()` สำหรับแต่ละรายการ — ใช้ก่อนแสดงหน้า checkout

### Headers

```
Content-Type: application/json
```

### Request Body

```json
{
  "cust_code": "C00001",
  "items": [
    { "item_code": "ITM001", "unit_code": "ขวด", "qty": 6, "item_type": "0" },
    { "item_code": "SET001", "unit_code": "ชุด", "qty": 1, "item_type": "3", "price": "250.00" }
  ]
}
```

### Request Body Fields — items[]

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `item_code` | string | Yes | — | รหัสสินค้า |
| `unit_code` | string | Yes | — | รหัสหน่วย |
| `qty` | number | No | `1` | จำนวน (ส่งผล priceHelper pricing tier) |
| `item_type` | string | No | `"0"` | `"0"` = ปกติ, `"3"` = Set |
| `price` | number | No | `0` | ราคาต้นทุน (ใช้เฉพาะ item_type=`"3"`) |

### Response (200)

```json
{
  "success": true,
  "data": [
    { "item_code": "ITM001", "unit_code": "ขวด", "price_confirm": 11, "success": true },
    { "item_code": "SET001", "unit_code": "ชุด", "price_confirm": 250, "success": true }
  ]
}
```

### Response — Item Error

```json
{
  "item_code": "ITM999",
  "unit_code": "ขวด",
  "success": false,
  "error_type": "Error",
  "message": "...",
  "detail": "...",
  "qty": "1",
  "item_type": "0"
}
```

| Field | Type | Description |
|---|---|---|
| `price_confirm` | number | ราคาจริงจาก priceHelper |

### Notes

- item_type `"3"` (Set) จะใช้ `price` ที่ส่งมาโดยตรง ไม่เรียก priceHelper
- ถ้า priceHelper throw error สำหรับ item นั้น จะ return `success: false` ในรายการนั้น (ไม่ทำให้ request ทั้งหมด fail)

---

## 7. สรุปยอดรวมหลังคำนวณราคาจริง

```
GET /service/v1/getcartfinalsummary
```

Loop ทุก item ใน cart แล้วเรียก `getProductPriceLocalx()` — **ช้าถ้าตะกร้ามีหลาย item**

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cust_code` | string | Yes | รหัสลูกค้า |

### Response (200)

```json
{
  "success": true,
  "data": {
    "total_items": 3,
    "total_qty": 15,
    "total_price": 487.50
  }
}
```

| Field | Type | Description |
|---|---|---|
| `total_items` | integer | จำนวน row ในตะกร้า |
| `total_qty` | number | จำนวนชิ้นรวม |
| `total_price` | number | ราคารวมหลังคำนวณราคาจริง (price_confirm × qty) |

### Notes

- ความแตกต่างกับ `getCartSummary`: endpoint นี้เรียก priceHelper ทุก item ทำให้ **ช้ากว่ามาก** แต่ได้ราคาที่ถูกต้อง

---

## 8. ตรวจสอบสต็อกก่อนสั่งซื้อ

```
GET /service/v1/validatecartstock
```

ตรวจสต็อกของทุก item ในตะกร้า — รองรับทั้งสินค้าปกติและสินค้าชุด (Set)

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cust_code` | string | Yes | รหัสลูกค้า |

### Response — ผ่านทั้งหมด (200)

```json
{
  "success": true,
  "is_valid": true,
  "stock_issues": []
}
```

### Response — มีสินค้าไม่พอ (200)

```json
{
  "success": true,
  "is_valid": false,
  "stock_issues": [
    {
      "item_code": "ITM001",
      "item_name": "น้ำดื่ม ABC 600ml",
      "qty_in_cart": 100,
      "balance_qty": 50,
      "issue_type": "exceeding"
    },
    {
      "item_code": "ITM002",
      "item_name": "น้ำผลไม้ DEF",
      "qty_in_cart": 5,
      "balance_qty": 0,
      "issue_type": "out_of_stock"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `is_valid` | boolean | `true` = ทุกรายการมีสต็อกพอ |
| `stock_issues` | array | รายการที่มีปัญหา |
| `stock_issues[].issue_type` | string | `"out_of_stock"` (balance ≤ 0) หรือ `"exceeding"` (qty > balance) |

---

## 9. ลบสินค้ารายการเดียว

```
GET /service/v1/deleteItem
```

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `guid_code` | string | Yes | GUID ของรายการ (ตรงกับที่ใส่ตอน additemtocart) |
| `cust_code` | string | Yes | รหัสลูกค้า |

### Request Example

```
GET /service/v1/deleteItem?guid_code=550e8400-e29b-41d4-a716-446655440000&cust_code=C00001
```

### Response (200)

```json
{ "success": true }
```

### Notes

- ถ้า `guid_code` ไม่ตรงกับ record ใด จะยัง return `success: true` (DELETE ไม่เจอก็ไม่ error)

---

## 10. ล้างตะกร้าทั้งหมด

```
GET /service/v1/deleteAllItems
```

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cust_code` | string | Yes | รหัสลูกค้า |

### Request Example

```
GET /service/v1/deleteAllItems?cust_code=C00001
```

### Response (200)

```json
{ "success": true }
```
