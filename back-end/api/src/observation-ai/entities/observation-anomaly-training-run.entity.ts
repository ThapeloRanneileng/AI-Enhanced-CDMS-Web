import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type ObservationAnomalyTrainingDatasetKind = "shared_observation" | "proxy_public";
export type ObservationAnomalyTrainingRunStatus = "completed" | "insufficient_data" | "failed";

@Entity("observation_anomaly_training_runs")
export class ObservationAnomalyTrainingRunEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id: number;

  @Column({ name: "training_dataset_kind", type: "varchar" })
  @Index()
  trainingDatasetKind: ObservationAnomalyTrainingDatasetKind;

  @Column({ name: "training_range_from", type: "timestamptz", nullable: true })
  trainingRangeFrom: Date | null;

  @Column({ name: "training_range_to", type: "timestamptz", nullable: true })
  trainingRangeTo: Date | null;

  @Column({ name: "training_rows", type: "int" })
  trainingRows: number;

  @Column({ name: "feature_schema_version", type: "varchar" })
  featureSchemaVersion: string;

  @Column({ name: "status", type: "varchar" })
  @Index()
  status: ObservationAnomalyTrainingRunStatus;

  @Column({ name: "request_snapshot", type: "jsonb", nullable: true })
  requestSnapshot: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  @Index()
  createdAt: Date;
}
