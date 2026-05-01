import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Audit logs are IMMUTABLE by design — no update/delete endpoints are exposed.
// Do not add UpdateDateColumn or any service methods that mutate rows.
@Entity('audit_logs')
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: number;

  @Column()
  userEmail: string;

  // LOGIN | LOGOUT | CREATE | UPDATE | DELETE | QC_DECISION | IMPORT | EXPORT | PASSWORD_CHANGE
  @Column()
  action: string;

  // observation | station | user | qc_review | session
  @Column()
  resourceType: string;

  @Column({ nullable: true })
  resourceId: string;

  @Column({ type: 'jsonb', nullable: true })
  previousValue: object;

  @Column({ type: 'jsonb', nullable: true })
  newValue: object;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  reason: string;

  @Column({ nullable: true })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}
