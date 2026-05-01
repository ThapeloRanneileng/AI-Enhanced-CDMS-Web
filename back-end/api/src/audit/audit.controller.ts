import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Admin } from 'src/user/decorators/admin.decorator';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Admin()
  @Get('logs')
  getRecentLogs() {
    return this.auditService.getRecentLogs(200);
  }

  @Admin()
  @Get('user/:userId')
  getUserActivity(@Param('userId', ParseIntPipe) userId: number) {
    return this.auditService.getUserActivity(userId, 50);
  }

  @Admin()
  @Get('summary')
  getActionSummary() {
    return this.auditService.getActionSummary();
  }
}
