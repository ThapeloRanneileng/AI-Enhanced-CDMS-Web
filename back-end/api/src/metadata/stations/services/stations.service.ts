import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { StationEntity } from '../entities/station.entity';
import { UpdateStationDto } from '../dtos/update-station.dto';
import { CreateStationDto } from '../dtos/create-station.dto';
import { ViewStationQueryDTO } from '../dtos/view-station-query.dto';
import { MetadataUpdatesQueryDto } from 'src/metadata/metadata-updates/dtos/metadata-updates-query.dto';
import { MetadataUpdatesDto } from 'src/metadata/metadata-updates/dtos/metadata-updates.dto';
import { CacheLoadResult, MetadataCache } from 'src/shared/cache/metadata-cache';
import {
    StationMetadataImportResultDto,
    StationMetadataImportRowDto,
} from '../dtos/import-station-metadata.dto';

@Injectable()
export class StationsService implements OnModuleInit {
    private readonly cache: MetadataCache<CreateStationDto>;

    constructor(
        @InjectRepository(StationEntity) private readonly stationRepo: Repository<StationEntity>,
        private readonly dataSource: DataSource,
    ) {
        this.cache = new MetadataCache<CreateStationDto>(
            'Stations',
            () => this.loadCacheData(),
            (dto) => dto.id,
        );
    }

    async onModuleInit(): Promise<void> {
        await this.cache.init();
    }

    private async loadCacheData(): Promise<CacheLoadResult<CreateStationDto>> {
        const entities = await this.stationRepo.find({ order: { id: "ASC" } });
        const records = entities.map(entity => this.createViewDto(entity));
        const lastModifiedDate = entities.length > 0
            ? entities.reduce((max, e) => e.entryDateTime > max ? e.entryDateTime : max, entities[0].entryDateTime)
            : null;
        return { records, lastModifiedDate };
    }

    public find(viewStationQueryDto?: ViewStationQueryDTO): CreateStationDto[] {
        let results = this.cache.getAll();

        if (viewStationQueryDto) {
            // Apply filters
            if (viewStationQueryDto.stationIds) {
                const idSet = new Set(viewStationQueryDto.stationIds);
                results = results.filter(dto => idSet.has(dto.id));
            }

            if (viewStationQueryDto.obsProcessingMethods) {
                const methodSet = new Set(viewStationQueryDto.obsProcessingMethods);
                results = results.filter(dto => dto.stationObsProcessingMethod !== undefined && methodSet.has(dto.stationObsProcessingMethod));
            }

            if (viewStationQueryDto.obsEnvironmentIds) {
                const envIdSet = new Set(viewStationQueryDto.obsEnvironmentIds);
                results = results.filter(dto => dto.stationObsEnvironmentId !== undefined && envIdSet.has(dto.stationObsEnvironmentId));
            }

            if (viewStationQueryDto.obsFocusIds) {
                const focusIdSet = new Set(viewStationQueryDto.obsFocusIds);
                results = results.filter(dto => dto.stationObsFocusId !== undefined && focusIdSet.has(dto.stationObsFocusId));
            }

            // Apply pagination
            if (viewStationQueryDto.page && viewStationQueryDto.page > 0 && viewStationQueryDto.pageSize) {
                const skip = (viewStationQueryDto.page - 1) * viewStationQueryDto.pageSize;
                results = results.slice(skip, skip + viewStationQueryDto.pageSize);
            }
        }

        return results;
    }

    public count(viewStationQueryDto: ViewStationQueryDTO): number {
        let results = this.cache.getAll();

        if (viewStationQueryDto.stationIds) {
            const idSet = new Set(viewStationQueryDto.stationIds);
            results = results.filter(dto => idSet.has(dto.id));
        }

        if (viewStationQueryDto.obsProcessingMethods) {
            const methodSet = new Set(viewStationQueryDto.obsProcessingMethods);
            results = results.filter(dto => dto.stationObsProcessingMethod !== undefined && methodSet.has(dto.stationObsProcessingMethod));
        }

        if (viewStationQueryDto.obsEnvironmentIds) {
            const envIdSet = new Set(viewStationQueryDto.obsEnvironmentIds);
            results = results.filter(dto => dto.stationObsEnvironmentId !== undefined && envIdSet.has(dto.stationObsEnvironmentId));
        }

        if (viewStationQueryDto.obsFocusIds) {
            const focusIdSet = new Set(viewStationQueryDto.obsFocusIds);
            results = results.filter(dto => dto.stationObsFocusId !== undefined && focusIdSet.has(dto.stationObsFocusId));
        }

        return results.length;
    }

    public findOne(id: string): CreateStationDto {
        const dto = this.cache.getById(id);
        if (!dto) {
            throw new NotFoundException(`Station #${id} not found`);
        }
        return dto;
    }

    public async add(createDto: CreateStationDto, userId: number): Promise<CreateStationDto> {
        let entity: StationEntity | null = await this.stationRepo.findOneBy({
            id: createDto.id,
        });

        if (entity) {
            throw new NotFoundException(`Station #${createDto.id} exists`);
        }

        entity = this.stationRepo.create({
            id: createDto.id,
        });

        this.updateEntity(entity, createDto, userId);

        await this.stationRepo.save(entity);
        await this.invalidateCache();

        return this.findOne(entity.id);
    }

    public async update(id: string, updateDto: UpdateStationDto, userId: number): Promise<CreateStationDto> {
        const entity: StationEntity = await this.getEntity(id);
        this.updateEntity(entity, updateDto, userId);
        await this.stationRepo.save(entity);
        await this.invalidateCache();
        return this.createViewDto(entity);
    }

    public async delete(id: string): Promise<string> {
        await this.assertStationIsNotInUse(id);

        try {
            await this.stationRepo.remove(await this.getEntity(id));
            await this.invalidateCache();
            return id;
        } catch (error: any) {
            if (error?.code === '23503') {
                throw new BadRequestException(this.getStationInUseMessage(id));
            }
            throw error;
        }
    }

    private async assertStationIsNotInUse(id: string): Promise<void> {
        const checks: { label: string; table: string; where: string; params: unknown[] }[] = [
            { label: 'observations', table: 'observations', where: 'station_id = $1', params: [id] },
            { label: 'station-source allocations', table: 'station_forms', where: 'station_id = $1', params: [id] },
            { label: 'network affiliations', table: 'station_network_affiliations', where: 'station_id = $1', params: [id] },
            { label: 'paper archive records', table: 'paper_archives', where: 'station_id = $1', params: [id] },
            { label: 'anomaly assessments', table: 'observation_anomaly_assessments', where: 'station_id = $1', params: [id] },
            { label: 'AI training outputs', table: 'observation_anomaly_models', where: 'station_id = $1', params: [id] },
            { label: 'AWS real-time/source specifications', table: 'source_templates', where: `(parameters->'stationIds') ? $1 OR (parameters #> '{dataStructureParameters,stationDefinition,stationsToFetch}') @> $2::jsonb`, params: [id, JSON.stringify([{ databaseId: id }])] },
            { label: 'QC specifications', table: 'qc_tests', where: `(parameters->'stationIds') ? $1`, params: [id] },
        ];

        const dependencies: string[] = [];
        for (const check of checks) {
            const count = await this.getDependencyCount(check.table, check.where, check.params);
            if (count > 0) {
                dependencies.push(check.label);
            }
        }

        if (dependencies.length > 0) {
            throw new BadRequestException(`${this.getStationInUseMessage(id)} Related records found in: ${dependencies.join(', ')}.`);
        }
    }

    private async getDependencyCount(table: string, where: string, params: unknown[]): Promise<number> {
        const result: { count: string }[] = await this.dataSource.query(
            `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`,
            params,
        );
        return Number(result[0]?.count || 0);
    }

    private getStationInUseMessage(id: string): string {
        return `Station #${id} is already in use by observations, source specifications, station allocations, AWS configuration, QC rules, anomaly records, paper archive records, or other records and cannot be deleted.`;
    }

    private async getEntity(id: string): Promise<StationEntity> {
        const entity = await this.stationRepo.findOneBy({
            id: id,
        });

        if (!entity) {
            throw new NotFoundException(`Station #${id} not found`);
        }
        return entity;
    }

    private updateEntity(entity: StationEntity, dto: UpdateStationDto, userId: number): void {
        entity.name = dto.name;
        entity.description = dto.description || '';
        entity.location = (dto.longitude !== undefined && dto.longitude !== null) && (dto.latitude !== undefined && dto.latitude !== null) ? {
            type: "Point",
            coordinates: [dto.longitude, dto.latitude],
        } : null;
        entity.elevation = dto.elevation ?? null;
        entity.obsProcessingMethod = dto.stationObsProcessingMethod || null;
        entity.obsEnvironmentId = dto.stationObsEnvironmentId || null;
        entity.obsFocusId = dto.stationObsFocusId || null;
        entity.ownerId = dto.ownerId || null;
        entity.operatorId = dto.operatorId || null;
        entity.wmoId = dto.wmoId || null;
        entity.wigosId = dto.wigosId || null;
        entity.icaoId = dto.icaoId || null;
        entity.status = dto.status || null;
        entity.dateEstablished = dto.dateEstablished ? new Date(dto.dateEstablished) : null;
        entity.dateClosed = dto.dateClosed ? new Date(dto.dateClosed) : null;
        entity.comment = dto.comment || null;
        entity.entryUserId = userId;
    }

    private createViewDto(entity: StationEntity): CreateStationDto {
        return {
            id: entity.id,
            name: entity.name,
            description: entity.description || undefined,
            longitude: entity.location?.coordinates[0] || undefined,
            latitude: entity.location?.coordinates[1] || undefined,
            elevation: entity.elevation || undefined,
            stationObsProcessingMethod: entity.obsProcessingMethod || undefined,
            stationObsEnvironmentId: entity.obsEnvironmentId || undefined,
            stationObsFocusId: entity.obsFocusId || undefined,
            ownerId: entity.ownerId || undefined,
            operatorId: entity.operatorId || undefined,
            wmoId: entity.wmoId || undefined,
            wigosId: entity.wigosId || undefined,
            icaoId: entity.icaoId || undefined,
            status: entity.status || undefined,
            dateEstablished: entity.dateEstablished?.toISOString() || undefined,
            dateClosed: entity.dateClosed?.toISOString() || undefined,
            comment: entity.comment || undefined,
        }
    }

    public async bulkPut(dtos: CreateStationDto[], userId: number) {
        const entities: StationEntity[] = [];
        for (const dto of dtos) {
            const entity: StationEntity = this.stationRepo.create({
                id: dto.id,
            });

            this.updateEntity(entity, dto, userId);
            entities.push(entity);
        }

        const batchSize = 1000;
        for (let i = 0; i < entities.length; i += batchSize) {
            const batch = entities.slice(i, i + batchSize);
            await this.insertOrUpdateValues(batch);
        }

        await this.invalidateCache();
    }

    public async importStationMetadataRows(rows: StationMetadataImportRowDto[], userId: number): Promise<StationMetadataImportResultDto> {
        const rejectedRows: StationMetadataImportResultDto['rejectedRows'] = [];
        const existingStationIds = new Set(this.cache.getAll().map(station => station.id));
        const acceptedRows: { rowNumber: number; sourceRow: StationMetadataImportRowDto; station: CreateStationDto }[] = [];

        rows.forEach((row, index) => {
            const rowNumber = index + 2;
            const stationId = this.toOptionalString(row.id);
            const stationName = this.toOptionalString(row.name);
            const reasons: string[] = [];

            if (!stationId) reasons.push('Station ID is required');
            if (!stationName) reasons.push('Station name is required');
            if (stationId && existingStationIds.has(stationId)) reasons.push(`Station ID '${stationId}' already exists`);

            const latitude = this.parseOptionalNumber(row.latitude, 'Latitude', reasons);
            const longitude = this.parseOptionalNumber(row.longitude, 'Longitude', reasons);
            const elevation = this.parseOptionalNumber(row.elevation, 'Elevation', reasons);

            if (reasons.length > 0 || !stationId || !stationName) {
                rejectedRows.push({
                    rowNumber,
                    stationId,
                    reasons,
                    row,
                });
                return;
            }

            acceptedRows.push({
                rowNumber,
                sourceRow: row,
                station: {
                    id: stationId,
                    name: stationName,
                    description: this.toOptionalString(row.description),
                    latitude,
                    longitude,
                    elevation,
                    wmoId: this.toOptionalString(row.wmoId),
                    wigosId: this.toOptionalString(row.wigosId),
                    icaoId: this.toOptionalString(row.icaoId),
                    comment: this.toOptionalString(row.comment),
                },
            });
            existingStationIds.add(stationId);
        });

        let importedRows = 0;
        for (const acceptedRow of acceptedRows) {
            const entity = this.stationRepo.create({ id: acceptedRow.station.id });
            this.updateEntity(entity, acceptedRow.station, userId);

            try {
                await this.stationRepo.save(entity);
                importedRows++;
            } catch (error) {
                rejectedRows.push({
                    rowNumber: acceptedRow.rowNumber,
                    stationId: acceptedRow.station.id,
                    reasons: [this.formatImportSaveError(error)],
                    row: acceptedRow.sourceRow,
                });
            }
        }

        if (importedRows > 0) {
            await this.invalidateCache();
        }

        return {
            totalRows: rows.length,
            importedRows,
            rejectedRows,
        };
    }

    private toOptionalString(value: unknown): string | undefined {
        if (value === undefined || value === null) return undefined;
        const text = String(value).trim();
        return text === '' ? undefined : text;
    }

    private parseOptionalNumber(value: unknown, fieldName: string, reasons: string[]): number | undefined {
        const text = this.toOptionalString(value);
        if (!text) return undefined;

        const numberValue = Number(text);
        if (!Number.isFinite(numberValue)) {
            reasons.push(`${fieldName} must be numeric`);
            return undefined;
        }

        return numberValue;
    }

    private formatImportSaveError(error: unknown): string {
        if (error && typeof error === 'object' && 'detail' in error && typeof error.detail === 'string') {
            return error.detail;
        }
        if (error instanceof Error && error.message) {
            return error.message;
        }
        return 'Could not save station row';
    }

    private async insertOrUpdateValues(entities: StationEntity[]): Promise<void> {
        await this.stationRepo
            .createQueryBuilder()
            .insert()
            .into(StationEntity)
            .values(entities)
            .orUpdate(
                [
                    "name",
                    "description",
                    "observation_processing_method",
                    "location",
                    "elevation",
                    "observation_environment_id",
                    "observation_focus_id",
                    "owner_id",
                    "operator_id",
                    "wmo_id",
                    "wigos_id",
                    "icao_id",
                    "status",
                    "date_established",
                    "date_closed",
                    "comment",
                    "entry_user_id"
                ],
                ["id"],
                {
                    skipUpdateIfNoValuesChanged: true,
                }
            )
            .execute();
    }

    public async deleteAll(): Promise<boolean> {
        const entities: StationEntity[] = await this.stationRepo.find();
        // Note, don't use .clear() because truncating a table referenced in a foreign key constraint is not supported
        await this.stationRepo.remove(entities);
        await this.invalidateCache();
        return true;
    }

    public async invalidateCache(): Promise<void> {
        await this.cache.invalidate();
    }

    public checkUpdates(updatesQueryDto: MetadataUpdatesQueryDto): MetadataUpdatesDto {
        return this.cache.checkUpdates(updatesQueryDto);
    }

}
