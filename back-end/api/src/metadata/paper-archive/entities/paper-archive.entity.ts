import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AppBaseEntity } from 'src/shared/entity/app-base-entity';

export enum PaperArchiveStatusEnum {
    ACTIVE = 'active',
    NEEDS_REVIEW = 'needs_review',
}

@Entity('paper_archives')
export class PaperArchiveEntity extends AppBaseEntity {
    @PrimaryGeneratedColumn({ name: 'id', type: 'int' })
    id: number;

    @Column({ name: 'station_id', type: 'varchar', nullable: true })
    @Index()
    stationId: string | null;

    @Column({ name: 'source_id', type: 'int', nullable: true })
    @Index()
    sourceId: number | null;

    @Column({ name: 'observation_date', type: 'date', nullable: true })
    @Index()
    observationDate: string | null;

    @Column({ name: 'observation_hour', type: 'int', nullable: true })
    observationHour: number | null;

    @Column({ name: 'original_file_name', type: 'varchar' })
    originalFileName: string;

    @Column({ name: 'stored_file_name', type: 'varchar', unique: true })
    storedFileName: string;

    @Column({ name: 'archive_path', type: 'varchar' })
    archivePath: string;

    @Column({ name: 'checksum', type: 'varchar', nullable: true })
    checksum: string | null;

    @Column({ name: 'notes', type: 'varchar', nullable: true })
    notes: string | null;

    @Column({ name: 'status', type: 'enum', enum: PaperArchiveStatusEnum, default: PaperArchiveStatusEnum.ACTIVE })
    @Index()
    status: PaperArchiveStatusEnum;
}
