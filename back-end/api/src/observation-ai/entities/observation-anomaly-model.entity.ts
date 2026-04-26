import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { ObservationAnomalyTrainingDatasetKind } from "./observation-anomaly-training-run.entity";

@Entity("observation_anomaly_models")
@Index("IDX_obs_anomaly_model_lookup", ["stationId", "elementId", "interval", "level", "modelName"])
export class ObservationAnomalyModelEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id: number;

  @Column({ name: "training_run_id", type: "int", nullable: true })
  @Index()
  trainingRunId: number | null;

  @Column({ name: "model_id", type: "varchar" })
  @Index()
  modelId: string;

  @Column({ name: "model_name", type: "varchar" })
  @Index()
  modelName: string;

  @Column({ name: "model_version", type: "varchar" })
  modelVersion: string;

  @Column({ name: "station_id", type: "varchar" })
  @Index()
  stationId: string;

  @Column({ name: "element_id", type: "int" })
  @Index()
  elementId: number;

  @Column({ name: "interval", type: "int" })
  @Index()
  interval: number;

  @Column({ name: "level", type: "int" })
  @Index()
  level: number;

  @Column({ name: "training_range_from", type: "timestamptz" })
  trainingRangeFrom: Date;

  @Column({ name: "training_range_to", type: "timestamptz" })
  trainingRangeTo: Date;

  @Column({ name: "training_rows", type: "int" })
  trainingRows: number;

  @Column({ name: "training_dataset_kind", type: "varchar" })
  @Index()
  trainingDatasetKind: ObservationAnomalyTrainingDatasetKind;

  @Column({ name: "feature_schema_version", type: "varchar" })
  featureSchemaVersion: string;

  @Column({ name: "model_state", type: "jsonb" })
  modelState: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  @Index()
  createdAt: Date;
}
