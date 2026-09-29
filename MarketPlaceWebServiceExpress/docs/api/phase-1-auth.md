# Phase 1 — Authentication

Base path: `/service/v1`

---

## 1. Login พนักงาน

```
GET /service/v1/loginemp
```

ตรวจสอบรหัสผ่านจากตาราง `erp_user` (case-insensitive บน code)

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_code` | string | Yes | รหัสพนักงาน (ไม่ case-sensitive) |
| `password` | string | Yes | รหัสผ่าน (case-sensitive) |

### Request Example

```
GET /service/v1/loginemp?user_code=ADMIN&password=1234
```

### Response — Success (200)

```json
{
  "success": true,
  "data": [
    {
      "user_code": "ADMIN",
      "user_name": "ผู้ดูแลระบบ"
    }
  ]
}
```

> `data` เป็น array — ถ้า login สำเร็จจะมี 1 element ถ้า credential ผิดจะได้ `data: []`

### Response — Login ไม่ผ่าน (200, data empty)

```json
{
  "success": true,
  "data": []
}
```

> **หมายเหตุ:** API ไม่ return HTTP 401 เมื่อ login ผิด — ต้องตรวจสอบ `data.length === 0` เอง

### Response — Error (400)

```json
{
  "ERROR": "database connection error ..."
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `success` | boolean | สถานะการเรียก API |
| `data[].user_code` | string | รหัสพนักงาน |
| `data[].user_name` | string | ชื่อพนักงาน (`name_1` ในตาราง) |

---

## 2. Login ลูกค้า

```
GET /service/v1/logincus
```

ตรวจสอบลูกค้าจาก `ar_customer.code` หรือ `ar_customer.email` โดยรหัสผ่านเก็บไว้ใน field `fax` และรองรับผู้ติดต่อจาก `ar_contactor.telephone`/`ar_contactor.mobile`

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_code` | string | Yes | รหัสลูกค้า, อีเมล์ลูกค้า, หรือเบอร์โทรผู้ติดต่อ |
| `password` | string | Yes | รหัสผ่านลูกค้า (`ar_customer.fax`) หรือรหัสผ่านผู้ติดต่อ (`ar_contactor.mobile`) |

### Request Example

```
GET /service/v1/logincus?user_code=C00001&password=mypassword
```

### Response — Success (200)

```json
{
  "success": true,
  "data": [
    {
      "user_code": "C00001",
      "user_name": "บริษัท ABC จำกัด",
      "address": "123/4 ถ.สุขุมวิท กรุงเทพฯ",
      "telephone": "02-123-4567",
      "tax_id": "0105560123456",
      "contact_code": "",
      "contact_name": "",
      "login_source": "customer"
    }
  ]
}
```

### Response — Login ไม่ผ่าน (200, data empty)

```json
{
  "success": true,
  "data": []
}
```

### Response — Error (400)

```json
{
  "ERROR": "..."
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `success` | boolean | สถานะการเรียก API |
| `data[].user_code` | string | รหัสลูกค้า |
| `data[].user_name` | string | ชื่อลูกค้า (`name_1`) |
| `data[].address` | string | ที่อยู่ |
| `data[].telephone` | string | เบอร์โทรศัพท์ |
| `data[].tax_id` | string | เลขประจำตัวผู้เสียภาษี (จาก `ar_customer_detail`) ถ้าไม่มีจะเป็น `""` |
| `data[].contact_code` | string | รหัสผู้ติดต่อเมื่อ login ผ่าน `ar_contactor`; ถ้า login ลูกค้าโดยตรงจะเป็น `""` |
| `data[].contact_name` | string | ชื่อผู้ติดต่อเมื่อ login ผ่าน `ar_contactor`; ถ้าไม่มีจะเป็น `""` |
| `data[].login_source` | string | `customer` หรือ `contact` |

### Notes

- รหัสผ่านของลูกค้าถูกเก็บใน field `fax` ของตาราง `ar_customer`
- ถ้า login ผ่านผู้ติดต่อ ระบบคืน `user_code` เป็นรหัสลูกค้าแม่ และคืน `contact_code` เพื่อให้ frontend ส่งไปบันทึกที่ `ic_trans.remark_5` ตอนสั่งซื้อ
- `tax_id` มาจาก subquery ใน `ar_customer_detail` — อาจเป็น `""` ถ้าไม่ได้กรอก
