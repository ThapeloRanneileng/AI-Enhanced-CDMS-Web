import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';
import { CreateAuditLogDto } from './dtos/create-audit-log.dto';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
  ) {}

  // Audit failures must NEVER block the main operation.
  async log(dto: CreateAuditLogDto): Promise<void> {
    try {
      const entry = this.auditRepo.create(dto);
      await this.auditRepo.save(entry);
    } catch (err) {
      this.logger.warn(`Audit log failed (non-blocking): ${err?.message}`);
    }
  }

  async getRecentLogs(limit = 200): Promise<AuditLogEntity[]> {
    return this.auditRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getUserActivity(userId: number, limit = 50): Promise<AuditLogEntity[]> {
    return this.auditRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getActionSummary(): Promise<Record<string, number>> {
    const rows = await this.auditRepo
      .createQueryBuilder('log')
      .select('log.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.action')
      .getRawMany();

    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.action] = parseInt(row.count, 10);
      return acc;
    }, {});
  }
}
