# Disaster Recovery Procedure
## AI-Enhanced CDMS — Lesotho Meteorological Service

**Alignment:** WMO-No. 1131 (Climate Data Management)  
**SRS references:** NFR-REL-03 (daily backups, 30-day retention), NFR-REL-04 (≤4 hour recovery)  
**Owner:** LMS System Administrator

---

## 1. What Is Backed Up and Where

| Artefact | Path | Backup destination |
|----------|------|--------------------|
| PostgreSQL database (`climsoft`) | live DB server | `/var/backups/cdms/db_YYYYMMDD_HHmmss.sql.gz` |
| LMS AI pipeline outputs | `front-end/pwa/data/lms/outputs/` | `/var/backups/cdms/lms_YYYYMMDD_HHmmss.tar.gz` |
| Backup log | — | `/var/backups/cdms/backup.log` |

---

## 2. Backup Schedule

- **Frequency:** Daily at **02:00 UTC** via cron
- **Cron entry:** `0 2 * * * /home/thapelo6041/climsoft-web/scripts/backup.sh`
- **Retention:** 30 days (files older than 30 days are auto-deleted)

---

## 3. Retention Policy

Daily backups are kept for **30 days**, satisfying WMO-No. 1131 climate data preservation
requirements.  For long-term archival (>30 days), copy backup files to a separate off-site
storage medium before the 30-day window closes.

---

## 4. Step-by-Step Restore Procedure (target: < 4 hours)

### Step 1 — Identify the backup to restore

```bash
ls -lh /var/backups/cdms/db_*.sql.gz   # pick the most recent or target timestamp
TIMESTAMP=20260429_020000              # example
```

### Step 2 — Stop the API

```bash
pm2 stop cdms-api
# or
systemctl stop cdms-api
```

### Step 3 — Restore the database

```bash
# Drop and recreate the database (existing data will be lost)
psql -U postgres -c "DROP DATABASE IF EXISTS climsoft;"
psql -U postgres -c "CREATE DATABASE climsoft;"

# Restore from backup
gunzip -c /var/backups/cdms/db_${TIMESTAMP}.sql.gz | psql -U postgres climsoft
```

### Step 4 — Restore LMS AI outputs (if affected)

```bash
cd ~/climsoft-web/front-end/pwa/data
tar -xzf /var/backups/cdms/lms_${TIMESTAMP}.tar.gz
```

### Step 5 — Restart the API

```bash
pm2 start cdms-api
# or
systemctl start cdms-api
```

### Step 6 — Verify the restore

```bash
# Check API health
curl http://localhost:3000/health

# Check row counts
psql -U postgres climsoft -c "SELECT COUNT(*) FROM observations;"
psql -U postgres climsoft -c "SELECT COUNT(*) FROM users;"
```

---

## 5. Restore Commands Summary

```bash
# Full restore in one block
TIMESTAMP=YYYYMMDD_HHmmss
pm2 stop cdms-api
psql -U postgres -c "DROP DATABASE IF EXISTS climsoft; CREATE DATABASE climsoft;"
gunzip -c /var/backups/cdms/db_${TIMESTAMP}.sql.gz | psql -U postgres climsoft
tar -xzf /var/backups/cdms/lms_${TIMESTAMP}.tar.gz -C ~/climsoft-web/front-end/pwa/data
pm2 start cdms-api
```

---

## 6. Contact and Responsibility

| Role | Contact |
|------|---------|
| LMS System Administrator | admin@lms.org.ls |
| Developer | thapeloranneileng@gmail.com |

In the event of a disaster, the LMS System Administrator is the primary responder.
The developer should be contacted if schema migrations or application code changes are required.

---

## 7. WMO Alignment Note

This backup and recovery procedure is aligned with **WMO-No. 1131 (Guide to Climate Data
Management)** which mandates that national meteorological services maintain:

- Regular automated backups of all climate observation data
- Documented recovery procedures
- Data preservation for climatological purposes (minimum 30 years for homogenised records)

The 30-day rolling backup window covers operational recovery. Long-term climate data preservation
requires a separate archival strategy (e.g., AWS S3 Glacier, tape backup) beyond this procedure.
