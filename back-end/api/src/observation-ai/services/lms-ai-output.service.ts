import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

export interface LmsAiQuery {
  stationId?: string;
  stationIds?: string[];
  stationName?: string;
  elementCode?: string;
  elementCodes?: string[];
  elementName?: string;
  interval?: number;
  sourceId?: number;
  dateFrom?: string;
  dateTo?: string;
  fromDate?: string;
  toDate?: string;
  outcome?: string;
  finalDecision?: string;
  severity?: string;
  reviewSource?: string;
  modelName?: string;
  prompt?: string;
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
      genaiProvider: this.getEffectiveGenAiProvider(manifest.data),
      requestedGenaiProvider: manifest.data?.requestedGenaiProvider ?? manifest.data?.genaiProvider ?? null,
      effectiveGenaiProvider: this.getEffectiveGenAiProvider(manifest.data),
      genaiProviderStatus: manifest.data?.genaiProviderStatus ?? null,
      genaiFallbackReason: manifest.data?.genaiFallbackReason ?? null,
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
      provider: this.getGenAiProvider(report.content, this.getEffectiveGenAiProvider(manifest.data) ?? undefined),
      requestedProvider: manifest.data?.requestedGenaiProvider ?? manifest.data?.genaiProvider ?? null,
      effectiveProvider: this.getEffectiveGenAiProvider(manifest.data),
      status: manifest.data?.genaiProviderStatus ?? null,
      fallbackReason: manifest.data?.genaiFallbackReason ?? null,
      sections: this.parseMarkdownSections(report.content),
    };
  }

  public getQcReview(query: LmsAiQuery) {
    return this.queryCsv(this.knownFiles.qcReview, query);
  }

  public async getQcAssessments(query: LmsAiQuery) {
    const manifest = this.readJson(this.knownFiles.manifest);
    const provider = this.normalizeProvider(this.getEffectiveGenAiProvider(manifest.data));
    const assessmentRows = await this.queryAssessmentRows(query);
    const explanationMap = await this.queryExplanationRowsForKeys(
      new Set(assessmentRows.rows.map(row => this.getAssessmentJoinKey(row))),
    );
    const seenAssessmentKeys = new Set<string>();
    const rows: Record<string, string>[] = [];
    for (const row of assessmentRows.rows) {
      const assessmentKey = this.getAssessmentJoinKey(row);
      if (seenAssessmentKeys.has(assessmentKey)) continue;
      seenAssessmentKeys.add(assessmentKey);
      rows.push(this.withAssessmentFields(row, explanationMap.get(assessmentKey), provider));
    }

    return {
      total: assessmentRows.total,
      limit: assessmentRows.limit,
      offset: assessmentRows.offset,
      rows,
      provider,
      evidenceFiles: [
        this.getFileInfo(this.knownFiles.qcReview),
        this.getFileInfo(this.knownFiles.ensemble),
        this.getFileInfo(this.knownFiles.genaiReviewerExplanations),
      ],
      missing: assessmentRows.missing,
    };
  }

  public getEnsemble(query: LmsAiQuery) {
    return this.queryCsv(this.knownFiles.ensemble, query);
  }

  public async getNormalizedObservations(query: LmsAiQuery) {
    try {
      return await this.queryLargeCsvPreview(this.knownFiles.normalized, query);
    } catch (err) {
      console.error('[LMS AI] Failed to stream normalized observations preview', err);
      return {
        total: 0,
        matchedCountScanned: 0,
        totalApproximate: 0,
        scannedRows: 0,
        limit: this.getPreviewLimit(query),
        offset: this.getOffset(query),
        rows: [],
        file: this.getFileInfo(this.knownFiles.normalized),
        missing: false,
        errorMessage: err instanceof Error ? err.message : 'Failed to read LMS normalized observations preview.',
      };
    }
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

  public async getAgentInsights(query: LmsAiQuery) {
    const prompt = `${query.prompt ?? 'model performance'}`.toLowerCase();
    const manifest = this.readJson(this.knownFiles.manifest);
    const modelSummary = this.readJson(this.knownFiles.modelSummary);
    const genAiSummary = this.getGenAiSummary();
    const supervisor = this.readMarkdown(this.knownFiles.supervisorSummary);
    const handoff = await this.getQcAssessments({ ...query, limit: query.limit ?? 50, offset: 0 });
    const provider = this.normalizeProvider(genAiSummary.provider ?? this.getEffectiveGenAiProvider(manifest.data));
    const modelMetrics = modelSummary.data?.modelMetrics ?? {};
    const topStations = [...(modelSummary.data?.stationAnomalyRates ?? [])]
      .sort((left, right) => Number(right.anomalyRate) - Number(left.anomalyRate))
      .slice(0, 5);
    const sections = [
      ...genAiSummary.sections,
      ...this.parseMarkdownSections(supervisor.content),
    ];

    const answerParts: string[] = [];
    if (prompt.includes('station')) {
      answerParts.push(`Highest-risk LMS stations are ${topStations.map(row => `${row.stationId} (${this.formatPercent(row.anomalyRate)})`).join(', ') || 'not available'}.`);
      answerParts.push('Prioritize stations with high anomaly rates and high failed/suspect counts before lower-risk normal rows.');
    } else if (prompt.includes('reviewer') || prompt.includes('action')) {
      answerParts.push('Review FAILED rows first, then SUSPECT rows with multiple agreeing models, and compare each value with nearby daily observations and the original LMS source record.');
      answerParts.push('Do not overwrite values automatically; record reviewer evidence and only correct values after source verification.');
    } else if (prompt.includes('supervisor')) {
      answerParts.push(`LMS AI pipeline ${manifest.data?.runId ?? 'latest run'} used ${provider} GenAI assistance and produced ${this.formatNumber(manifest.data?.qcReviewRows)} QC review handoff rows.`);
      answerParts.push('Supervisor focus should be review throughput, high-risk station follow-up, and confirmation that template/Gemini/Groq provider provenance is visible in reports.');
    } else if (prompt.includes('wrong') || prompt.includes('automatically')) {
      answerParts.push('Anomalies are review priorities, not automatic wrong-value decisions. The LMS-trained layer flags values that differ from learned historical station-element patterns.');
      answerParts.push('Final decisions still require human QC review, source comparison, and documented acceptance, correction, or escalation.');
    } else {
      const metricsText = Object.keys(modelMetrics)
        .map(name => `${name}: ${this.formatNumber(modelMetrics[name]?.anomalyCount)} anomalies, ${this.formatPercent(modelMetrics[name]?.anomalyRate)}`)
        .join('; ');
      answerParts.push(`The current LMS-trained model layer scored historical LMS observations with these model results: ${metricsText || 'model metrics not available'}.`);
      answerParts.push(`The ensemble handoff has ${this.formatNumber(manifest.data?.qcReviewRows)} QC review rows from ${this.formatNumber(manifest.data?.totalPredictionRows)} prediction rows.`);
    }

    const evidence = [
      `Provider: ${provider}`,
      `Run ID: ${manifest.data?.runId ?? 'not available'}`,
      `Training source: LMS historical climate data`,
      `Clean training rows: ${this.formatNumber(manifest.data?.totalCleanRows)}`,
      `QC handoff rows: ${this.formatNumber(manifest.data?.qcReviewRows)}`,
      ...sections.slice(0, 2).map(section => `${section.title}: ${section.lines.slice(0, 2).join(' ')}`),
      ...handoff.rows.slice(0, 3).map(row => `${row.stationId} ${row.elementCode} ${row.observationDatetime}: ${row.finalDecision || row.outcome} (${row.severity})`),
    ].filter(item => item.trim().length > 0);

    return {
      provider,
      answer: answerParts.join(' '),
      evidence,
      recommendedActions: this.getRecommendedActions(prompt),
    };
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

  private async queryLargeCsvPreview(file: KnownFile, query: LmsAiQuery) {
    const filePath = this.getFilePath(file);
    const fileInfo = this.getFileInfo(file);
    const offset = this.getOffset(query);
    const limit = this.getPreviewLimit(query);
    const rows: Record<string, string>[] = [];
    let matchedCountScanned = 0;
    let scannedRows = 0;
    let headers: string[] = [];

    if (!fs.existsSync(filePath)) {
      return {
        total: 0,
        matchedCountScanned: 0,
        totalApproximate: 0,
        scannedRows: 0,
        limit,
        offset,
        rows,
        file: fileInfo,
        missing: true,
      };
    }

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
      for await (const line of reader) {
        if (!line) continue;
        if (headers.length === 0) {
          headers = this.parseCsvLine(line.replace(/^\uFEFF/, ''));
          continue;
        }

        scannedRows++;
        const values = this.parseCsvLine(line);
        const row = this.withDerivedObservationDateFields(headers.reduce<Record<string, string>>((accumulator, header, index) => {
          accumulator[header] = values[index] ?? '';
          return accumulator;
        }, {}));

        if (!this.matchesNormalizedPreviewRow(row, query)) {
          continue;
        }

        matchedCountScanned++;
        if (matchedCountScanned <= offset) {
          continue;
        }

        rows.push(row);
        if (rows.length >= limit) {
          reader.close();
          stream.destroy();
          break;
        }
      }
    } finally {
      reader.close();
      stream.destroy();
    }

    return {
      total: matchedCountScanned,
      matchedCountScanned,
      totalApproximate: matchedCountScanned,
      scannedRows,
      limit,
      offset,
      rows,
      file: fileInfo,
      missing: false,
    };
  }

  private async queryAssessmentRows(query: LmsAiQuery): Promise<{ total: number; limit: number; offset: number; rows: Record<string, string>[]; missing: boolean }> {
    const offset = this.getOffset(query);
    const limit = this.getPageLimit(query);
    const rows: Record<string, string>[] = [];
    const seenAssessmentKeys = new Set<string>();
    let total = 0;
    let existingFiles = 0;

    for (const file of [this.knownFiles.qcReview, this.knownFiles.ensemble]) {
      const filePath = this.getFilePath(file);
      if (!fs.existsSync(filePath)) continue;
      existingFiles++;

      const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
      const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let headers: string[] = [];

      try {
        for await (const line of reader) {
          if (!line) continue;
          if (headers.length === 0) {
            headers = this.parseCsvLine(line.replace(/^\uFEFF/, ''));
            continue;
          }

          const values = this.parseCsvLine(line);
          const row = this.withDerivedObservationDateFields(headers.reduce<Record<string, string>>((accumulator, header, index) => {
            accumulator[header] = values[index] ?? '';
            return accumulator;
          }, {}));

          if (!this.matchesAssessmentRow(row, query)) continue;

          const assessmentKey = this.getAssessmentJoinKey(row);
          if (seenAssessmentKeys.has(assessmentKey)) continue;
          seenAssessmentKeys.add(assessmentKey);

          if (total >= offset && rows.length < limit) {
            rows.push(row);
          }
          total++;
        }
      } finally {
        reader.close();
        stream.destroy();
      }
    }

    return {
      total,
      limit,
      offset,
      rows,
      missing: existingFiles === 0,
    };
  }

  private async queryExplanationRowsForKeys(joinKeys: Set<string>): Promise<Map<string, Record<string, string>>> {
    const explanationMap = new Map<string, Record<string, string>>();
    if (joinKeys.size === 0) return explanationMap;

    const filePath = this.getFilePath(this.knownFiles.genaiReviewerExplanations);
    if (!fs.existsSync(filePath)) return explanationMap;

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let headers: string[] = [];

    try {
      for await (const line of reader) {
        if (!line) continue;
        if (headers.length === 0) {
          headers = this.parseCsvLine(line.replace(/^\uFEFF/, ''));
          continue;
        }

        const values = this.parseCsvLine(line);
        const row = this.withDerivedObservationDateFields(headers.reduce<Record<string, string>>((accumulator, header, index) => {
          accumulator[header] = values[index] ?? '';
          return accumulator;
        }, {}));
        const joinKey = this.getAssessmentJoinKey(row);
        if (joinKeys.has(joinKey)) {
          explanationMap.set(joinKey, row);
        }
      }
    } finally {
      reader.close();
      stream.destroy();
    }

    return explanationMap;
  }

  private matchesNormalizedPreviewRow(row: Record<string, string>, query: LmsAiQuery): boolean {
    return this.matchesStation(row, query)
      && this.matchesText(row, 'stationName', query.stationName)
      && this.matchesElementCode(row, query)
      && this.matchesText(row, 'elementName', query.elementName)
      && this.matchesDate(row, query);
  }

  private getOffset(query: LmsAiQuery): number {
    return Math.max(0, Number(query.offset ?? 0) || 0);
  }

  private getPreviewLimit(query: LmsAiQuery): number {
    return Math.min(500, Math.max(1, Number(query.limit ?? 50) || 50));
  }

  private withAssessmentFields(row: Record<string, string>, explanationRow: Record<string, string> | undefined, provider: string): Record<string, string> {
    const explanation = explanationRow?.explanation || row.explanation || row.reviewReason || '';
    return {
      ...row,
      provider: explanationRow?.provider || row.provider || row.genaiProvider || provider,
      genAiExplanation: explanation,
      explanation,
      modelEvidence: row.agreeingModels || row.contributingModels || row.modelName || 'LMS Ensemble',
      modelAgreement: row.modelAgreementCount || row.modelAgreementRatio || row.agreeingModels || '',
      recommendedReviewerAction: row.recommendedReviewerAction || 'Review LMS source record and nearby daily sequence.',
      reviewReason: row.reviewReason || this.buildReviewReason(row),
    };
  }

  private getAssessmentJoinKey(row: Record<string, string>): string {
    return [
      row.stationId ?? '',
      row.elementCode ?? '',
      this.getComparableDate(row) ?? row.observationDatetime ?? '',
      row.value ?? '',
    ].join('|').toLowerCase();
  }

  private buildReviewReason(row: Record<string, string>): string {
    const decision = row.finalDecision || row.outcome || 'NORMAL';
    const score = row.anomalyScore || '0';
    const agreement = row.modelAgreementCount || row.agreeingModels || '0';
    return `LMS-trained AI ${decision} decision with anomaly score ${score} and model agreement ${agreement}.`;
  }

  private getRecommendedActions(prompt: string): string[] {
    if (prompt.includes('supervisor')) {
      return [
        'Share current QC handoff volume and provider provenance with supervisors.',
        'Assign review priority to FAILED and high-confidence SUSPECT rows.',
        'Track confirmed corrections separately from AI anomaly counts.',
      ];
    }
    if (prompt.includes('station')) {
      return [
        'Open the highest-risk station rows in QC Review Workspace.',
        'Compare repeated station-element anomalies against neighboring dates.',
        'Escalate repeated source-file patterns to data operations.',
      ];
    }
    return [
      'Review FAILED rows before SUSPECT rows.',
      'Use LMS source records and nearby daily sequences as evidence.',
      'Record whether the reviewer accepted, corrected, or escalated each row.',
    ];
  }

  private normalizeProvider(provider?: string | null): string {
    const value = `${provider ?? 'template'}`.trim().toLowerCase();
    if (value.includes('gemini')) return 'Gemini';
    if (value.includes('groq')) return 'Groq';
    if (value.includes('template')) return 'Template fallback';
    return provider?.toString() || 'Template fallback';
  }

  private getEffectiveGenAiProvider(manifest: any): string | null {
    return manifest?.effectiveGenaiProvider ?? manifest?.genaiProvider ?? null;
  }

  private formatNumber(value: any): string {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : '0';
  }

  private formatPercent(value: any): string {
    return `${((Number(value) || 0) * 100).toFixed(2)}%`;
  }

  private pageRows(rows: Record<string, string>[], query: LmsAiQuery) {
    const offset = Math.max(0, Number(query.offset ?? 0) || 0);
    const limit = this.getPageLimit(query);
    return {
      total: rows.length,
      limit,
      offset,
      rows: rows.slice(offset, offset + limit),
    };
  }

  private getPageLimit(query: LmsAiQuery): number {
    return Math.min(5000, Math.max(1, Number(query.limit ?? 100) || 100));
  }

  private filterRows(rows: Record<string, string>[], query: LmsAiQuery): Record<string, string>[] {
    return rows.filter(row => this.matchesAssessmentRow(row, query));
  }

  private matchesAssessmentRow(row: Record<string, string>, query: LmsAiQuery): boolean {
    return this.matchesStation(row, query)
      && this.matchesText(row, 'stationName', query.stationName)
      && this.matchesElementCode(row, query)
      && this.matchesText(row, 'elementName', query.elementName)
      && this.matchesOptionalNumericField(row, 'interval', query.interval)
      && this.matchesOptionalNumericField(row, 'sourceId', query.sourceId)
      && this.matchesText(row, 'outcome', query.outcome)
      && this.matchesText(row, 'finalDecision', query.finalDecision)
      && this.matchesText(row, 'severity', query.severity)
      && this.matchesText(row, 'reviewSource', query.reviewSource)
      && this.matchesText(row, 'modelName', query.modelName)
      && this.matchesDate(row, query);
  }

  private matchesStation(row: Record<string, string>, query: LmsAiQuery): boolean {
    const rowStationId = `${row.stationId ?? ''}`.trim();
    const stationIds = (query.stationIds ?? []).map(stationId => stationId.trim()).filter(Boolean);
    const stationId = query.stationId?.trim();
    if (stationIds.length > 0) {
      return stationIds.includes(rowStationId) && this.textMatches(rowStationId, stationId);
    }
    return this.textMatches(rowStationId, stationId);
  }

  private matchesText(row: Record<string, string>, field: string, expected?: string): boolean {
    return this.textMatches(row[field], expected);
  }

  private matchesElementCode(row: Record<string, string>, query: LmsAiQuery): boolean {
    const elementCodes = query.elementCodes ?? [];
    if (elementCodes.length > 0) {
      return elementCodes.some(elementCode => this.textMatches(row.elementCode, elementCode));
    }
    return this.matchesText(row, 'elementCode', query.elementCode);
  }

  private textMatches(actual: string | undefined, expected?: string): boolean {
    if (!expected) return true;
    return `${actual ?? ''}`.trim().toLowerCase().includes(expected.trim().toLowerCase());
  }

  private matchesOptionalNumericField(row: Record<string, string>, field: string, expected?: number): boolean {
    if (expected === undefined) return true;
    if (row[field] === undefined || row[field] === '') return true;
    return Number(row[field]) === expected;
  }

  private matchesDate(row: Record<string, string>, query: LmsAiQuery): boolean {
    const dateFrom = query.dateFrom ?? query.fromDate;
    const dateTo = query.dateTo ?? query.toDate;
    if (!dateFrom && !dateTo) return true;
    const observedDate = this.getComparableDate(row);
    if (!observedDate) return false;
    if (dateFrom && observedDate < this.normalizeQueryDate(dateFrom)) return false;
    if (dateTo && observedDate > this.normalizeQueryDate(dateTo)) return false;
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
