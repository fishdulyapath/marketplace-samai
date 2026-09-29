# Phase 6 — Document

Base path: `/service/v1`

---

## trans_flag Reference

| trans_flag | ประเภทเอกสาร |
|---|---|
| 40 | ใบมัดจำ (Deposit) |
| 44 | Invoice |
| 46 | ใบแจ้งหนี้ |
| 48 | ใบลดหนี้ (CN) |
| 30 | ใบเสนอราคา (QT) |
| 31 | ยกเลิก QT (SOC) |

---

## 1. รายการเอกสาร

```
GET /service/v1/getDocList
```

ดึงรายการเอกสารของลูกค้า พร้อมยอดหนี้คงค้าง — รองรับ filter ตาม trans_flag

### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `cust_code` | string | Yes | `""` | รหัสลูกค้า |
| `trans_flag` | integer | No | — | ถ้าไม่ระบุจะดึง trans_flag IN (40,44,48,46) ทั้งหมด |

### Request Example

```
GET /service/v1/getDocList?cust_code=C00001
GET /service/v1/getDocList?cust_code=C00001&trans_flag=44
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "inquiry_type": 0,
      "trans_flag": 44,
      "last_status": 0,
      "doc_no": "INV2401150001",
      "doc_date": "2024-01-15",
      "doc_time": "09:00:00",
      "cust_code": "C00001",
      "cust_name": "บริษัท ABC จำกัด",
      "send_type": 1,
      "total_amount": "1284.00",
      "cn_total_amount": "0",
      "emp_code": "EMP001",
      "emp_name": "สมชาย ใจดี",
      "remark": "",
      "ar_no": "RC2401150001",
      "total_discount": "0",
      "discount_word": "",
      "balance": "0",
      "status": null
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `trans_flag` | integer | ประเภทเอกสาร (ดู table ด้านบน) |
| `inquiry_type` | integer | ประเภท inquiry |
| `last_status` | integer | `0` = ปกติ, `1` = ยกเลิก |
| `doc_no` | string | เลขที่เอกสาร |
| `total_amount` | number | ยอดรวม (หักลบ CN) |
| `cn_total_amount` | number | ยอด CN |
| `balance` | number | ยอดค้างชำระสุทธิ |
| `ar_no` | string | เลขที่ใบเสร็จ (ap_ar_trans) ถ้ามี |
| `status` | string/null | `doc_group` field จาก ic_trans |
| `cust_name` | string | ชื่อลูกค้า |
| `discount_word` | string | ส่วนลดเป็นข้อความ |

### Notes

- เรียงตาม `create_datetime DESC, doc_no ASC`
- `balance` คำนวณจาก Invoice/DN/CN ทุก document ของลูกค้า ไม่ใช่เฉพาะ doc_no นี้

---

## 2. รายละเอียดเอกสาร

```
GET /service/v1/getDocDetail
```

ดึง header และ line items ของเอกสารเดี่ยว

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cust_code` | string | Yes | รหัสลูกค้า |
| `doc_no` | string | Yes | เลขที่เอกสาร |

### Request Example

```
GET /service/v1/getDocDetail?cust_code=C00001&doc_no=INV2401150001
```

### Response (200)

```json
{
  "success": true,
  "data": {
    "remark_5": "",
    "doc_no": "INV2401150001",
    "doc_date": "2024-01-15",
    "doc_time": "09:00:00",
    "cust_code": "C00001",
    "send_type": 1,
    "total_amount": "1284.00",
    "emp_code": "EMP001",
    "emp_name": "สมชาย ใจดี",
    "items": [
      {
        "item_code": "ITM001",
        "item_name": "น้ำดื่ม ABC 600ml",
        "unit_code": "ขวด",
        "wh_code": "WH01",
        "shelf_code": "A01",
        "stand_value": "1",
        "qty": "100",
        "divide_value": "1",
        "ratio": "1",
        "price": "12.00",
        "sum_amount": "1200.00"
      }
    ]
  }
}
```

### Response — ไม่พบเอกสาร (200)

```json
{ "success": true, "data": {} }
```

### Response Fields — items[]

| Field | Type | Description |
|---|---|---|
| `item_code` | string | รหัสสินค้า |
| `item_name` | string | ชื่อสินค้า |
| `unit_code` | string | หน่วย |
| `qty` | number | จำนวน |
| `price` | number | ราคาต่อหน่วย |
| `sum_amount` | number | ราคารวม |
| `wh_code` | string | รหัสคลัง |
| `shelf_code` | string | รหัส shelf |
| `stand_value` | number | ค่าตัวตั้ง |
| `divide_value` | number | ค่าตัวหาร |
| `ratio` | number | ratio |

### Notes

- ดึง items จาก `ic_trans_detail` ทุก row ของ doc_no นั้น — **ไม่** filter item_type เหมือน getOrderDetail
- ใช้ connection pool (pool.connect()) แยกต่างหากเพื่อ query 2 ครั้งใน transaction เดียวกัน

---

## 3. ข้อมูลบริษัท

```
GET /service/v1/getCompanyProfile
```

ดึงข้อมูลบริษัทจาก `erp_company_profile` (row แรก)

### Query Parameters

ไม่มี

### Request Example

```
GET /service/v1/getCompanyProfile
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "company_name": "บริษัท SML จำกัด",
      "address": "456/7 ถ.รัชดาภิเษก กรุงเทพฯ 10400",
      "telephone_number": "02-987-6543"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `company_name` | string | ชื่อบริษัท (`company_name_1`) |
| `address` | string | ที่อยู่ (`address_1`) |
| `telephone_number` | string | เบอร์โทร |

### Notes

- `data` เป็น array แต่จะมีแค่ 1 element เสมอ (LIMIT 1 ใน query)
