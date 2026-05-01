#!/bin/bash
# AI-Enhanced CDMS — Automated Backup Script
# WMO-No. 1131 compliance: daily backup, 30-day retention
# SRS NFR-REL-03: automated daily backups with 30-day retention
# SRS NFR-REL-04: disaster recovery within 4 hours

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cdms}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_NAME="${POSTGRES_DB:-climsoft}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_HOST="${POSTGRES_HOST:-localhost}"
RETENTION_DAYS=30
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" | tee -a "$LOG_FILE"
}

log "Starting backup $TIMESTAMP"

# 1. Database backup
DB_FILE="$BACKUP_DIR/db_${TIMESTAMP}.sql.gz"
pg_dump -U "$DB_USER" -h "$DB_HOST" "$DB_NAME" | gzip > "$DB_FILE"
log "Database backup: $DB_FILE ($(du -sh "$DB_FILE" | cut -f1))"

# 2. LMS AI pipeline outputs backup
LMS_DIR=~/climsoft-web/front-end/pwa/data/lms/outputs
if [ -d "$LMS_DIR" ]; then
  LMS_FILE="$BACKUP_DIR/lms_${TIMESTAMP}.tar.gz"
  tar -czf "$LMS_FILE" -C "$(dirname "$LMS_DIR")" "$(basename "$LMS_DIR")"
  log "LMS outputs backup: $LMS_FILE ($(du -sh "$LMS_FILE" | cut -f1))"
fi

# 3. Remove backups older than 30 days
DELETED=$(find "$BACKUP_DIR" -name "*.gz" -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
log "Removed $DELETED old backup files (older than $RETENTION_DAYS days)"

# 4. Verify backup integrity
if gunzip -t "$DB_FILE"; then
  log "Database backup integrity: OK"
else
  log "WARNING: backup integrity check FAILED"
fi

log "Backup completed successfully"
