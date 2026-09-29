# Phase 5 — Customer & Financial

Base path: `/service/v1`

---

## 1. รายชื่อลูกค้า (สั้น)

```
GET /service/v1/getCustomerList
```

ดึงรายชื่อลูกค้าสำหรับ dropdown/search — จำกัดแค่ 50 รายการ

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `search` | string | No | `""` | ค้นหาใน `code` หรือ `name_1` (ILIKE) |

### Request Example

```
GET /service/v1/getCustomerList?search=abc
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "code": "C00001",
      "name": "บริษัท ABC จำกัด",
      "address": "123/4 ถ.สุขุมวิท กรุงเทพฯ",
      "telephone": "02-123-4567",
      "tax_id": "0105560123456"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `code` | string | รหัสลูกค้า |
| `name` | string | ชื่อลูกค้า |
| `address` | string | ที่อยู่ |
| `telephone` | string | เบอร์โทร |
| `tax_id` | string | เลขผู้เสียภาษี (จาก ar_customer_detail, `""` ถ้าไม่มี) |

### Notes

- Hard limit 50 รายการ — ใช้ `getCustomerCRM` ถ้าต้องการ pagination

---

## 2. รายชื่อพนักงาน (สั้น)

```
GET /service/v1/getEmployeeList
```

ดึงรายชื่อพนักงาน (`name_2='o'`) — จำกัดแค่ 50 รายการ

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `search` | string | No | `""` | ค้นหาใน `code` หรือ `name_1` (ILIKE) |

### Response (200)

```json
{
  "success": true,
  "data": [
    { "code": "EMP001", "name": "สมชาย ใจดี" }
  ]
}
```

---

## 3. รายชื่อลูกค้า CRM (Paginated)

```
GET /service/v1/getCustomerCRM
```

ดึงรายชื่อลูกค้าพร้อมข้อมูล logistic และ group — รองรับ pagination

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `search` | string | No | `""` | ค้นหาใน `code` หรือ `name_1` (ILIKE) |
| `limit` | integer | No | `50` | จำนวนต่อหน้า |
| `offset` | integer | No | `0` | จำนวนที่ข้าม |

### Request Example

```
GET /service/v1/getCustomerCRM?search=&limit=20&offset=0
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "code": "C00001",
      "name": "บริษัท ABC จำกัด",
      "address": "123/4 ถ.สุขุมวิท กรุงเทพฯ",
      "telephone": "02-123-4567",
      "logistic_area": "BKK",
      "gps": "13.756331,100.501762",
      "group_main": "GRP01"
    }
  ],
  "pagination": {
    "total": 350,
    "limit": 20,
    "offset": 0,
    "current_page": 1,
    "total_page": 18
  }
}
```

| Field | Type | Description |
|---|---|---|
| `logistic_area` | string | พื้นที่จัดส่ง (จาก ar_customer_detail) |
| `gps` | string | พิกัด GPS เก็บใน `website` field ของ ar_customer |
| `group_main` | string | กลุ่มลูกค้าหลัก (จาก ar_customer_detail) |

### Pagination Fields

| Field | Type | Description |
|---|---|---|
| `current_page` | integer | หน้าปัจจุบัน (1-based: `floor(offset/limit)+1`) |
| `total_page` | integer | จำนวนหน้าทั้งหมด |

---

## 4. รายชื่อพนักงาน CRM (Paginated)

```
GET /service/v1/getEmployeeCRM
```

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `search` | string | No | `""` | ค้นหาใน `code` หรือ `name_1` (ILIKE) |
| `limit` | integer | No | `50` | จำนวนต่อหน้า |
| `offset` | integer | No | `0` | จำนวนที่ข้าม |

### Response (200)

```json
{
  "success": true,
  "data": [
    { "code": "EMP001", "name": "สมชาย ใจดี" }
  ]
}
```

---

## 5. ข้อมูลเครดิตของลูกค้า

```
GET /service/v1/getCustomerCredit
```

ดึงข้อมูลเครดิตเทอม — วันเครดิต และวันครบกำหนดจากปัจจุบัน

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cust_code` | string | Yes | รหัสลูกค้า |

### Request Example

```
GET /service/v1/getCustomerCredit?cust_code=C00001
```

### Response (200)

```json
{
  "success": true,
  "data": {
    "code": "C00001",
    "name": "บริษัท ABC จำกัด",
    "credit_day": 30,
    "credit_date": "2024-02-14"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `credit_day` | integer | จำนวนวันเครดิต (จาก ar_customer_detail) |
| `credit_date` | string | วันครบกำหนด = NOW() + credit_day วัน (คำนวณใน DB) |

### Response — ไม่พบลูกค้า (200)

```json
{ "success": true, "data": {} }
```

---

## 6. ประวัติมัดจำ/เงินล่วงหน้า

```
GET /service/v1/getAdvancePayment
```

ดึงรายการเงินมัดจำ (trans_flag IN 40, 9040) ของลูกค้า — max 20 รายการล่าสุด

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cust_code` | string | Yes | รหัสลูกค้า |

### Request Example

```
GET /service/v1/getAdvancePayment?cust_code=C00001
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "doc_no": "DP2401150001",
      "doc_date": "2024-01-15",
      "total_amount": "5000.00",
      "used": "2000.00",
      "balance_amount": "3000.00"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `doc_no` | string | เลขที่ใบมัดจำ |
| `doc_date` | string | วันที่ |
| `total_amount` | number | ยอดมัดจำทั้งหมด |
| `used` | number | ยอดที่ใช้ไปแล้ว |
| `balance_amount` | number | ยอดคงเหลือ |

### Notes

- ถ้า `last_status = 1` ยอดทั้งหมดจะแสดงเป็น 0 (เอกสารถูกยกเลิก)
- `is_doc_copy <> 1` — ไม่นับเอกสารสำเนา

---

## 7. ยอดหนี้คงค้างรวม

```
GET /service/v1/getTotalBalance
```

คำนวณยอดหนี้คงค้างทั้งหมดของลูกค้า จาก Invoice (44), DN (46,93,95,99,101), CN (48,97,103)

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cust_code` | string | Yes | รหัสลูกค้า |

### Request Example

```
GET /service/v1/getTotalBalance?cust_code=C00001
```

### Response (200)

```json
{
  "success": true,
  "total_balance": 15840.50
}
```

| Field | Type | Description |
|---|---|---|
| `total_balance` | number | ยอดหนี้คงค้างสุทธิ (Invoice + DN - CN - การชำระ) |

### Response — ไม่มียอดค้างชำระ (200)

```json
{
  "success": true,
  "total_balance": 0
}
```

### Notes

- คำนวณจาก 3 ส่วนรวมกัน:
  1. **Invoice** (trans_flag=44) ยอด + balance ที่เหลือหลังหักการชำระ
  2. **DN** (trans_flag IN 46,93,99,95,101) เหมือน Invoice
  3. **CN** (trans_flag=48 + 97,103) หักออกจากยอด
- ตัดยอด ณ `date(NOW())` — ไม่รวมที่เกินกำหนดล่วงหน้า
- ยอดที่ balance = 0 จะถูก filter ออกด้วย `WHERE ar_balance <> 0`
