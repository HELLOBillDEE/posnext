# วิธีติดตั้ง POS App (GitHub → Vercel → Supabase)

## ขั้นตอนที่ 1 — ตั้งค่า Supabase

1. เข้า **https://supabase.com** → สร้าง New Project
2. ตั้งชื่อโปรเจกต์ + password → รอ 1-2 นาที
3. ไปที่ **SQL Editor** → วาง code ทั้งหมดใน `supabase/schema.sql` → กด **Run**
4. ไปที่ **Settings → API** → คัดลอก:
   - `Project URL`
   - `anon public` key

---

## ขั้นตอนที่ 2 — ตั้งค่า GitHub

1. สร้าง Repository ใหม่ที่ GitHub (เช่น `my-pos-app`)
2. คัดลอก folder `pos-next/` ทั้งหมดขึ้น repository
3. (ถ้าใช้ command line):
   ```bash
   cd pos-next
   git init
   git add .
   git commit -m "Initial POS App"
   git remote add origin https://github.com/YOUR_USERNAME/my-pos-app.git
   git push -u origin main
   ```

---

## ขั้นตอนที่ 3 — Deploy ขึ้น Vercel

1. เข้า **https://vercel.com** → Login ด้วย GitHub
2. กด **New Project** → เลือก repository ที่สร้าง
3. ตั้งค่า **Environment Variables**:
   ```
   NEXT_PUBLIC_SUPABASE_URL = (Project URL จาก Supabase)
   NEXT_PUBLIC_SUPABASE_ANON_KEY = (anon public key จาก Supabase)
   ```
4. กด **Deploy** → รอ 1-2 นาที → ได้ URL แอป

---

## ขั้นตอนที่ 4 — เปิดบน iPad

1. เปิด URL จาก Vercel ใน Safari บน iPad
2. กด Share → **Add to Home Screen** → ได้ไอคอนแอปบนหน้าจอ

---

## ขั้นตอนที่ 5 — ตั้งค่าครั้งแรก

1. เปิดแอป → กด **⚙️ ตั้งค่า** → กรอกชื่อร้าน, ที่อยู่, เลขภาษี
2. กด **📦 สินค้า** → เพิ่มสินค้า + หมวดหมู่
3. เริ่มขายที่ **🛒 ขาย** ได้เลย

---

## โครงสร้างโปรเจกต์

```
pos-next/
├── src/
│   ├── app/
│   │   ├── page.js          ← หน้าหลัก Dashboard
│   │   ├── pos/page.js      ← หน้าขาย (บาร์โค้ด + ชำระเงิน)
│   │   ├── products/page.js ← จัดการสินค้า + ปริ้นบาร์โค้ด
│   │   ├── po/page.js       ← ใบสั่งซื้อ
│   │   ├── documents/page.js← ดูเอกสาร + พิมพ์
│   │   ├── reports/page.js  ← รายงานยอดขาย
│   │   ├── employees/page.js← พนักงาน + สลิปเงินเดือน
│   │   └── admin/page.js    ← ตั้งค่า, ลูกค้า, ซัพพลายเออร์
│   ├── components/Nav.js    ← แถบนำทางด้านล่าง
│   └── lib/
│       ├── supabase.js      ← Supabase client
│       └── utils.js         ← helper functions (Thai barcode, fmt)
└── supabase/schema.sql      ← ฐานข้อมูลทั้งหมด
```

---

## ฟีเจอร์ที่พัฒนาในอนาคต (Tax Documents)

ระบบรองรับการเพิ่มหน้าเหล่านี้ได้ทันที:
- **ใบกำกับภาษี VAT** (ภ.พ.01) — อิงจากข้อมูลบิลขาย
- **ใบหัก ณ ที่จ่าย** (ภ.ง.ด.1, 3, 53) — อิงจากข้อมูลพนักงาน / ซัพพลายเออร์
- **รายงานภาษีซื้อ/ขาย** (ภ.พ.30) — สรุปจาก sales + purchase_orders
- **ใบสำคัญค่าใช้จ่ายที่ลดหย่อนได้** (ภ.ง.ด.90/94) — อิงจาก expenses table
