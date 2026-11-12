# VERITAS

Verification Engine for Repository Integrity, Testing & Assessment of Software

วางโค้ดลงใน `code/` แล้ว VERITAS จะตรวจคุณภาพ 10 มิติ ให้คะแนน เกรด และชี้บรรทัดที่มีปัญหา
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
bun run typecheck   # ตรวจ type ทั้ง 3 package
bun test            # รันเทสต์ทั้งหมด (VERITAS_NETWORK_TESTS=1 เพื่อรวมเทสต์ Semgrep/OSV)
bun run lint        # Biome
```

เครื่องมือภายนอกที่ต้องติดตั้งเอง (ถ้าไม่มี มิตินั้นจะขึ้น "skipped" พร้อมเหตุผล):

```sh
brew install ruff semgrep gitleaks osv-scanner
```

## ตั้งค่า

แก้ `veritas.config.ts` ทุกค่าไม่บังคับ ดูรายการทั้งหมดที่ `shared/src/schemas/config.schema.ts`
