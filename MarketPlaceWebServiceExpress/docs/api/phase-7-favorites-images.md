# Phase 7 — Favorites & Images

Base path: `/service/v1`

---

## 1. ตั้งค่า/ยกเลิกสินค้าโปรด

```
GET /service/v1/setfav
```

เพิ่มหรือเปลี่ยน status สินค้าโปรดในตาราง `ar_item_by_customer`  
ทำงานแบบ **DELETE + INSERT** — ลบเดิมก่อนเสมอ แล้ว insert ใหม่

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cust_code` | string | Yes | รหัสลูกค้า |
| `item_code` | string | Yes | รหัสสินค้า |
| `status` | string | Yes | `"1"` = favorite, `"0"` = ยกเลิก |

### Request Example

```
GET /service/v1/setfav?cust_code=C00001&item_code=ITM001&status=1
```

### Response (200)

```json
{ "success": true }
```

### Response — Error (400)

```json
{ "ERROR": "..." }
```

### Notes

- ใช้ DELETE + INSERT แทน UPSERT — ดังนั้น `status` จะถูก **เขียนทับ** ค่าเดิมเสมอ
- ถ้า `status="0"` จะ DELETE เดิม แล้ว insert ใหม่ด้วย status=0 (ยังมี row อยู่ใน DB)
- `favorite_item` field ใน getProductList/getProductDetail เชื่อมกับ table นี้

---

## 2. รายการ Image ID ของสินค้า

```
GET /service/v1/getImageList
```

ดึง metadata รูปภาพของสินค้าจากฐานข้อมูล `demo_images`  
ใช้ก่อนดาวน์โหลดภาพจริง เพื่อรู้ว่ามีกี่รูปและ guid ของแต่ละรูป

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `item_code` | string | Yes | รหัสสินค้า (ตรงกับ `image_id` ในตาราง images) |

### Request Example

```
GET /service/v1/getImageList?item_code=ITM001
```

### Response (200)

```json
{
  "success": true,
  "data": [
    {
      "image_id": "ITM001",
      "guid_code": "550e8400-e29b-41d4-a716-446655440000"
    },
    {
      "image_id": "ITM001",
      "guid_code": "661f9511-f3ac-52e5-b827-557766551111"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `image_id` | string | รหัสสินค้า (= item_code ที่ส่งมา) |
| `guid_code` | string | UUID ของรูปนี้ — ใช้เรียก `/imagesguid` |

### Notes

- เรียงตาม `image_order ASC`
- รูปหลัก (แรก) ดึงได้จาก `/images?item_code=ITM001` โดยตรง
- รูปเพิ่มเติม (ถ้ามีหลายรูป) ดึงผ่าน `/imagesguid?guid_code=<guid>`

---

## 3. ดาวน์โหลดภาพตาม item_code

```
GET /service/v1/images
```

ส่งคืนข้อมูล binary ของรูปภาพแรกของสินค้านั้น  
รูปสินค้าถูก cache 1 ชั่วโมง หลัง cache หมดอายุ request ถัดไปจะกลับไปดึงรูปจาก server ใหม่

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `item_code` | string | Yes | รหัสสินค้า |

### Request Example

```
GET /service/v1/images?item_code=ITM001
```

### Response — พบภาพ (200)

```
Content-Type: image/png
Cache-Control: public, max-age=3600, must-revalidate
Content-Length: 48291

[binary image data]
```

### Response — ไม่พบภาพ (404)

```
Content-Type: text/plain

ERROR: image not found
```

### Response — item_code ว่าง (400)

```
Content-Type: text/plain

ERROR: item_code is required
```

### Response Headers

| Header | Value | Description |
|---|---|---|
| `Content-Type` | `image/png` | ประเภทไฟล์ (fix เป็น PNG เสมอ แม้ไฟล์จริงจะเป็น JPEG) |
| `Cache-Control` | `public, max-age=3600, must-revalidate` | Cache รูปสินค้า 1 ชั่วโมง |
| `Content-Length` | integer | ขนาดไฟล์ (bytes) |

### Notes

- ภายใน 1 ชั่วโมง browser/proxy อาจใช้รูปจาก cache; หลังครบ 1 ชั่วโมง request ถัดไปจะกลับไปดึงจาก server ใหม่
- Content-Type ตายตัว `image/png` ไม่ว่าไฟล์จริงจะเป็นอะไร

---

## 4. ดาวน์โหลดภาพตาม guid_code

```
GET /service/v1/imagesguid
```

ส่งคืนรูปภาพตาม `guid_code` จากตาราง `images` — ใช้สำหรับรูปที่ 2, 3, ... ของสินค้า  
ต่างจาก `/images` ตรงที่ **ไม่ return 404** ถ้าไม่พบ — จะ return empty image แทน

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `guid_code` | string | Yes | GUID ของรูปภาพ (จาก getImageList) |

### Request Example

```
GET /service/v1/imagesguid?guid_code=550e8400-e29b-41d4-a716-446655440000
```

### Response — พบภาพ (200)

```
Content-Type: image/png
Cache-Control: public, max-age=3600, must-revalidate
Content-Length: 48291

[binary image data]
```

### Response — ไม่พบภาพ (200, empty)

```
Content-Type: image/png
Content-Length: 0

[empty buffer — 0 bytes]
```

### ความแตกต่างกับ `/images`

| ข้อ | `/images` | `/imagesguid` |
|---|---|---|
| ค้นหาด้วย | `image_id` (= item_code) | `guid_code` |
| ถ้าไม่พบ | 404 + error text | 200 + empty buffer |
| ถ้า guid ว่าง | 400 error | 200 + empty buffer |
| Error handling | throw แสดง error | catch และ return empty |
| ใช้งาน | รูปหลักของสินค้า | รูปเพิ่มเติม (รูปที่ 2, 3...) |

### Notes

- ใช้ในกรณีที่ frontend ต้องการแสดงรูปหลายรูปของสินค้า:
  1. เรียก `getImageList` เพื่อรายการ guid ทั้งหมด
  2. เรียก `imagesguid` ทีละ guid
- ถ้า guid ไม่มีอยู่ใน DB จะได้ empty buffer (ขนาด 0 bytes) — ต้องตรวจ `Content-Length` ใน client
