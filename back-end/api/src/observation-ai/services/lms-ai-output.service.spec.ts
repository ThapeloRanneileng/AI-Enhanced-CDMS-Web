import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LmsAiOutputService } from './lms-ai-output.service';

describe('LmsAiOutputService', () => {
  let service: LmsAiOutputService;
  let tempDir: string;
  let outputDir: string;
  let rejectedDir: string;

  beforeEach(() => {
    service = new LmsAiOutputService();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-ai-output-service-'));
    outputDir = path.join(tempDir, 'outputs');
    rejectedDir = path.join(tempDir, 'rejected');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(rejectedDir, { recursive: true });

    jest.spyOn(service as any, 'getOutputDir').mockReturnValue(outputDir);
    jest.spyOn(service as any, 'getRejectedDir').mockReturnValue(rejectedDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('returns safe empty and missing responses when LMS output files do not exist', async () => {
    const normalized = await service.getNormalizedObservations({ limit: 25, offset: 5 });
    const rejected = service.getRejectedRecords({});
    const status = service.getStatus();
    const supervisorSummary = service.getSupervisorSummary();

    expect(normalized).toMatchObject({
      total: 0,
      limit: 25,
      offset: 5,
      rows: [],
      missing: true,
    });
    expect(normalized.file).toMatchObject({
      key: 'normalized',
      fileName: 'lms_all_station_training_input_normalized.csv',
      exists: false,
      sizeBytes: 0,
    });
    expect(rejected).toMatchObject({ total: 0, rows: [], missing: true });
    expect(status).toMatchObject({
      available: false,
      manifest: null,
      modelSummary: null,
      autoencoderStatus: null,
    });
    expect(supervisorSummary).toMatchObject({
      exists: false,
      content: '',
    });
  });

  it('parses CSV rows, including quoted commas, into keyed row objects', () => {
    writeOutputCsv(
      'lms_ensemble_anomaly_predictions.csv',
      [
        'stationId,stationName,observationDatetime,elementCode,elementName,value,outcome,explanation',
        'LES001,"Maseru, Airport",1967-01-01,rain,Rainfall,12.5,NORMAL,"quoted, explanation"',
      ],
    );

    const result = service.getEnsemble({});

    expect(result.missing).toBe(false);
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      stationId: 'LES001',
      stationName: 'Maseru, Airport',
      observationDatetime: '1967-01-01',
      elementCode: 'rain',
      elementName: 'Rainfall',
      value: '12.5',
      outcome: 'NORMAL',
      explanation: 'quoted, explanation',
    });
  });

  it('filters rows by historical date ranges using observationDatetime', () => {
    writeOutputCsv(
      'lms_ensemble_anomaly_predictions.csv',
      [
        'stationId,observationDatetime,elementCode,value,outcome',
        'LES001,1966-12-31,rain,1,NORMAL',
        'LES001,1967-01-01,rain,2,NORMAL',
        'LES001,2019-12-31T23:59:59.000Z,rain,3,SUSPECT',
        'LES001,2020-01-01,rain,4,FAILED',
      ],
    );

    const result = service.getEnsemble({
      dateFrom: '1967-01-01',
      dateTo: '2019-12-31',
    });

    expect(result.total).toBe(2);
    expect(result.rows.map(row => row.value)).toEqual(['2', '3']);
  });

  it('adds derived year, month, and day fields from observationDatetime', async () => {
    writeOutputCsv(
      'lms_all_station_training_input_normalized.csv',
      [
        'stationId,stationName,observationDatetime,elementCode,elementName,value,unit',
        'LES001,Maseru,1993-07-05T12:30:00.000Z,tmin,Minimum temperature,4.1,C',
      ],
    );

    const result = await service.getNormalizedObservations({});

    expect(result.rows[0]).toMatchObject({
      observationDatetime: '1993-07-05T12:30:00.000Z',
      year: '1993',
      month: '7',
      day: '5',
    });
  });

  it('streams normalized observation preview and returns only limited rows', async () => {
    writeOutputCsv(
      'lms_all_station_training_input_normalized.csv',
      [
        'stationId,stationName,observationDatetime,elementCode,elementName,value,unit',
        'LES001,Maseru,1967-01-01,rain,Rainfall,1,mm',
        'LES001,Maseru,1967-01-02,rain,Rainfall,2,mm',
        'LES001,Maseru,1967-01-03,rain,Rainfall,3,mm',
      ],
    );

    const result = await service.getNormalizedObservations({ elementCode: 'rain', limit: 2 });

    expect(result).toMatchObject({
      total: 2,
      matchedCountScanned: 2,
      limit: 2,
      offset: 0,
      missing: false,
    });
    expect(result.rows.map(row => row.value)).toEqual(['1', '2']);
  });

  it('filters normalized preview by historical date while stopping after enough matches', async () => {
    writeOutputCsv(
      'lms_all_station_training_input_normalized.csv',
      [
        'stationId,stationName,observationDatetime,elementCode,elementName,value,unit',
        'LES001,Maseru,1966-12-31,rain,Rainfall,0,mm',
        'LES001,Maseru,1967-01-01,rain,Rainfall,1,mm',
        'LES001,Maseru,1967-01-02,rain,Rainfall,2,mm',
        'LES001,Maseru,2020-01-01,rain,Rainfall,3,mm',
        'LES001,Maseru,2020-01-02,rain,Rainfall,4,mm',
      ],
    );

    const result = await service.getNormalizedObservations({
      elementCode: 'rain',
      dateFrom: '1967-01-01',
      dateTo: '2019-12-31',
      limit: 2,
    });

    expect(result.rows.map(row => row.value)).toEqual(['1', '2']);
    expect(result.scannedRows).toBe(3);
  });

  it('clamps normalized preview limit to 500 rows', async () => {
    writeOutputCsv(
      'lms_all_station_training_input_normalized.csv',
      [
        'stationId,stationName,observationDatetime,elementCode,elementName,value,unit',
        ...Array.from({ length: 550 }, (_, index) => `LES001,Maseru,1967-01-${String((index % 28) + 1).padStart(2, '0')},rain,Rainfall,${index},mm`),
      ],
    );

    const result = await service.getNormalizedObservations({ elementCode: 'rain', limit: 5000 });

    expect(result.limit).toBe(500);
    expect(result.rows).toHaveLength(500);
  });

  it('filters LMS rows to authorised stationIds supplied by the authorization pipe', () => {
    writeOutputCsv(
      'lms_qc_review_handoff.csv',
      [
        'stationId,observationDatetime,elementCode,value,outcome',
        'LES001,2011-01-01,rain,1,NORMAL',
        'LES002,2011-01-02,rain,2,SUSPECT',
        'LES003,2011-01-03,rain,3,FAILED',
      ],
    );

    const result = service.getQcReview({ stationIds: ['LES001', 'LES003'] });

    expect(result.total).toBe(2);
    expect(result.rows.map(row => row.stationId)).toEqual(['LES001', 'LES003']);
  });

  it('applies an explicit stationId filter within authorised stationIds', () => {
    writeOutputCsv(
      'lms_qc_review_handoff.csv',
      [
        'stationId,observationDatetime,elementCode,value,outcome',
        'LES001,2011-01-01,rain,1,NORMAL',
        'LES002,2011-01-02,rain,2,SUSPECT',
      ],
    );

    const allowedAndMatched = service.getQcReview({
      stationIds: ['LES001', 'LES002'],
      stationId: 'LES002',
    });
    const notAuthorised = service.getQcReview({
      stationIds: ['LES001'],
      stationId: 'LES002',
    });

    expect(allowedAndMatched.total).toBe(1);
    expect(allowedAndMatched.rows[0].stationId).toBe('LES002');
    expect(notAuthorised.total).toBe(0);
    expect(notAuthorised.rows).toEqual([]);
  });

  it('trims station filters and LMS row station IDs before matching', () => {
    writeOutputCsv(
      'lms_qc_review_handoff.csv',
      [
        'stationId,observationDatetime,elementCode,value,outcome',
        ' LESLER01,2026-04-01,rain,1,SUSPECT',
      ],
    );

    const result = service.getQcReview({
      stationIds: [' LESLER01 '],
      stationId: 'LESLER01',
      elementCode: 'rain',
    });

    expect(result.total).toBe(1);
    expect(result.rows[0].stationId).toBe(' LESLER01');
  });

  it('accepts sourceId and interval filters without rejecting LMS rows that do not carry those columns', () => {
    writeOutputCsv(
      'lms_qc_review_handoff.csv',
      [
        'stationId,observationDatetime,elementCode,value,outcome',
        'LESLER01,2026-04-01,rain,1,SUSPECT',
      ],
    );

    const result = service.getQcReview({
      stationId: 'LESLER01',
      elementCode: 'rain',
      sourceId: 4,
      interval: 1440,
    });

    expect(result.total).toBe(1);
  });

  it('applies sourceId and interval filters when LMS rows include those columns', () => {
    writeOutputCsv(
      'lms_qc_review_handoff.csv',
      [
        'stationId,observationDatetime,elementCode,sourceId,interval,value,outcome',
        'LESLER01,2026-04-01,rain,4,1440,1,SUSPECT',
        'LESLER01,2026-04-02,rain,5,1440,2,SUSPECT',
        'LESLER01,2026-04-03,rain,4,60,3,SUSPECT',
      ],
    );

    const result = service.getQcReview({
      stationId: 'LESLER01',
      elementCode: 'rain',
      sourceId: 4,
      interval: 1440,
    });

    expect(result.total).toBe(1);
    expect(result.rows[0].value).toBe('1');
  });

  it('returns total, normalized limit, offset, and sliced rows for pagination', () => {
    writeOutputCsv(
      'lms_ensemble_anomaly_predictions.csv',
      [
        'stationId,observationDatetime,elementCode,value,outcome',
        'LES001,2011-01-01,rain,1,NORMAL',
        'LES001,2011-01-02,rain,2,NORMAL',
        'LES001,2011-01-03,rain,3,NORMAL',
      ],
    );

    const result = service.getEnsemble({ limit: 1, offset: 1 });

    expect(result).toMatchObject({
      total: 3,
      limit: 1,
      offset: 1,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].value).toBe('2');
  });

  it('returns GenAI summary provider and parsed markdown sections', () => {
    fs.writeFileSync(
      path.join(outputDir, 'lms_pipeline_run_manifest.json'),
      JSON.stringify({ genaiProvider: 'gemini' }),
      'utf8',
    );
    writeOutputCsv(
      'lms_genai_model_summary.md',
      [
        '# LMS GenAI Model Summary',
        '',
        'provider=template',
        '',
        'Model-level insight text.',
        '',
        '## Reviewer Next Steps',
        '- Review failed rows first.',
      ],
    );

    const result = service.getGenAiSummary();
    const status = service.getStatus();

    expect(result).toMatchObject({
      exists: true,
      provider: 'template',
    });
    expect(result.sections).toEqual([
      { title: 'LMS GenAI Model Summary', lines: ['provider=template', 'Model-level insight text.'] },
      { title: 'Reviewer Next Steps', lines: ['Review failed rows first.'] },
    ]);
    expect(status).toMatchObject({
      available: true,
      genaiProvider: 'gemini',
      genaiModelSummaryExists: true,
    });
  });

  it('filters GenAI reviewer explanations by authorised station, date, outcome, severity, and paginates', () => {
    writeOutputCsv(
      'lms_genai_reviewer_explanations.csv',
      [
        'provider,stationId,observationDatetime,elementCode,finalDecision,severity,confidence,explanation',
        'template,LES001,2011-01-01,rain,NORMAL,LOW,0.50,normal',
        'template,LES002,2011-01-02,rain,SUSPECT,MEDIUM,0.70,suspect one',
        'template,LES002,2011-01-03,tmin,SUSPECT,HIGH,0.80,suspect two',
      ],
    );

    const result = service.getGenAiReviewerExplanations({
      stationIds: ['LES002'],
      elementCode: 'rain',
      dateFrom: '2011-01-01',
      dateTo: '2011-12-31',
      finalDecision: 'SUSPECT',
      severity: 'MEDIUM',
      limit: 1,
      offset: 0,
    });

    expect(result).toMatchObject({
      total: 1,
      limit: 1,
      offset: 0,
      missing: false,
    });
    expect(result.rows[0]).toMatchObject({
      provider: 'template',
      stationId: 'LES002',
      explanation: 'suspect one',
    });
  });

  it.each([
    ['zscore', 'lms_zscore_predictions.csv', 'Z-score'],
    ['isolation forest', 'lms_isolation_forest_predictions.csv', 'Isolation Forest'],
    ['one-class svm', 'lms_one_class_svm_predictions.csv', 'One-Class SVM'],
    ['autoencoder', 'lms_autoencoder_predictions.csv', 'Autoencoder'],
  ])('filters prediction rows by modelName=%s', (queryModelName, fileName, rowModelName) => {
    writePredictionCsv('lms_zscore_predictions.csv', 'Z-score', '1');
    writePredictionCsv('lms_isolation_forest_predictions.csv', 'Isolation Forest', '2');
    writePredictionCsv('lms_one_class_svm_predictions.csv', 'One-Class SVM', '3');
    writePredictionCsv('lms_autoencoder_predictions.csv', 'Autoencoder', '4');

    const result = service.getPredictions({ modelName: queryModelName });

    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      modelName: rowModelName,
      value: fileName.includes('zscore') ? '1' : fileName.includes('isolation') ? '2' : fileName.includes('svm') ? '3' : '4',
    });
  });

  it('returns LMS-trained QC assessments with merged provider and model evidence', async () => {
    fs.writeFileSync(
      path.join(outputDir, 'lms_pipeline_run_manifest.json'),
      JSON.stringify({ genaiProvider: 'template' }),
      'utf8',
    );
    writeOutputCsv(
      'lms_qc_review_handoff.csv',
      [
        'stationId,stationName,observationDatetime,elementCode,elementName,value,modelAgreementCount,agreeingModels,anomalyScore,confidence,severity,finalDecision,outcome,explanation,recommendedReviewerAction,reviewSource',
        'LES001,Maseru,2011-01-01,rain,Rainfall,12.5,2,Z-score;Autoencoder,3.1,0.90,HIGH,FAILED,FAILED,handoff explanation,Review source,ai_ensemble',
      ],
    );
    writeOutputCsv(
      'lms_genai_reviewer_explanations.csv',
      [
        'provider,stationId,observationDatetime,elementCode,finalDecision,severity,confidence,explanation',
        'template,LES001,2011-01-01,rain,FAILED,HIGH,0.90,GenAI reviewer explanation',
      ],
    );

    const result = await service.getQcAssessments({ stationId: 'LES001', elementCode: 'rain' });

    expect(result).toMatchObject({
      total: 1,
      provider: 'Template fallback',
      missing: false,
    });
    expect(result.rows[0]).toMatchObject({
      stationId: 'LES001',
      provider: 'Template fallback',
      modelEvidence: 'Z-score;Autoencoder',
      modelAgreement: '2',
      recommendedReviewerAction: 'Review source',
    });
  });

  it('returns deterministic agent insights from LMS output summaries', async () => {
    fs.writeFileSync(
      path.join(outputDir, 'lms_pipeline_run_manifest.json'),
      JSON.stringify({
        runId: 'lms-run-1',
        genaiProvider: 'template',
        totalCleanRows: 100,
        totalPredictionRows: 50,
        qcReviewRows: 5,
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(outputDir, 'lms_model_evaluation_summary.json'),
      JSON.stringify({
        modelMetrics: {
          Ensemble: { anomalyCount: 5, anomalyRate: 0.1 },
        },
        stationAnomalyRates: [
          { stationId: 'LES001', anomalyRate: 0.2 },
        ],
      }),
      'utf8',
    );

    const result = await service.getAgentInsights({ prompt: 'Summarize highest-risk stations' });

    expect(result.provider).toBe('Template fallback');
    expect(result.answer).toContain('LES001');
    expect(result.evidence).toContain('Run ID: lms-run-1');
    expect(result.recommendedActions.length).toBeGreaterThan(0);
  });

  function writeOutputCsv(fileName: string, lines: string[]): void {
    fs.writeFileSync(path.join(outputDir, fileName), `${lines.join('\n')}\n`, 'utf8');
  }

  function writePredictionCsv(fileName: string, modelName: string, value: string): void {
    writeOutputCsv(
      fileName,
      [
        'stationId,observationDatetime,elementCode,value,modelName,outcome',
        `LES001,2011-01-01,rain,${value},${modelName},NORMAL`,
      ],
    );
  }
});
