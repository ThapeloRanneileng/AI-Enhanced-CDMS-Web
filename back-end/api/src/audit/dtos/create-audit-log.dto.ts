export class CreateAuditLogDto {
  userId: number;
  userEmail: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  previousValue?: object;
  newValue?: object;
  ipAddress?: string;
  reason?: string;
  userAgent?: string;
}
