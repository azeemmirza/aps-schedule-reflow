# aps-schedule-reflow

This repo implements a **finite-capacity production schedule reflow engine** for a manufacturing facility (extrusion lines producing plastic pipes).

It takes an existing schedule of work orders and repairs it under disruptions while enforcing hard constraints:

- **Dependencies (multi-parent precedence):** all parents must finish before a child can start
- **Work center conflicts:** one work order at a time per work center (**no overlaps**)
- **Shift calendars:** work consumes **working minutes only**; pauses outside shift hours and resumes next shift
- **Maintenance windows:** blocked resource time that cannot be used
- **Maintenance work orders are immovable:** fixed operations that reserve time and cannot be rescheduled

## Why this exists (ERP → APS context)

In classic ERP planning (MRP/MPS), dates are often computed with **infinite capacity assumptions** (i.e., the machine can do multiple things at once). That produces good *plans* but not always executable schedules.

This project is closer to APS-style scheduling:
- **finite-capacity** (capacity = 1 per work center)
- **precedence constraints** (DAG)
- **resource calendars** (shifts + maintenance)
- and a **reflow / schedule-repair** approach (minimize disruption by adjusting forward to the earliest feasible time)

## Quick Start

Install dependencies:

```bash
npm install
```

Run all scenarios (prints before/after + changes):
```bash
npm run dev
```

Run tests:
```bash
npm run test
```

Type-Check:
```bash
npm run typecheck
```


