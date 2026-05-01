import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LmsAiQueryDto } from './lms-ai-query.dto';

describe('LmsAiQueryDto', () => {
  async function validateQuery(query: Record<string, unknown>) {
    const dto = plainToInstance(LmsAiQueryDto, query, { enableImplicitConversion: true });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    return { dto, errors };
  }

  it('accepts singular sourceId and interval query parameters', async () => {
    const { dto, errors } = await validateQuery({
      stationId: ' LESLER01 ',
      elementCode: 'rain',
      sourceId: '4',
      interval: '1440',
      fromDate: '2026-04-01',
      toDate: '2026-04-29',
    });

    expect(errors).toHaveLength(0);
    expect(dto.stationId).toBe('LESLER01');
    expect(dto.sourceId).toBe(4);
    expect(dto.interval).toBe(1440);
  });

  it('treats sourceId=0 and interval=0 as optional no-filter values', async () => {
    const { dto, errors } = await validateQuery({
      sourceId: '0',
      interval: '0',
    });

    expect(errors).toHaveLength(0);
    expect(dto.sourceId).toBeUndefined();
    expect(dto.interval).toBeUndefined();
  });

  it('trims stationIds supplied as a comma-separated list', async () => {
    const { dto, errors } = await validateQuery({
      stationIds: ' LESLER01, LESMAS01 ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.stationIds).toEqual(['LESLER01', 'LESMAS01']);
  });
});
