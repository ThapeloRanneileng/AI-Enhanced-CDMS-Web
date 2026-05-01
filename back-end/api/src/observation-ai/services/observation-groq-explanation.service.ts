import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { ObservationAnomalyDetectionResult } from './observation-anomaly-detection.service';
import { ObservationGenerativeExplanation, ObservationAnomalyOutcomeEnum } from '../entities/observation-anomaly-assessment.entity';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_TIMEOUT_MS = 8000;
const ENV_FILE_CANDIDATES = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'back-end/api/.env'),
];

interface GroqConfig {
  apiKey?: string;
  model: string;
}

@Injectable()
export class ObservationGroqExplanationService {
  private readonly logger = new Logger(ObservationGroqExplanationService.name);

  /**
   * Attempts to enrich the template explanation with a Groq-generated summary.
   * Returns the template explanation unchanged if Groq is unavailable or fails.
   * Never throws — the observation scoring pipeline must not be blocked.
   */
  async enrichExplanation(
    observation: ObservationEntity,
    detectionResult: ObservationAnomalyDetectionResult,
    templateExplanation: ObservationGenerativeExplanation,
  ): Promise<ObservationGenerativeExplanation> {
    const groqConfig = this.getGroqConfig();
    const outcome = String(detectionResult.outcome).toLowerCase();
    const shouldCallGroq = outcome === ObservationAnomalyOutcomeEnum.SUSPECT || outcome === ObservationAnomalyOutcomeEnum.FAILED;

    this.logger.warn(
      `Groq enrichment check: hasKey=${Boolean(groqConfig.apiKey)}, model=${groqConfig.model}, outcome=${detectionResult.outcome}`,
    );

    if (!groqConfig.apiKey) {
      this.logger.warn('Groq skipped: GROQ_API_KEY not set');
      return templateExplanation;
    }

    if (!shouldCallGroq) {
      this.logger.warn(`Groq skipped: outcome=${detectionResult.outcome}`);
      return templateExplanation;
    }

    try {
      const prompt = this.buildPrompt(observation, detectionResult, templateExplanation);
      this.logger.warn(
        `Groq call starting for station=${observation.stationId?.trim?.() ?? observation.stationId}, outcome=${detectionResult.outcome}`,
      );
      const groqSummary = await this.callGroq(groqConfig.apiKey, groqConfig.model, prompt);
      this.logger.warn(`Groq call completed: hasSummary=${Boolean(groqSummary)}`);

      if (!groqSummary) {
        return templateExplanation;
      }

      return {
        ...templateExplanation,
        summary: groqSummary,
        provider: `groq/${groqConfig.model}`,
      };
    } catch (err: unknown) {
      this.logger.warn(`Groq enrichment failed, using template fallback: ${this.formatSafeGroqError(err)}`);
      return templateExplanation;
    }
  }

  private buildPrompt(
    observation: ObservationEntity,
    detectionResult: ObservationAnomalyDetectionResult,
    template: ObservationGenerativeExplanation,
  ): string {
    const signals = (detectionResult.contributingSignals ?? [])
      .slice(0, 3)
      .map(s => `${s.signal}: ${s.feature} is ${s.direction} than expected (score ${s.contributionScore.toFixed(2)})`)
      .join('; ') || 'No contributing signals available';

    const failedChecks = template.failedQcChecks.length > 0
      ? `Failed QC checks: ${template.failedQcChecks.join(', ')}.`
      : 'No rule-based QC failures.';

    return [
      `You are a climate data quality reviewer for a meteorological service.`,
      ``,
      `Observation: Station ${observation.stationId.trim()}, Element ${observation.elementId},`,
      `Value ${observation.value ?? 'missing'}, DateTime ${observation.datetime.toISOString()},`,
      `Interval ${observation.interval} minutes.`,
      ``,
      `ML anomaly outcome: ${detectionResult.outcome} (score ${detectionResult.anomalyScore.toFixed(3)},`,
      `confidence ${(detectionResult.confidenceScore ?? 0).toFixed(3)}).`,
      `Top signals: ${signals}.`,
      `${failedChecks}`,
      ``,
      `Write a concise 2-3 sentence reviewer explanation describing why this observation is`,
      `${detectionResult.outcome} and what the reviewer should check. Be specific and actionable.`,
      `Do not mention model names or internal system details.`,
    ].join('\n');
  }

  private async callGroq(apiKey: string, configuredModel: string, prompt: string): Promise<string | null> {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model: configuredModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: GROQ_TIMEOUT_MS,
      },
    );

    const content: string | undefined = response.data?.choices?.[0]?.message?.content;
    return content?.trim() || null;
  }

  private getGroqConfig(): GroqConfig {
    const envFile = this.loadGroqEnvFile();

    return {
      apiKey: process.env.GROQ_API_KEY ?? envFile.GROQ_API_KEY,
      model: process.env.GROQ_MODEL ?? envFile.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
    };
  }

  private loadGroqEnvFile(): Partial<Record<'GROQ_API_KEY' | 'GROQ_MODEL', string>> {
    for (const envFile of ENV_FILE_CANDIDATES) {
      if (existsSync(envFile)) {
        const parsed = parse(readFileSync(envFile));
        return {
          GROQ_API_KEY: parsed.GROQ_API_KEY,
          GROQ_MODEL: parsed.GROQ_MODEL,
        };
      }
    }

    return {};
  }

  private formatSafeGroqError(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const responseMessage = err.response?.data?.error?.message;
      const details = [
        status !== undefined ? `status=${status}` : null,
        err.code ? `code=${err.code}` : null,
        err.message ? `message=${err.message}` : null,
        responseMessage ? `responseMessage=${responseMessage}` : null,
        err.stack ? `stack=${err.stack}` : null,
      ].filter(Boolean);

      return details.join('; ') || 'Axios error without additional details';
    }

    if (err instanceof Error) {
      return [
        err.message ? `message=${err.message}` : null,
        err.stack ? `stack=${err.stack}` : null,
      ].filter(Boolean).join('; ') || 'Error without additional details';
    }

    return String(err);
  }
}
