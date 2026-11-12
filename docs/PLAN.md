# VERITAS — แผนโครงการ

Verification Engine for Repository Integrity, Testing & Assessment of Software

เป้าหมาย: วางโค้ดลงในโฟลเดอร์ `code/` แล้วได้ผลตรวจคุณภาพละเอียดทุกมิติ พร้อมคะแนน เกรด และตำแหน่งบรรทัดที่มีปัญหา ดูได้ทั้งบนเว็บและจากบรรทัดคำสั่ง

## 1. การตัดสินใจหลัก

| เรื่อง | เลือก | เหตุผล |
|---|---|---|
| ภาษา | TypeScript ทั้งระบบ | ใช้ type และ schema ชุดเดียวทั้ง frontend และ backend |
| Backend | Bun + Elysia | เร็ว, รัน TypeScript ตรง, เรียกโปรแกรมภายนอกง่าย |
| Frontend | Next.js (App Router) + Tailwind + shadcn/ui | |
| ฐานข้อมูล | SQLite + Drizzle | ไฟล์เดียว ไม่ต้องตั้ง server เหมาะกับเครื่องมือที่รันในเครื่อง |
| สัญญากลาง | Zod ใน `shared/` | ตรวจข้อมูลที่ขอบระบบทั้งสองฝั่งด้วย schema เดียว |
| วิธีตรวจ | ใช้เครื่องมือมาตรฐานเป็นหลัก + ตัวตรวจที่เขียนเอง | เครื่องมือมาตรฐานมีกฎหลายพันข้อที่ผ่านการใช้งานจริง เขียนเองทั้งหมดจะตรวจได้น้อยกว่าและผิดมากกว่า |
| ภาษาที่ตรวจ | TypeScript/JavaScript และ Python เต็มรูปแบบ, ภาษาอื่นตรวจได้ในมิติที่ไม่ขึ้นกับภาษา | |
| ความปลอดภัย | วิเคราะห์แบบ static เท่านั้น | ไม่รัน ไม่ install ไม่ build โค้ดใน `code/` เด็ดขาด |

## 2. โครงสร้างโฟลเดอร์

```
veritas/
├── code/                        ← วางโค้ดที่ต้องการตรวจ (git ไม่ติดตามเนื้อหา)
│
├── backend/
│   ├── src/
│   │   ├── server.ts            ← จุดเริ่ม API
│   │   ├── cli.ts               ← `veritas scan` สำหรับ terminal และ CI
│   │   ├── routes/              ← scans.route.ts, findings.route.ts,
│   │   │                          reports.route.ts, health.route.ts
│   │   ├── engine/
│   │   │   ├── pipeline.ts      ← discover → analyze → normalize → score
│   │   │   ├── discovery/       ← ไล่ไฟล์, ตรวจภาษา, กฎการข้ามไฟล์
│   │   │   ├── analyzers/       ← 1 ไฟล์ = 1 มิติคุณภาพ
│   │   │   ├── adapters/        ← 1 ไฟล์ = 1 เครื่องมือภายนอก
│   │   │   ├── normalize/       ← แปลงผลทุกเครื่องมือเป็น Finding, ตัดซ้ำ,
│   │   │   │                      สร้าง fingerprint
│   │   │   └── scoring/         ← คะแนนรายมิติ, เกรด, quality gate
│   │   ├── reports/             ← json, markdown, html, sarif
│   │   ├── db/                  ← schema.ts, migrations/, queries/
│   │   └── config/              ← rules.default.ts, thresholds.ts, weights.ts
│   └── tests/
│       ├── unit/
│       ├── integration/
│       └── fixtures/            ← โค้ดตัวอย่างที่รู้ผลล่วงหน้า (ดี/แย่ รายมิติ)
│
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx                  ← ภาพรวม + เริ่มสแกน
│       │   ├── scans/[scanId]/           ← ผลสแกน: คะแนน, มิติ, ไฟล์ที่แย่สุด
│       │   ├── scans/[scanId]/files/     ← มุมมองรายไฟล์
│       │   ├── findings/[findingId]/     ← ปัญหา + โค้ด + วิธีแก้
│       │   ├── history/                  ← แนวโน้ม, เทียบสองสแกน
│       │   └── settings/                 ← เกณฑ์และน้ำหนัก
│       ├── components/
│       │   ├── ui/              ← shadcn
│       │   ├── scan/            ← ScoreGauge, GradeBadge, ScanProgress
│       │   ├── findings/        ← FindingTable, FindingFilters, CodeSnippet,
│       │   │                      SeverityBadge
│       │   └── charts/          ← TrendChart, DimensionRadar, FileHeatmap
│       ├── hooks/
│       └── lib/                 ← api-client.ts, formatters.ts
│
├── shared/
│   └── src/
│       ├── schemas/             ← scan.schema.ts, finding.schema.ts,
│       │                          report.schema.ts, config.schema.ts
│       └── constants/           ← severity.ts, dimension.ts, grade.ts
│
├── docs/                        ← PLAN.md, architecture.md, api.md, analyzers.md
├── scripts/                     ← setup-tools.sh (ติดตั้งเครื่องมือภายนอก)
├── veritas.config.ts            ← ค่าที่ผู้ใช้ปรับได้
├── package.json                 ← Bun workspaces: backend, frontend, shared
└── README.md
```

## 3. มิติคุณภาพ 10 ด้าน

| # | Analyzer | ตรวจอะไร | เครื่องมือ |
|---|---|---|---|
| 1 | `integrity` | ไฟล์เสีย, encoding, merge conflict ค้าง, ไฟล์ใหญ่ผิดปกติ, binary ปน | เขียนเอง |
| 2 | `correctness` | parse ไม่ผ่าน, type error | tsc, Pyright |
| 3 | `lint` | bug pattern, style | Biome, Ruff |
| 4 | `complexity` | cyclomatic, cognitive, ความลึก, ความยาวฟังก์ชัน/ไฟล์ | เขียนเอง: TypeScript compiler API, Python `ast` (parse อย่างเดียว ไม่รันโค้ด) |
| 5 | `duplication` | โค้ดซ้ำข้ามไฟล์ | jscpd |
| 6 | `security` | injection, crypto อ่อน, การใช้ API อันตราย | Semgrep |
| 7 | `secrets` | key, token, รหัสผ่านในโค้ด | Gitleaks |
| 8 | `dependencies` | ช่องโหว่ที่รู้จัก, package ที่ import แต่ไม่ได้ประกาศ, package ที่ไม่ได้ใช้, ไม่มี lockfile | OSV-Scanner + เขียนเอง (ไม่ใช้ Knip เพราะต้องรัน config ของโปรเจกต์) |
| 9 | `testing` | มีเทสต์ไหม, อัตราส่วนเทสต์ต่อโค้ด, อ่าน coverage report ถ้ามี | เขียนเอง |
| 10 | `maintainability` | circular import, ความครอบคลุมของเอกสาร, README, FIXME/TODO | เขียนเอง |

กติกาของทุก analyzer:

- interface เดียวกัน: รับรายการไฟล์และ config คืน `Finding[]`
- ถ้าเครื่องมือภายนอกไม่ได้ติดตั้ง มิตินั้นรายงานสถานะ `skipped` พร้อมเหตุผล ไม่ล้มทั้งสแกน และไม่นับเป็นคะแนนเต็ม
- รันขนานกัน มี timeout รายตัว
- ผลการ parse ที่หลายตัวตรวจใช้ร่วมกัน (เช่น Python facts, TS imports) คำนวณครั้งเดียวต่อการสแกนผ่าน `memo`
- เครื่องมือภายนอกถูกเรียกผ่าน adapter เท่านั้น ส่งชื่อไฟล์เป็น `./path` เสมอ และใช้ environment ที่ตัดตัวแปรลับออก

### การส่งข้อมูลออกนอกเครื่อง
- Semgrep ดาวน์โหลดชุดกฎจาก semgrep.dev (ไม่ส่งโค้ด)
- OSV-Scanner ส่งชื่อและเวอร์ชันของ package ไปที่ osv.dev (ไม่ส่งโค้ด)
- เครื่องมืออื่นทั้งหมดทำงานในเครื่องเท่านั้น

### ข้อมูลลับ
- Gitleaks ใช้ `--redact` และ snippet ของทุก finding ที่ทับบรรทัดที่มีข้อมูลลับจะถูกซ่อน ไม่ว่าจะมาจากตัวตรวจไหน

## 4. รูปแบบข้อมูลหลัก

`Finding`: `id`, `fingerprint`, `dimension`, `severity` (critical / high / medium / low / info), `ruleId`, `message`, `file`, `startLine`, `endLine`, `snippet`, `suggestion`, `source` (ชื่อเครื่องมือ)

`fingerprint` คำนวณจาก rule + ไฟล์ + เนื้อหาบรรทัด (ไม่ใช้เลขบรรทัด) เพื่อบอกได้ว่าปัญหาไหน ใหม่ / ยังอยู่ / แก้แล้ว เมื่อเทียบกับสแกนก่อนหน้า

`Scan`: `id`, `status`, เวลาเริ่ม/จบ, จำนวนไฟล์และบรรทัด, คะแนนรายมิติ, คะแนนรวม, เกรด, สถานะของแต่ละ analyzer

## 5. การให้คะแนน

- แต่ละมิติ 0–100: `100 × e^(−penalty/20)` โดย penalty = ผลรวมน้ำหนัก severity ของปัญหาระดับไฟล์ ÷ จำนวนพันบรรทัด (ขั้นต่ำ 1) + ผลรวมน้ำหนักของปัญหาระดับโปรเจกต์ (เช่น ไม่มีเทสต์) แบบไม่หาร
- น้ำหนัก severity: critical 10, high 5, medium 2, low 0.5, info 0 → ปัญหา 1 ข้อต่อ 1,000 บรรทัดได้ประมาณ 61 / 78 / 90 / 98 คะแนน
- มิติที่ถูกข้ามหรือล้มเหลวไม่ได้คะแนน และไม่นับในคะแนนรวม
- คะแนนรวมเป็นค่าเฉลี่ยถ่วงน้ำหนัก (security, secrets, correctness น้ำหนักสูงสุด)
- เกรด A–F
- Quality gate: มี critical แม้ข้อเดียว = ไม่ผ่าน ไม่ว่าคะแนนรวมเท่าไร
- CLI คืน exit code ≠ 0 เมื่อไม่ผ่าน gate เพื่อใช้ใน CI

## 6. API

| Method | Path | หน้าที่ |
|---|---|---|
| POST | `/api/scans` | เริ่มสแกน |
| GET | `/api/scans` | รายการสแกน |
| GET | `/api/scans/:id` | สรุปผล |
| GET | `/api/scans/:id/events` | ความคืบหน้าแบบ SSE |
| GET | `/api/scans/:id/findings` | ปัญหา (กรอง, เรียง, แบ่งหน้า) |
| GET | `/api/scans/:id/compare/:otherId` | เทียบสองสแกน |
| GET | `/api/scans/:id/report?format=` | json / md / html / sarif |
| GET | `/api/findings/:id` | รายละเอียดปัญหา |
| GET | `/api/health` | สถานะ + เครื่องมือที่ติดตั้ง |

## 7. กฎการตั้งชื่อ

- โฟลเดอร์และไฟล์: `kebab-case`; React component: `PascalCase.tsx`
- suffix บอกหน้าที่: `*.analyzer.ts`, `*.adapter.ts`, `*.route.ts`, `*.schema.ts`, `*.test.ts`
- frontend ไม่ import จาก backend; ทั้งคู่ import ได้จาก `shared/` เท่านั้น
- analyzer ไม่เรียกเครื่องมือภายนอกตรง ต้องผ่าน adapter

## 8. ลำดับการสร้าง

| ขั้น | งาน | เสร็จเมื่อ |
|---|---|---|
| 1 | Workspace, `shared/` schemas, config | typecheck ผ่านทั้ง 3 package |
| 2 | Discovery, pipeline, analyzer ที่เขียนเอง (integrity, complexity, testing), scoring, CLI | `veritas scan` ให้ผลถูกต้องกับ fixtures |
| 3 | Adapters และ analyzer ที่เหลือ, normalize, fingerprint | ครบ 10 มิติ, เทสต์ fixture ผ่านทุกมิติ |
| 4 | ฐานข้อมูล, API, SSE | integration test ผ่านทุก endpoint |
| 5 | แดชบอร์ด | สแกนจากหน้าเว็บและดูผลถึงระดับบรรทัดได้ |
| 6 | ประวัติ, เทียบสแกน, ส่งออกรายงาน, หน้า settings | เทียบสองสแกนเห็นปัญหาใหม่/แก้แล้ว |

สถานะ: ทั้ง 6 ขั้นเสร็จแล้ว ค่าที่ตั้งจากหน้า settings เก็บในฐานข้อมูล ซ้อนทับ veritas.config.ts และใช้กับการสแกนจากหน้าเว็บ/API เท่านั้น (CLI ใช้ไฟล์อย่างเดียว เพื่อให้ผลใน CI ทำซ้ำได้)

ขั้น 2 ให้เครื่องมือที่ใช้งานได้จริงแล้วผ่าน CLI ขั้นถัดไปแต่ละขั้นเพิ่มความสามารถโดยไม่ต้องรื้อของเดิม
