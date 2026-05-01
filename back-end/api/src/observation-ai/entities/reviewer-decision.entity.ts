import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("reviewer_decisions")
@Index("IDX_reviewer_decisions_lookup", ["stationId", "elementId", "level", "datetime", "interval", "sourceId"])
export class ReviewerDecisionEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "station_id", type: "varchar" })
  @Index()
  stationId: string;

  @Column({ name: "element_id", type: "int" })
  @Index()
  elementId: number;

  @Column({ name: "date_time", type: "timestamptz" })
  @Index()
  datetime: Date;

  @Column({ name: "level", type: "int" })
  level: number;

  @Column({ name: "interval", type: "int" })
  interval: number;

  @Column({ name: "source_id", type: "int" })
  sourceId: number;

  @Column({ name: "assessment_id", type: "int", nullable: true })
  @Index()
  assessmentId: number | null;

  @Column({ name: "decision", type: "varchar" })
  @Index()
  decision: string;

  @Column({ name: "corrected_value", type: "double precision", nullable: true })
  correctedValue: number | null;

  @Column({ name: "reason_code", type: "varchar", nullable: true })
  reasonCode: string | null;

  @Column({ name: "reason_note", type: "text", nullable: true })
  reasonNote: string | null;

  @Column({ name: "reviewed_by_user_id", type: "int" })
  @Index()
  reviewedByUserId: number;

  @Column({ name: "reviewed_at", type: "timestamptz", default: () => "NOW()" })
  reviewedAt: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
