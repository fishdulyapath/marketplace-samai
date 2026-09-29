# MarketPlace Docker Deploy

โฟลเดอร์นี้รวมไฟล์ deploy สำหรับ `MarketPlaceWeb` และ `MarketPlaceWebServiceExpress` ไว้ที่เดียว

## โครงสร้าง

- `docker-compose.yaml` รัน frontend nginx และ backend Express
- `.env.example` ตัวอย่าง env สำหรับ backend/database/compose
- `frontend.env.example` ตัวอย่าง env ที่ใช้ตอน build frontend เพราะ Vite bake ค่าเข้าไฟล์ static
- `sql/001_marketplace_bootstrap.sql` SQL bootstrap สำหรับตาราง/column ที่ marketplace เพิ่มเอง
- `scripts/build.ps1` build frontend แล้ว build docker images
- `scripts/deploy.ps1` build แล้ว `docker compose up -d`
- `scripts/migrate.ps1` run SQL bootstrap ด้วย postgres client container
- `scripts/publish-web.ps1` build/tag/push frontend image ไป Docker Hub
- `scripts/pull-web.ps1` pull frontend image จาก Docker Hub
- `scripts/publish-api.ps1` build/tag/push backend image ไป Docker Hub
- `scripts/pull-api.ps1` pull backend image จาก Docker Hub
- `data/content` volume สำหรับ config หน้าแรก ธีม layout และรูปหมวดหมู่ metadata
- `data/media` volume สำหรับ media upload

## เตรียม env

```powershell
Copy-Item .env.example .env
Copy-Item frontend.env.example frontend.env
```

แก้ `docker-deploy\.env` ให้ตรง DB production และแก้ `docker-deploy\frontend.env` ให้ `VITE_APP_API` เป็น URL API ที่ browser ลูกค้าจะเรียกได้จริง เช่น `http://your-server:47300/`

## การสร้าง database object

ตั้งแต่ API image รุ่นที่มี auto-migration แล้ว การ deploy ปกติใช้เพียง `pull` และ
`up -d` ได้เลย API จะสร้าง `staff_cart_order`, `pos_basket` และ incremental schema
ของ Marketplace ตามลำดับก่อนเปิดพอร์ต โดยไม่แก้หรือล้างตาราง ERP:

```bash
docker compose pull
docker compose up -d --force-recreate
```

`migrate.ps1` คงไว้สำหรับระบบเก่าหรือการซ่อม bootstrap ด้วยมือเท่านั้น ไม่จำเป็น
สำหรับ fresh installation ที่ใช้ API image รุ่นใหม่:

```powershell
.\scripts\migrate.ps1
```

สคริปต์นี้ใช้ Docker image `postgres:16-alpine` เป็น client จึงไม่ต้องติดตั้ง `psql` ในเครื่อง deploy

API จะรัน migration ที่อยู่ใน allowlist อัตโนมัติก่อนเปิดพอร์ตทุกครั้ง โดยเก็บประวัติและ checksum ไว้ใน
`marketplace_schema_migration` หาก migration ล้มเหลว API จะไม่เริ่มทำงาน

ค่าเริ่มต้นคือเปิดใช้งานทุก environment หากต้องข้ามชั่วคราวในกรณีฉุกเฉินให้ตั้ง:

```dotenv
MARKETPLACE_AUTO_MIGRATE=0
```

Auto-migration ไม่รัน migration ฐาน License, migration ที่แก้ข้อมูล ERP หรือไฟล์เก่า
ที่ไม่ idempotent

หมายเหตุ: bootstrap นี้ไม่สร้างหรือแก้ `ic_inventory_price_formula`, `ic_inventory_replacement`, `ic_inventory_suggest` เพราะเป็น table ของระบบ ERP เดิมที่ควรคง schema ตามโปรแกรมหลัก

## Build และ deploy

```powershell
.\scripts\deploy.ps1
```

ค่า default จะไม่รัน `npm ci` ซ้ำเพื่อเลี่ยงปัญหา Windows lock ไฟล์ใน `node_modules` ระหว่างมี dev server หรือ antivirus ทำงาน ถ้ามีการเปลี่ยน dependency ให้รัน:

```powershell
.\scripts\deploy.ps1 -InstallDependencies
```

หลัง deploy:

- Web: `http://<server>:<HOST_PORT>/` (เช่น `http://103.13.228.166:6312/`)
- API: `http://<server>:47301/health`

## Publish frontend image ไป Docker Hub

Docker Hub image ที่ใช้:

```powershell
minorsoft/marketplacesamai:latest
minorsoft/marketplacesamai-api:latest
```

คำสั่งผ่าน script:

```powershell
.\scripts\publish-web.ps1
```

เทียบเท่ากับ flow นี้ โดย script จะ build frontend `dist` ก่อน:

```powershell
docker build -t minorsoft/marketplacesamai .
docker tag minorsoft/marketplacesamai minorsoft/marketplacesamai:latest
docker push minorsoft/marketplacesamai:latest
docker pull minorsoft/marketplacesamai:latest
```

ถ้าไม่ใช้ script และต้องการ build frontend เอง ให้ copy env สำหรับ production เข้าโปรเจค frontend ก่อน เพราะค่า Vite จะถูกฝังตอน build:

```powershell
Copy-Item .\frontend.env ..\MarketPlaceWeb\.env.production.local -Force
docker build -t minorsoft/marketplacesamai ..\MarketPlaceWeb
docker tag minorsoft/marketplacesamai minorsoft/marketplacesamai:latest
docker push minorsoft/marketplacesamai:latest
```

ถ้าต้องการ pull image อย่างเดียว:

```powershell
.\scripts\pull-web.ps1
.\scripts\pull-api.ps1
```

Publish backend API:

```powershell
.\scripts\publish-api.ps1
```

## Windows Server 2012 แบบ IIS + Backend Docker Ubuntu

ถ้าแยกเครื่องตามที่คุณต้องการ ให้ deploy เป็น 2 ส่วน:

- Frontend: build เป็นไฟล์ static แล้วให้ IIS serve
- Backend: รัน `MarketPlaceWebServiceExpress` ใน Docker บน Ubuntu server

กรณีของคุณที่ backend อยู่คนละเซิร์ฟเวอร์กับ frontend ให้ตั้งค่าแบบนี้:

- Frontend IIS เรียก API ไปยัง backend ผ่าน URL เต็ม เช่น `http://backend-server:47300/`
- ค่า `VITE_APP_API` ต้องชี้ไปยัง backend server ตัวนั้น ไม่ใช่ localhost ของเครื่อง build
- ถ้า frontend ไม่ได้อยู่ที่ root ของ IIS site ให้ตั้ง `VITE_APP_BASE_URL` ให้ตรงกับ virtual path เช่น `/app/`

### 1) Frontend บน IIS

1. Build frontend จาก `MarketPlaceWeb` ด้วย production mode
2. วางไฟล์ build output ไว้ใต้โฟลเดอร์ site ของ IIS
3. สร้าง IIS site ใหม่ และ bind ด้วย port หรือ hostname ที่ต้องการ
4. ตั้ง `index.html` ให้เป็น default document
5. เพิ่ม URL Rewrite rule ให้ route ของ SPA fallback กลับไป `index.html`
6. ถ้า route ของ frontend อยู่ใต้ path เช่น `/app/` ให้ตั้งค่า base path ให้ตรงกับ path นั้นตอน build

ถ้าจะให้ frontend เรียก backend ผ่านโดเมนเดียวกัน ให้ตั้ง reverse proxy ใน IIS ไปยัง backend service หรือใช้ subdomain แยก เช่น `api.domain.local`

### 2) Backend บน Docker Ubuntu

Backend เริ่มจาก `MarketPlaceWebServiceExpress\src\index.js` และฟังที่พอร์ต `47300` โดยค่าเริ่มต้น.

บน Ubuntu ให้รัน backend เป็น Docker container และ expose พอร์ตออกมาที่โฮสต์:

```powershell
docker run -d --name marketplace-samai-api -p 47300:47300 --env-file .env minorsoft/marketplacesamai-api:latest
```

ถ้าใช้ docker compose ให้ map พอร์ตและ volume สำหรับ data/content/media ให้ตรงกับโครงสร้างของโปรเจกต์ โดยตั้งค่า:

- `PORT=47300`
- `MARKETPLACE_DATA_DIR=/app/data`
- `MARKETPLACE_CONTENT_DIR=/app/data/content`
- `MARKETPLACE_MEDIA_DIR=/app/data/media`
- volume สำหรับ `./data/content` และ `./data/media`

service นี้ expose endpoint หลักดังนี้:

- `GET /health`
- API หลักใต้ `/service/v1`
- `GET /api-docs`
- static media ที่ `/media`

ถ้าจะให้ frontend เรียก backend ข้ามเครื่องตรง ๆ โดยไม่ใช้ reverse proxy ให้เปิด firewall เฉพาะพอร์ต backend ที่จำเป็น และพิจารณา lock origin/CORS ให้เหมาะสมกับโดเมนหรือ IP ที่ใช้งานจริง

- ถ้า backend อยู่บน Ubuntu Docker แล้ว frontend อยู่บน IIS คนละเครื่อง ให้แน่ใจว่า DNS หรือ IP ของ Ubuntu เข้าถึงได้จากเครื่อง Windows ที่เปิดเว็บ

### 3) ค่าที่ต้องเตรียมบน server

1. Database connection สำหรับ backend
2. โฟลเดอร์ถาวรสำหรับ content และ media
3. พอร์ตสำหรับ IIS site ของ frontend
4. พอร์ตของ backend container ที่เปิดออกจาก Ubuntu host

### 4) โครงสร้างโฟลเดอร์ที่แนะนำ

- `C:\MarketPlace\web` สำหรับไฟล์ static ของ IIS
- `/opt/marketplace/api` หรือ path เทียบเท่าสำหรับ backend container host บน Ubuntu
- `C:\MarketPlace\data\content` สำหรับ content runtime
- `C:\MarketPlace\data\media` สำหรับ media runtime
- `C:\MarketPlace\logs` สำหรับ log ของ service

### 5) ลำดับติดตั้งที่แนะนำ

1. ติดตั้ง IIS + URL Rewrite
2. เตรียม database และรัน bootstrap SQL
3. เตรียม backend image, ตั้งค่า Docker Ubuntu และเปิดพอร์ต 47300
4. build frontend แล้ว deploy เข้า IIS
5. ทดสอบ `GET /health`
6. ทดสอบหน้าเว็บหลัก, login, cart, และ upload media

### 6) หมายเหตุสำคัญ

- ถ้า frontend กับ backend อยู่คนละ origin ให้ตรวจ CORS และ API URL ใน frontend ให้ตรง
- ถ้าใช้โดเมนเดียวกันผ่าน IIS reverse proxy จะลดปัญหา CORS ลงได้มาก
- Windows Server 2012 ค่อนข้างเก่า ถ้ามีตัวเลือก แนะนำ 2019/2022 จะดูแลง่ายกว่าและรองรับ tooling ใหม่กว่ามาก

## อัปเดต content ของร้านใน persistent volume

ไฟล์ใน `data/content` เป็น runtime data ที่อยู่นอก Docker image จึงต้องอัปเดตแยกจากการ pull image ก่อน deploy แบรนด์ใหม่:

1. ตรวจ `MARKETPLACE_CONTENT_SCOPE` ใน `.env`
2. แก้ title ใน `hero` และ slide หลักของ `data/content/marketplace-content.<scope>.json` เป็น `สมัยการค้า`
3. หาก scope เป็น `database` ให้ใช้ชื่อไฟล์ที่มาจาก `DB_NAME`; หากเป็น `global` ให้แก้ `data/content/marketplace-content.json`
4. restart `marketplace-api` หลังบันทึกไฟล์

ตัวอย่าง source ของร้านนี้อยู่ที่ `MarketPlaceWebServiceExpress/data/content/marketplace-content.wawacrm.json` แล้ว และเก็บข้อมูลติดต่อเดิมไว้ตามค่า frontend env ชั่วคราว

## Volume ที่ต้อง backup

- `docker-deploy\data\content`
- `docker-deploy\data\media`

สองโฟลเดอร์นี้เป็นข้อมูล runtime ที่ไม่ได้อยู่ใน image ถ้าย้ายเครื่องให้ copy ไปพร้อม DB

## คำสั่งดูสถานะ

```powershell
docker compose -f .\docker-compose.yaml --env-file .\.env ps
docker compose -f .\docker-compose.yaml --env-file .\.env logs -f marketplace-api
docker compose -f .\docker-compose.yaml --env-file .\.env logs -f marketplace-web
```

docker compose -f .\docker-compose.yaml --env-file .\.env down --remove-orphans
docker compose -f .\docker-compose.yaml --env-file .\.env pull
docker compose -f .\docker-compose.yaml --env-file .\.env up -d --force-recreate


cd D:\FishSoft\MarketPlace-samai\docker-deploy

Copy-Item .\frontend.env ..\MarketPlaceWeb\.env.production.local -Force
docker build -t minorsoft/marketplacesamai ..\MarketPlaceWeb
docker tag minorsoft/marketplacesamai minorsoft/marketplacesamai:latest
docker push minorsoft/marketplacesamai:latest



cd D:\FishSoft\MarketPlace\MarketPlaceWebServiceExpress

docker build -t minorsoft/marketplacesamai-api .
docker tag minorsoft/marketplacesamai-api minorsoft/marketplacesamai-api:latest
docker push minorsoft/marketplacesamai-api:latest



docker compose -f .\docker-compose.yaml --env-file .\.env up -d


cd D:\FishSoft\MarketPlace-samai\docker-deploy

# build + push ทั้งคู่
.\scripts\publish-all.ps1

# ถ้าไม่ต้องการ npm ci (เร็วขึ้น)
.\scripts\publish-all.ps1 -SkipNpmCi
แล้วบน server:


cd /data/fishsoftmarketplace
docker compose pull && docker compose up -d --force-recreate

# จาก Windows
scp D:\FishSoft\MarketPlace\docker-deploy\.env kungg@demserver.3bbddns.com:/data/fishsoftmarketplace/.env
scp D:\FishSoft\MarketPlace\docker-deploy\docker-compose.yaml kungg@demserver.3bbddns.com:/data/fishsoftmarketplace/docker-compose.yaml
scp D:\FishSoft\MarketPlace\docker-deploy\nginx.conf kungg@demserver.3bbddns.com:/data/fishsoftmarketplace/nginx.conf


chmod -R 777 data/content
chmod -R 777 data/media
docker compose restart marketplace-api


Banner หลักขนาด 1680 × 640 px อัตราส่วน 21:8 ซึ่งตรงกับค่าที่ระบบรองรับและเหมาะกับหน้าจอ Desktop

| ขนาด Banner | คอลัมน์ที่กิน | ขนาดภาพแนะนำ | อัตราส่วน |
|---|---:|---:|---:|
| เล็ก | 1 คอลัมน์ | **960 × 300 px** | 16:5 |
| กลาง | 2 คอลัมน์ | **1600 × 500 px** | 16:5 |
| เต็มแถว | 3 คอลัมน์ | **2560 × 800 px** | 16:5 |

การตั้งค่าในหลังบ้าน:
- Height Mode: Aspect ratio
- Aspect Ratio: 16:5 banner
- Image Fit: Cover
- Width: 1, 2 หรือ Full ตามขนาดภาพด้านบน
ถ้าเลือกสูง 2 แถว ให้ใช้ภาพสูงขึ้นประมาณ 2 เท่าและเลือก Auto image height เช่น:
- 1 คอลัมน์: 960 × 600 px
- 2 คอลัมน์: 1600 × 1000 px
- เต็มแถว: 2560 × 1600 px
