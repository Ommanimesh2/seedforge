# seedforge v2.x Release Plan

## Overview

v2 transforms seedforge from a CLI-only tool into a **full-stack test data platform** with a programmatic API, AI-powered generation, CI/CD integration, and production data workflows.

| Release | Codename | Theme | Scope |
|---------|----------|-------|-------|
| **v2.0.0** | `fluent` | Programmatic TypeScript API | Major — new public API surface |
| **v2.1.0** | `cardinal` | Weighted Relationship Cardinality | Minor — config + generation |
| **v2.2.0** | `muse` | LLM-Enhanced Text Generation | Minor — optional AI integration |
| **v2.3.0** | `pipeline` | GitHub Action + CI/CD | Minor — new package + docs |
| **v2.4.0** | `mirror` | Production Data Subset + Anonymize | Minor — new subsystem |

---

## Dependencies

```
v2.0.0 (Programmatic API)
   │
   ├──→ v2.1.0 (Cardinality)    — uses API internals
   │
   ├──→ v2.2.0 (LLM Text)       — plugs into generator layer
   │
   ├──→ v2.3.0 (GitHub Action)   — wraps CLI + API
   │
   └──→ v2.4.0 (Subset+Anon)    — uses introspection + new pipeline
```

v2.0.0 ships first. v2.1–v2.4 are independent of each other and can ship in any order.
