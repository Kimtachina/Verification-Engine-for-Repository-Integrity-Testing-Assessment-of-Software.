# VERITAS

Verification Engine for Repository Integrity, Testing & Assessment of Software

วางโค้ดลงใน `code/` หรือกด "อัปโหลดโฟลเดอร์" ในหน้าเว็บ แล้ว VERITAS จะตรวจคุณภาพ 10 มิติ ให้คะแนน เกรด และชี้บรรทัดที่มีปัญหา
โค้ดที่ตรวจจะไม่ถูกรัน ติดตั้ง หรือ build — วิเคราะห์แบบ static เท่านั้น

แผนเต็ม: [docs/PLAN.md](docs/PLAN.md)

## โครงสร้าง

| โฟลเดอร์ | หน้าที่ |
|---|---|
| `code/` | โค้ดที่ต้องการตรวจ (git ไม่ติดตาม) |
| `shared/` | สัญญากลาง: Zod schema และค่าคงที่ที่ทั้งสองฝั่งใช้ |
| `backend/` | เครื่องยนต์ตรวจ, API, CLI |
| `frontend/` | แดชบอร์ด |
| `docs/` | เอกสาร |

## คำสั่ง

```sh
bun install
bun run scan        # สแกน code/ แล้วแสดงผลใน terminal (--help ดูตัวเลือก)
bun run api         # เปิด API ที่ http://127.0.0.1:4000 (เอกสาร: docs/api.md)
bun run web         # เปิดหน้าเว็บ dashboard ที่ http://localhost:3000 (ต้องเปิด api ก่อน)
bun run scan -- --report out.html --report out.sarif   # ส่งออกรายงาน (.json .md .html .sarif)
bun run typecheck   # ตรวจ type ทั้ง 3 package
bun test            # รันเทสต์ทั้งหมด (VERITAS_NETWORK_TESTS=1 เพื่อรวมเทสต์ Semgrep/OSV)
bun run lint        # Biome
```

เครื่องมือภายนอกที่ต้องติดตั้งเอง (ถ้าไม่มี มิตินั้นจะขึ้น "skipped" พร้อมเหตุผล):

```sh
brew install ruff semgrep gitleaks osv-scanner
```

## ฐานข้อมูล (Supabase)

ผลสแกนเก็บใน Supabase โปรเจกต์ `veritas` ตั้งค่าครั้งแรก:

1. คัดลอก `.env.example` เป็น `.env`
2. ใน Supabase dashboard กด **Connect** แล้วเลือก **Session pooler** คัดลอก URI มาใส่ `DATABASE_URL` และใส่รหัสผ่านฐานข้อมูลแทน `[YOUR-PASSWORD]` ถ้าจำไม่ได้ ให้ตั้งใหม่ที่ Project Settings → Database
3. `bun run api` จะสร้างตารางให้เองตอนเปิดครั้งแรก

ตารางอยู่ใน schema `veritas` ซึ่งไม่เปิดผ่าน REST API ของ Supabase และเปิด RLS ไว้ เข้าถึงได้ทาง backend ของ VERITAS เท่านั้น ถ้าไม่ตั้ง `DATABASE_URL` จะเก็บใน Postgres ฝังในเครื่องที่ `.veritas/pgdata` แทน ไฟล์ `.env` ถูก git ignore ไม่ถูก push ขึ้น GitHub

## ตั้งค่า

แก้ `veritas.config.ts` ทุกค่าไม่บังคับ ดูรายการทั้งหมดที่ `shared/src/schemas/config.schema.ts`
