# Phase 4 — Order

Base path: `/service/v1`

---

## Order Status Values

| Status | ความหมาย |
|---|---|
| `pending` | รอดำเนินการ |
| `packing` | กำลังจัดส่ง (มี SO แล้ว) |
| `payment` | รอชำระ (มี Invoice แล้ว) |
| `success` | ชำระแล้ว balance = 0 |
| `partial` | ชำระแล้วบางส่วน (success แต่ balance > 0) |
| `cancel` | ยกเลิกแล้ว (มี SOC) |

---

## 1. สร้างออเดอร์ใหม่

```
POST /service/v1/sendorder
```

Insert header ลง `ic_trans` (trans_flag=30, doc_format_code='QT') และ detail ลง `ic_trans_detail`  
รองรับสินค้าปกติ (item_type ≠ 3) และสินค้าชุด (item_type = 3 พร้อม sub_item)  
ทั้งหมดอยู่ใน **single transaction**

### Headers

```
Content-Type: application/json
```

### Request Body — สินค้าปกติ

```json
{
  "doc_date": "2024-01-15",
  "send_date": "2024-01-16",
  "send_day": "1",
  "doc_no": "MQT2401150001",
  "cust_code": "C00001",
  "send_type": "1",
  "total_after_vat": "1284.00",
  "total_value": "1200.00",
  "total_except_vat": "0",
  "total_amount": "1284.00",
  "doc_time": "08:30:00",
  "remark": "จัดส่งก่อนเที่ยง",
  "emp_code": "EMP001",
  "credit_day": "30",
  "credit_date": "2024-02-14",
  "items": [
    {
      "item_code": "ITM001",
      "item_name": "น้ำดื่ม ABC 600ml",
      "unit_code": "ขวด",
      "qty": 100,
      "price": "12.00",
      "sum_amount": "1200.00",
      "wh_code": "WH01",
      "shelf_code": "A01",
      "stand_value": 1,
      "divide_value": 1,
      "ratio": 1,
      "item_type": "0"
    }
  ]
}
```

### Request Body — มีสินค้าชุด (item_type=3)

```json
{
  "doc_no": "MQT2401150002",
  "cust_code": "C00001",
  "doc_date": "2024-01-15",
  "total_after_vat": "535.00",
  "total_amount": "535.00",
  "items": [
    {
      "item_code": "SET001",
      "item_name": "ชุดสินค้า ABC",
      "unit_code": "ชุด",
      "qty": 2,
      "price": "250.00",
      "sum_amount": "500.00",
      "wh_code": "WH01",
      "shelf_code": "A01",
      "stand_value": 1,
      "divide_value": 1,
      "ratio": 1,
      "item_type": "3",
      "sub_item": [
        {
          "item_code": "ITM001",
          "item_name": "น้ำดื่ม ABC 600ml",
          "unit_code": "ขวด",
          "qty": 6,
          "price": "12.00",
          "sum_amount": "72.00",
          "wh_code": "WH01",
          "shelf_code": "A01",
          "stand_value": 1,
          "divide_value": 1,
          "price_ratio": 1
        }
      ]
    }
  ]
}
```

### Request Body Fields — Header

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `doc_no` | string | Yes | `""` | เลขที่เอกสาร (ควรมี 'MQT' เพื่อให้ getOrderHistory เจอ) |
| `doc_date` | string | Yes | `""` | วันที่เอกสาร (YYYY-MM-DD) |
| `send_date` | string | No | = doc_date | วันที่จัดส่ง |
| `send_day` | string | No | `"0"` | จำนวนวันจัดส่ง |
| `cust_code` | string | Yes | `""` | รหัสลูกค้า |
| `send_type` | string | No | `"0"` | ประเภทการจัดส่ง |
| `total_after_vat` | string | Yes | `"0"` | ยอดรวมรวม VAT |
| `total_value` | string | No | `"0"` | มูลค่าสินค้า |
| `total_except_vat` | string | No | `"0"` | ยอดยกเว้น VAT |
| `total_amount` | string | No | `"0"` | ยอดสุดท้าย |
| `doc_time` | string | No | `""` | เวลาเอกสาร (HH:MM:SS) |
| `remark` | string | No | `""` | หมายเหตุ |
| `emp_code` | string | No | `""` | รหัสพนักงานขาย |
| `credit_day` | string | No | `"0"` | จำนวนวันเครดิต |
| `credit_date` | string | No | = doc_date | วันครบกำหนดชำระ |
| `items` | array | Yes | — | รายการสินค้า |

### Request Body Fields — items[]

| Field | Type | Required | Description |
|---|---|---|---|
| `item_code` | string | Yes | รหัสสินค้า |
| `item_name` | string | No | ชื่อสินค้า |
| `unit_code` | string | Yes | รหัสหน่วย |
| `qty` | number | Yes | จำนวน |
| `price` | number | Yes | ราคาต่อหน่วย |
| `sum_amount` | number | Yes | ราคารวม |
| `wh_code` | string | No | รหัสคลัง |
| `shelf_code` | string | No | รหัส shelf |
| `stand_value` | number | No | ค่าตัวตั้ง |
| `divide_value` | number | No | ค่าตัวหาร |
| `ratio` | number | No | ratio |
| `item_type` | string | Yes | `"0"` = ปกติ, `"3"` = Set |
| `sub_item` | array | ถ้า type=3 | รายการสินค้าย่อยในชุด |

### Request Body Fields — sub_item[] (สำหรับ item_type=3)

| Field | Type | Description |
|---|---|---|
| `item_code` | string | รหัสสินค้าย่อย |
| `item_name` | string | ชื่อสินค้าย่อย |
| `unit_code` | string | หน่วย |
| `qty` | number | จำนวนต่อชุด (qty รวม = parent.qty × sub.qty) |
| `price` | number | ราคา |
| `sum_amount` | number | ราคารวม |
| `stand_value` | number | ค่าตัวตั้ง |
| `divide_value` | number | ค่าตัวหาร |
| `price_ratio` | number | สัดส่วนราคาในชุด |

### Response (200)

```json
{ "success": true }
```

### Response — Error (400)

```
error message text (plain text, ไม่ใช่ JSON)
```

### Notes

- VAT rate ตายตัวที่ `7%` — ระบบคำนวณ `total_before_vat` และ `total_vat_value` เอง ไม่รับจาก client
- `doc_no` ควรขึ้นต้นด้วย `MQT` เพราะ `getOrderHistory` filter ด้วย `LIKE '%MQT%'`
- สินค้าชุด (item_type=3) จะ insert header row ก่อน แล้วจึง insert sub_item โดย link กัน ผ่าน `ref_guid` (UUID สร้างตอน insert)
- ทั้งหมดอยู่ใน `withTransaction()` — ถ้า sub_item insert ไม่สำเร็จจะ rollback ทั้งออเดอร์

---

## 2. บันทึกการชำระเงิน

```
POST /service/v1/pay
```

Insert records เข้า `ap_ar_trans`, `ap_ar_trans_detail`, `cb_trans`, `cb_trans_detail`  
DELETE records เดิมก่อน แล้ว insert ใหม่ (idempotent)

### Headers

```
Content-Type: application/json
```

### Request Body

```json
{
  "doc_no": "RC2401150001",
  "doc_time": "09:00:00",
  "cust_code": "C00001",
  "doc_date": "2024-01-15",
  "wallet_amount": "1284.00",
  "total_amount": "1284.00",
  "trans_number": "REF001",
  "no_approved": "APPROVED001",
  "emp_code": "EMP001",
  "remark": "",
  "doc_detail": [
    {
      "doc_no": "INV2401150001",
      "doc_date": "2024-01-10",
      "total_amount": "1284.00"
    }
  ]
}
```

### Request Body Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `doc_no` | string | Yes | `""` | เลขที่ใบรับเงิน |
| `doc_date` | string | Yes | `""` | วันที่รับเงิน |
| `doc_time` | string | No | `""` | เวลา |
| `cust_code` | string | Yes | `""` | รหัสลูกค้า |
| `wallet_amount` | string | No | `"0"` | จำนวนเงินที่ตัดจาก wallet |
| `total_amount` | string | Yes | `"0"` | ยอดรวมที่ชำระ |
| `trans_number` | string | No | `"0"` | เลขอ้างอิง transaction |
| `no_approved` | string | No | `"0"` | เลขอนุมัติ |
| `emp_code` | string | No | `""` | รหัสพนักงาน |
| `remark` | string | No | `""` | หมายเหตุ |
| `doc_detail` | array | Yes | — | รายการ Invoice ที่ชำระ (ต้องมีอย่างน้อย 1 รายการ) |
| `doc_detail[].doc_no` | string | Yes | — | เลขที่ Invoice |
| `doc_detail[].doc_date` | string | Yes | — | วันที่ Invoice |
| `doc_detail[].total_amount` | string | Yes | — | ยอดที่ชำระของ Invoice นี้ |

### Response (200)

```json
{
  "success": true,
  "msg": "success"
}
```

### Response — doc_detail ว่าง (200)

```json
{ "success": false }
```

---

## 3. ยกเลิกออเดอร์

```
POST /service/v1/cancelOrder
```

สร้างเอกสารยกเลิก SOC (trans_flag=31) อ้างอิง QT (trans_flag=30) และอัปเดต `last_status=1`  
ใช้ manual transaction (BEGIN/COMMIT/ROLLBACK)

### Headers

```
Content-Type: application/json
```

### Request Body

```json
{
  "doc_date": "2024-01-15",
  "doc_time": "10:00:00",
  "doc_no": "SOC2401150001",
  "doc_ref": "MQT2401150001",
  "cust_code": "C00001",
  "emp_code": "EMP001",
  "remark": "ลูกค้าขอยกเลิก",
  "send_type": "0"
}
```

### Request Body Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `doc_date` | string | Yes | วันที่ยกเลิก |
| `doc_no` | string | Yes | เลขที่เอกสาร SOC ใหม่ |
| `doc_ref` | string | Yes | เลขที่ QT ที่ต้องการยกเลิก |
| `cust_code` | string | Yes | รหัสลูกค้า |
| `doc_time` | string | No | เวลา |
| `emp_code` | string | No | รหัสพนักงาน (ถ้าไม่ระบุใช้ sale_code จาก QT) |
| `remark` | string | No | หมายเหตุ |
| `send_type` | string | No | ประเภทจัดส่ง (ถ้าไม่ระบุใช้ค่าจาก QT) |

### Response — Success (200)

```json
{
  "success": true,
  "msg": "success",
  "cancel_doc_no": "SOC2401150001",
  "ref_doc_no": "MQT2401150001"
}
```

### Response — ล้มเหลว (200, success=false)

```json
{ "success": false, "msg": "duplicate_doc_no" }
```

### msg Values

| msg | ความหมาย |
|---|---|
| `success` | ยกเลิกสำเร็จ |
| `duplicate_doc_no` | `doc_no` (SOC) นี้มีอยู่แล้ว |
| `ref_doc_not_found` | ไม่พบ QT doc_ref นี้ของลูกค้า |
| `already_cancelled` | QT นี้ถูกยกเลิกไปแล้ว (`last_status=1` หรือ SOC มีอยู่แล้ว) |
| `ref_doc_has_no_detail` | QT ไม่มี detail line |

---

## 4. ประวัติออเดอร์

```
GET /service/v1/getOrderHistory
```

ดึงออเดอร์ทั้งหมดของลูกค้า (เฉพาะที่ doc_no มี 'MQT') — max 40 รายการล่าสุด

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `cust_code` | string | Yes | — | รหัสลูกค้า |
| `status` | string | No | `""` | filter status: `pending`, `packing`, `payment`, `success`, `partial`, `cancel` |

### Request Example

```
GET /service/v1/getOrderHistory?cust_code=C00001&status=pending
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "doc_no": "MQT2401150001",
      "doc_date": "2024-01-15",
      "doc_time": "08:30:00",
      "cust_code": "C00001",
      "send_type": 1,
      "total_amount": "1284.00",
      "emp_code": "EMP001",
      "emp_name": "สมชาย ใจดี",
      "balance": "1284.00",
      "remark_qt": "จัดส่งก่อนเที่ยง",
      "remark_cancel": "",
      "remark_inv": "",
      "remark_5": "",
      "inv_doc_no": "",
      "inv_doc_date": "",
      "wallet_amount": 0,
      "total_except_vat": "0",
      "total_after_vat": "1284.00",
      "total_vat_value": "84.00",
      "cn_total_amount": "0",
      "status": "pending"
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `doc_no` | string | เลขที่ QT |
| `doc_date` | string | วันที่ |
| `status` | string | สถานะ (ดู status table ด้านบน) |
| `total_amount` | number | ยอดสุดท้าย (หักลบ CN แล้ว) |
| `cn_total_amount` | number | ยอด CN ที่ถูก deduct |
| `balance` | number | ยอดค้างชำระ |
| `inv_doc_no` | string | เลขที่ Invoice (ถ้ามี) |
| `wallet_amount` | number | ยอดที่ชำระด้วย wallet |
| `remark_qt` | string | หมายเหตุของ QT |
| `remark_cancel` | string | หมายเหตุยกเลิก (SOC) |
| `remark_inv` | string | หมายเหตุ Invoice |

### Status Filter Logic

- `status=partial` → ดึงทุก row ใน DB แล้ว filter ใน app layer เฉพาะ `status='success' AND balance>0`
- `status=success` → ดึงเฉพาะ `status='success'` ใน DB แล้ว filter เฉพาะ `balance=0`
- อื่นๆ → filter ตรงใน SQL WHERE

---

## 5. Header ของออเดอร์เดี่ยว

```
GET /service/v1/getOrderHeader
```

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cust_code` | string | Yes | รหัสลูกค้า |
| `doc_no` | string | Yes | เลขที่เอกสาร QT |

### Response (200)

```json
{
  "success": true,
  "data": {
    "doc_no": "MQT2401150001",
    "doc_date": "2024-01-15",
    "doc_time": "08:30:00",
    "cust_code": "C00001",
    "send_type": 1,
    "send_date": "2024-01-16",
    "send_day": 1,
    "total_amount": "1284.00",
    "total_except_vat": "0",
    "total_after_vat": "1284.00",
    "total_vat_value": "84.00",
    "emp_code": "EMP001",
    "emp_name": "สมชาย ใจดี",
    "balance": "0",
    "address": "สมชาย ใจดี",
    "telephone": "081-234-5678",
    "address_name": "123/4 ถ.สุขุมวิท กรุงเทพฯ",
    "remark_5": "",
    "status": "success"
  }
}
```

### Response — ไม่พบ (200)

```json
{ "success": true, "data": null }
```

| Field | Type | Description |
|---|---|---|
| `address` | string | ชื่อผู้รับ (`transport_name` จาก `ic_trans_shipment`) |
| `telephone` | string | เบอร์โทร (`transport_telephone`) |
| `address_name` | string | ที่อยู่จัดส่ง (`transport_address`) |

---

## 6. รายการสินค้าในออเดอร์

```
GET /service/v1/getOrderDetail
```

ดึง line items ของออเดอร์ พร้อม sub_item สำหรับสินค้าชุด — รองรับ pagination และ search

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `cust_code` | string | Yes | — | รหัสลูกค้า |
| `doc_no` | string | Yes | — | เลขที่เอกสาร QT |
| `page` | integer | No | `1` | หน้าที่ (1-based) |
| `page_size` | integer | No | `20` | จำนวนต่อหน้า (1-100) |
| `q` | string | No | `""` | ค้นหา item_code หรือ item_name |

### Request Example

```
GET /service/v1/getOrderDetail?cust_code=C00001&doc_no=MQT2401150001&page=1&page_size=20
```

### Response (200)

```json
{
  "success": true,
  "paging": {
    "page": 1,
    "page_size": 20,
    "total_items": 3,
    "total_pages": 1
  },
  "data": {
    "doc_no": "MQT2401150001",
    "items": [
      {
        "item_code": "ITM001",
        "item_name": "น้ำดื่ม ABC 600ml",
        "qty": "100",
        "unit_code": "ขวด",
        "price": "12.00",
        "sum_amount": "1200.00",
        "item_type": "0",
        "set_ref_line": "",
        "ref_guid": null,
        "wh_code": "WH01",
        "shelf_code": "A01",
        "stand_value": "1",
        "divide_value": "1",
        "ratio": "1"
      },
      {
        "item_code": "SET001",
        "item_name": "ชุดสินค้า ABC",
        "qty": "2",
        "unit_code": "ชุด",
        "price": "250.00",
        "sum_amount": "500.00",
        "item_type": "3",
        "set_ref_line": "",
        "ref_guid": "abc123-...",
        "sub_item": [
          {
            "item_code": "ITM001",
            "item_name": "น้ำดื่ม ABC",
            "qty": "12",
            "unit_code": "ขวด",
            "price": "12.00",
            "sum_amount": "144.00",
            "item_type": "0",
            "set_ref_line": "abc123-..."
          }
        ]
      }
    ]
  }
}
```

### Notes

- แสดงเฉพาะ top-level items (item_type=3 หรือ set_ref_line='' )
- สินค้าชุด (item_type=3) จะมี `sub_item` array ที่ดึงมาแยกต่างหาก
- Search `q` ค้นทั้ง parent และ sub_item ของ Set
- `page_size` ถูก clamp ที่ 1–100
