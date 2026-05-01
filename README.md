python3 << 'PYEOF'
content = '''# AI-Enhanced Climate Data Management System for Lesotho

> **B.Eng Computer Systems and Networks — Final Year Project**  
> National University of Lesotho, Department of Physics & Electronics  
> **Authors:** Thapelo Ranneileng | Motlatsi Masilo  
> **Target Organisation:** Lesotho Meteorological Service  
> **Base System:** Extended from Climsoft Web (open-source CDMS)

---

## What We Built

This repository contains a **complete AI-enhanced extension** of Climsoft Web.  
We did not simply install Climsoft — we engineered the following systems on top of it.

---

## 1. LMS AI Pipeline (Python)
**Location:** `front-end/pwa/aws-ingestion-layer/`

- Trained a **4-model ensemble** on 893,398 historical LMS climate observations
- Models: Z-Score baseline, Isolation Forest, One-Class SVM, Autoencoder (TensorFlow/Keras)
- Ensemble decision layer: NORMAL / SUSPECT / FAILED classifications
- **Groq API** (llama-3.3-70b-versatile) generates contextual reviewer explanations
- Output: 714,816 scored predictions, 116,443 QC review handoff rows
- Ensemble anomaly rate: 6.55% (11,700 review candidates from 178,704 scored)

---

## 2. QC Review Workspace (Angular — built from scratch)
**Location:** `front-end/pwa/src/app/quality-control/`

- Unified QC Review Queue: rule-based QC + ML anomaly decisions in one view
- AI evidence panel: score, confidence, model agreement, Z-score signals, Groq explanation
- **Approve / Override / Escalate** reviewer decision controls
- Reviewer feedback loop: decisions persisted to PostgreSQL for Random Forest training
- Demonstrated with LESBER07 tmax FAILED case: AI Score 0.947, confidence 96%, rolling Z-score -5.86

---

## 3. AI Anomaly Management Centre (Angular — built from scratch)
**Location:** `front-end/pwa/src/app/quality-control/ai-anomaly-management/`

- Live dashboard: 893,398 clean rows, 714,816 predictions, Groq status
- Model performance table (4 individual models + ensemble)
- Groq-powered AI Climate QC Assistant with natural language summaries

---

## 4. Real-Time Observation Scoring (NestJS — built from scratch)
**Location:** `back-end/api/src/observation-ai/`

- Event-driven: every new observation automatically triggers AI assessment
- `ObservationAnomalyJobService` — async per-key scoring, deduplication guard
- `ObservationGroqExplanationService` — Groq LLM explanations for FAILED/SUSPECT
- `ReviewerDecisionService` — persists reviewer decisions for Random Forest training
- `LmsAiOutputService` — serves AI pipeline outputs to the frontend

---

## 5. Security and Governance (built from scratch)
**Location:** `back-end/api/src/audit/`, `back-end/api/src/shared/transformers/`

| Feature | Implementation |
|---|---|
| RBAC | NestJS AuthGuard (global) + AuthorisedStationsPipe (station-scoped) |
| Rate limiting | ThrottlerGuard: 100 req/min general, 5 req/min login (brute force protection) |
| HTTP security headers | Helmet: XSS, clickjacking, MIME sniffing protection |
| Encryption at rest | AES-256-CBC EncryptionTransformer on user PII columns |
| Immutable audit log | audit_logs table: LOGIN, LOGOUT, CREATE, QC_DECISION with IP and timestamp |
| Backup and DR | scripts/backup.sh: daily pg_dump, 30-day retention, WMO-No.1131 aligned |

---

## 6. Reviewer Feedback Loop (built from scratch)
**Location:** `back-end/api/src/observation-ai/entities/reviewer-decision.entity.ts`

- Every Approve/Override/Escalate persists to `reviewer_decisions` PostgreSQL table
- `findLabelledExamples()` joins decisions with AI feature snapshots — training data for Random Forest
- `GET /lms-ai/decision-stats` tracks progress toward 500-decision RF training threshold
- After 500 decisions, Random Forest becomes the 5th ensemble model

---

## 7. OpenStack Kubernetes Deployment (built from scratch)
**Location:** `k8s/`

- 7 Kubernetes manifests: namespace, configmap, secret placeholder, 50Gi Cinder PVC,
  two Deployments (API + frontend), two Services (ClusterIP + LoadBalancer), CronJob
- Daily LMS AI pipeline CronJob at 02:00 UTC
- All 7 YAML files validated: 7/7 valid
- 5-command quick-start in k8s/README.md
- Disaster recovery: `docs/disaster-recovery.md` (4-hour RTO, WMO-No.1131)

---

## 8. Data Entry and Station ID Fix
- Legacy Climsoft stores station IDs with leading whitespace (` LESLER01` not `LESLER01`)
- Applied TRIM() fix across 6 files: backend SQL queries, frontend cache, form definitions
- Also fixed: form context persistence (localStorage), empty state message, browser refresh reload

---

## What We Built vs What Came From Climsoft

| Feature | From Climsoft | Our Engineering |
|---|---|---|
| Basic data entry forms | Yes | Extended: TRIM fix, localStorage context, empty state |
| Station/element metadata | Yes | Extended: live sync to mobile, trim-tolerant cache |
| Rule-based QC | Basic | Extended: AI ensemble layer on top |
| User authentication | Basic | Extended: RBAC, rate limiting, Helmet, TLS |
| Database schema | Observations table | Added 4 new tables, migration v0.0.8 |
| QC Review Workspace | None | Built entirely from scratch |
| AI Anomaly Management | None | Built entirely from scratch |
| Groq LLM integration | None | Built entirely from scratch |
| Audit logging | None | Built entirely from scratch |
| AES-256 encryption | None | Built entirely from scratch |
| Kubernetes manifests | None | Built entirely from scratch |
| Backup scripts | None | Built entirely from scratch |
| Mobile offline PWA | None | Built entirely (separate repo) |

---

## Test Results

