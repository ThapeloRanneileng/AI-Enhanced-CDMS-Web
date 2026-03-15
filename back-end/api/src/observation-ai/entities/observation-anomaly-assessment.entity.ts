import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export enum ObservationAnomalyAssessmentTypeEnum {
  INGESTION = "ingestion",
  ON_DEMAND_QC = "on_demand_qc",
  RECHECK = "recheck",
  BACKFILL = "backfill",
}

export enum ObservationAnomalySeverityEnum {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export enum ObservationAnomalyOutcomeEnum {
  PASSED = "passed",
  SUSPECT = "suspect",
  FAILED = "failed",
  NOT_APPLICABLE = "not_applicable",
}

@Entity("observation_anomaly_assessments")
@Index("IDX_obs_anomaly_assessment_lookup", ["stationId", "elementId", "level", "datetime", "interval", "sourceId"])
export class ObservationAnomalyAssessmentEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id: number;

  @Column({ name: "station_id", type: "varchar" })
  @Index()
  stationId: string;

  @Column({ name: "element_id", type: "int" })
  @Index()
  elementId: number;

  @Column({ name: "level", type: "int" })
  @Index()
  level: number;

  @Column({ name: "date_time", type: "timestamptz" })
  @Index()
  datetime: Date;

  @Column({ name: "interval", type: "int" })
  @Index()
  interval: number;

  @Column({ name: "source_id", type: "int" })
  @Index()
  sourceId: number;

  @Column({ name: "assessment_type", type: "enum", enum: ObservationAnomalyAssessmentTypeEnum })
  @Index()
  assessmentType: ObservationAnomalyAssessmentTypeEnum;

  @Column({ name: "model_id", type: "varchar" })
  modelId: string;

  @Column({ name: "model_version", type: "varchar" })
  modelVersion: string;

  @Column({ name: "anomaly_score", type: "float" })
  anomalyScore: number;

  @Column({ name: "severity", type: "enum", enum: ObservationAnomalySeverityEnum })
  severity: ObservationAnomalySeverityEnum;

  @Column({ name: "outcome", type: "enum", enum: ObservationAnomalyOutcomeEnum })
  @Index()
  outcome: ObservationAnomalyOutcomeEnum;

  @Column({ name: "reasons", type: "jsonb", nullable: true })
  reasons: string[] | null;

  @Column({ name: "feature_snapshot", type: "jsonb", nullable: true })
  featureSnapshot: Record<string, number | string | null> | null;

  @Column({ name: "created_by_user_id", type: "int", nullable: true })
  @Index()
  createdByUserId: number | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  @Index()
  createdAt: Date;
}
