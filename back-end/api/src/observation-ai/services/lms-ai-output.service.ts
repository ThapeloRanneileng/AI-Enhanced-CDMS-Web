import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LmsAiQuery {
  stationId?: string;
  stationIds?: string[];
  stationName?: string;
  elementCode?: string;
  elementCodes?: string[];
  elementName?: string;
  dateFrom?: string;
  dateTo?: string;
  outcome?: string;
  finalDecision?: string;
  severity?: string;
  reviewSource?: string;
  modelName?: string;
  limit?: string | number;
  offset?: string | number;
}

interface KnownFile {
  key: string;
  fileName: string;
  type: 'csv' | 'json' | 'markdown';
  directory?: 'outputs' | 'rejected';
}

@Injectable()
export class LmsAiOutputService {
  private readonly knownFiles: Record<string, KnownFile> = {
    normalized: { key: 'normalized', fileName: 'lms_all_station_training_input_normalized.csv', type: 'csv' },
    rejected: { key: 'rejected', fileName: 'lms_all_station_rejected_values.csv', type: 'csv', directory: 'rejected' },
    warnings: { key: 'warnings', fileName: 'lms_all_station_validation_warnings.csv', type: 'csv' },
    qcReview: { key: 'qcReview', fileName: 'lms_qc_review_handoff.csv', type: 'csv' },
    ensemble: { key: 'ensemble', fileName: 'lms_ensemble_anomaly_predictions.csv', type: 'csv' },
    zscore: { key: 'zscore', fileName: 'lms_zscore_predictions.csv', type: 'csv' },
    isolationForest: { key: 'isolationForest', fileName: 'lms_isolation_forest_predictions.csv', type: 'csv' },
    oneClassSvm: { key: 'oneClassSvm', fileName: 'lms_one_class_svm_predictions.csv', type: 'csv' },
    autoencoder: { key: 'autoencoder', fileName: 'lms_autoencoder_predictions.csv', type: 'csv' },
    manifest: { key: 'manifest', fileName: 'lms_pipeline_run_manifest.json', type: 'json' },
    modelSummary: { key: 'modelSummary', fileName: 'lms_model_evaluation_summary.json', type: 'json' },
    modelSummaryMarkdown: { key: 'modelSummaryMarkdown', fileName: 'lms_model_evaluation_summary.md', type: 'markdown' },
    supervisorSummary: { key: 'supervisorSummary', fileName: 'lms_supervisor_summary.md', type: 'markdown' },
    genaiModelSummary: { key: 'genaiModelSummary', fileName: 'lms_genai_model_summary.md', type: 'markdown' },
    genaiReviewerExplanations: { key: 'genaiReviewerExplanations', fileName: 'lms_genai_reviewer_explanations.csv', type: 'csv' },
    autoencoderStatus: { key: 'autoencoderStatus', fileName: 'lms_autoencoder_status.csv', type: 'csv' },
  };

  public getStatus(includeAggregateDetails = true) {
    const manifest = this.readJson(this.knownFiles.manifest);
    const modelSummary = this.readJson(this.knownFiles.modelSummary);
    const autoencoderStatus = this.readCsv(this.knownFiles.autoencoderStatus);
    if (!includeAggregateDetails) {
      return {
        available: !!manifest.exists || !!modelSummary.exists,
        manifest: null,
        modelSummary: null,
        autoencoderStatus: null,
        files: [],
        restricted: true,
      };
    }
    return {
      available: !!manifest.exists || !!modelSummary.exists,
      manifest: manifest.data ?? null,
      modelSummary: modelSummary.data ?? null,
      autoencoderStatus: autoencoderStatus.rows[0] ?? null,
      genaiProvider: manifest.data?.genaiProvider ?? null,
      genaiModelSummaryExists: this.getFileInfo(this.knownFiles.genaiModelSummary).exists,
      genaiReviewerExplanationsExists: this.getFileInfo(this.knownFiles.genaiReviewerExplanations).exists,
      genaiReportFiles: [
        this.getFileInfo(this.knownFiles.genaiModelSummary),
        this.getFileInfo(this.knownFiles.genaiReviewerExplanations),
      ],
      files: Object.values(this.knownFiles).map(file => this.getFileInfo(file)),
    };
  }

  public getManifest() {
    return this.readJson(this.knownFiles.manifest);
  }

  public getModelSummary() {
    return this.readJson(this.knownFiles.modelSummary);
  }

  public getSupervisorSummary() {
    return this.readMarkdown(this.knownFiles.supervisorSummary);
  }

  public getModelSummaryMarkdown() {
    return this.readMarkdown(this.knownFiles.modelSummaryMarkdown);
  }

  public getGenAiSummary() {
    const report = this.readMarkdown(this.knownFiles.genaiModelSummary);
    const manifest = this.readJson(this.knownFiles.manifest);
    return {
      ...report,
      provider: this.getGenAiProvider(report.content, manifest.data?.genaiProvider),
      sections: this.parseMarkdownSections(report.content),
    };
  }

  public getQcReview(query: LmsAiQuery) {
    return this.queryCsv(this.knownFiles.qcReview, query);
  }

  public getEnsemble(query: LmsAiQuery) {
    return this.queryCsv(this.knownFiles.ensemble, query);
  }

  public getNormalizedObservations(query: LmsAiQuery) {
    return this.queryCsv(this.knownFiles.normalized, query);
  }

  public getRejectedRecords(query: LmsAiQuery) {
    return this.queryCsv(this.knownFiles.rejected, query);
  }

  public getPredictions(query: LmsAiQuery) {
    const modelName = `${query.modelName ?? ''}`.trim().toLowerCase();
    const files = [
      this.knownFiles.zscore,
      this.knownFiles.isolationForest,
      this.knownFiles.oneClassSvm,
      this.knownFiles.autoencoder,
    ].filter(file => !modelName || file.fileName.toLowerCase().includes(this.modelFileToken(modelName)));

    const rows = files.flatMap(file => this.readCsv(file).rows);
    const { modelName: _modelName, ...rowQuery } = query;
    return this.pageRows(this.filterRows(rows, rowQuery), query);
  }

  public getGenAiReviewerExplanations(query: LmsAiQuery) {
    return this.queryCsv(this.knownFiles.genaiReviewerExplanations, query);
  }

  private modelFileToken(modelName: string): string {
    if (modelName.includes('z')) return 'zscore';
    if (modelName.includes('isolation')) return 'isolation_forest';
    if (modelName.includes('svm')) return 'one_class_svm';
    if (modelName.includes('autoencoder')) return 'autoencoder';
    return modelName.replace(/[\s-]+/g, '_');
  }

  private queryCsv(file: KnownFile, query: LmsAiQuery) {
    const readResult = this.readCsv(file);
    const filteredRows = this.filterRows(readResult.rows, query);
    return {
      ...this.pageRows(filteredRows, query),
      file: this.getFileInfo(file),
      missing: !readResult.exists,
    };
  }

  private pageRows(rows: Record<string, string>[], query: LmsAiQuery) {
    const offset = Math.max(0, Number(query.offset ?? 0) || 0);
    const limit = Math.min(5000, Math.max(1, Number(query.limit ?? 100) || 100));
    return {
      total: rows.length,
      limit,
      offset,
      rows: rows.slice(offset, offset + limit),
    };
  }

  private filterRows(rows: Record<string, string>[], query: LmsAiQuery): Record<string, string>[] {
    return rows.filter(row => {
      return this.matchesStation(row, query)
        && this.matchesText(row, 'stationName', query.stationName)
        && this.matchesElementCode(row, query)
        && this.matchesText(row, 'elementName', query.elementName)
        && this.matchesText(row, 'outcome', query.outcome)
        && this.matchesText(row, 'finalDecision', query.finalDecision)
        && this.matchesText(row, 'severity', query.severity)
        && this.matchesText(row, 'reviewSource', query.reviewSource)
        && this.matchesText(row, 'modelName', query.modelName)
        && this.matchesDate(row, query);
    });
  }

  private matchesStation(row: Record<string, string>, query: LmsAiQuery): boolean {
    const stationIds = query.stationIds ?? [];
    if (stationIds.length > 0) {
      return stationIds.includes(row.stationId) && this.matchesText(row, 'stationId', query.stationId);
    }
    return this.matchesText(row, 'stationId', query.stationId);
  }

  private matchesText(row: Record<string, string>, field: string, expected?: string): boolean {
    if (!expected) return true;
    return `${row[field] ?? ''}`.toLowerCase().includes(expected.toLowerCase());
  }

  private matchesElementCode(row: Record<string, string>, query: LmsAiQuery): boolean {
    const elementCodes = query.elementCodes ?? [];
    if (elementCodes.length > 0) {
      return elementCodes.some(elementCode => this.textMatches(row.elementCode, elementCode));
    }
    return this.matchesText(row, 'elementCode', query.elementCode);
  }

  private textMatches(actual: string | undefined, expected: string): boolean {
    return `${actual ?? ''}`.toLowerCase().includes(expected.toLowerCase());
  }

  private matchesDate(row: Record<string, string>, query: LmsAiQuery): boolean {
    if (!query.dateFrom && !query.dateTo) return true;
    const observedDate = this.getComparableDate(row);
    if (!observedDate) return false;
    if (query.dateFrom && observedDate < this.normalizeQueryDate(query.dateFrom)) return false;
    if (query.dateTo && observedDate > this.normalizeQueryDate(query.dateTo)) return false;
    return true;
  }

  private getComparableDate(row: Record<string, string>): string | null {
    if (row.observationDatetime) {
      const dateOnly = row.observationDatetime.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;
      const parsed = new Date(row.observationDatetime);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }
    if (row.year && row.month && row.day) {
      return [
        row.year.padStart(4, '0'),
        row.month.padStart(2, '0'),
        row.day.padStart(2, '0'),
      ].join('-');
    }
    return null;
  }

  private normalizeQueryDate(value: string): string {
    const dateOnly = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
  }

  private getGenAiProvider(content: string, manifestProvider?: string): string | null {
    const match = content.match(/^provider=(.+)$/m);
    return (match?.[1] ?? manifestProvider ?? null)?.toString().trim() || null;
  }

  private parseMarkdownSections(content: string): { title: string; lines: string[] }[] {
    const sections: { title: string; lines: string[] }[] = [];
    let current: { title: string; lines: string[] } | null = null;

    (content || '').replace(/\\n/g, '\n').split(/\r?\n/).forEach(rawLine => {
      const line = rawLine.trim();
      if (!line) return;
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        current = { title: heading[2].trim(), lines: [] };
        sections.push(current);
        return;
      }
      if (!current) {
        current = { title: 'Overview', lines: [] };
        sections.push(current);
      }
      current.lines.push(line.replace(/^-\s*/, ''));
    });

    return sections;
  }

  private readJson(file: KnownFile) {
    const filePath = this.getFilePath(file);
    if (!fs.existsSync(filePath)) {
      return { exists: false, data: null, file: this.getFileInfo(file) };
    }
    return {
      exists: true,
      data: JSON.parse(fs.readFileSync(filePath, 'utf-8')),
      file: this.getFileInfo(file),
    };
  }

  private readMarkdown(file: KnownFile) {
    const filePath = this.getFilePath(file);
    return {
      exists: fs.existsSync(filePath),
      content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '',
      file: this.getFileInfo(file),
    };
  }

  private readCsv(file: KnownFile): { exists: boolean; rows: Record<string, string>[] } {
    const filePath = this.getFilePath(file);
    if (!fs.existsSync(filePath)) {
      return { exists: false, rows: [] };
    }
    const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    const lines = content.split(/\r?\n/).filter(line => line.length > 0);
    if (lines.length === 0) {
      return { exists: true, rows: [] };
    }
    const headers = this.parseCsvLine(lines[0]);
    const rows = lines.slice(1).map(line => {
      const values = this.parseCsvLine(line);
      const row = headers.reduce<Record<string, string>>((row, header, index) => {
        row[header] = values[index] ?? '';
        return row;
      }, {});
      return this.withDerivedObservationDateFields(row);
    });
    return { exists: true, rows };
  }

  private withDerivedObservationDateFields(row: Record<string, string>): Record<string, string> {
    if (!row.observationDatetime) return row;
    const dateOnly = row.observationDatetime.slice(0, 10);
    const parts = dateOnly.split('-');
    if (parts.length !== 3) return row;
    return {
      ...row,
      year: row.year || parts[0],
      month: row.month || `${Number(parts[1])}`,
      day: row.day || `${Number(parts[2])}`,
    };
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && inQuotes && next === '"') {
        current += '"';
        index++;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  }

  private getFileInfo(file: KnownFile) {
    const filePath = this.getFilePath(file);
    const exists = fs.existsSync(filePath);
    return {
      key: file.key,
      fileName: file.fileName,
      exists,
      sizeBytes: exists ? fs.statSync(filePath).size : 0,
    };
  }

  private getFilePath(file: KnownFile): string {
    return path.join(file.directory === 'rejected' ? this.getRejectedDir() : this.getOutputDir(), file.fileName);
  }

  private getOutputDir(): string {
    const candidates = [
      path.resolve(process.cwd(), '../../front-end/pwa/data/lms/outputs'),
      path.resolve(process.cwd(), 'front-end/pwa/data/lms/outputs'),
      path.resolve(__dirname, '../../../../front-end/pwa/data/lms/outputs'),
    ];
    return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0];
  }

  private getRejectedDir(): string {
    const candidates = [
      path.resolve(process.cwd(), '../../front-end/pwa/data/lms/rejected'),
      path.resolve(process.cwd(), 'front-end/pwa/data/lms/rejected'),
      path.resolve(__dirname, '../../../../front-end/pwa/data/lms/rejected'),
    ];
    return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0];
  }
}
