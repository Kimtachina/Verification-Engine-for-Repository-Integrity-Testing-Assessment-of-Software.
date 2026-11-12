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
bun run typecheck   # ตรวจ type ทั้ง 3 package
bun test            # รันเทสต์ทั้งหมด
bun run lint        # Biome
```

## ตั้งค่า

แก้ `veritas.config.ts` ทุกค่าไม่บังคับ ดูรายการทั้งหมดที่ `shared/src/schemas/config.schema.ts`
