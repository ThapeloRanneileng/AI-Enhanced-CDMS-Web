import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, DeleteResult, Equal, FindManyOptions, FindOperator, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual, Repository, UpdateResult } from 'typeorm';
import { ObservationEntity } from '../entities/observation.entity';
import { CreateObservationDto } from '../dtos/create-observation.dto';
import { ViewObservationQueryDTO } from '../dtos/view-observation-query.dto';
import { ViewObservationDto } from '../dtos/view-observation.dto';
import { QCStatusEnum } from '../enums/qc-status.enum';
import { EntryFormObservationQueryDto } from '../dtos/entry-form-observation-query.dto';
import { DeleteObservationDto } from '../dtos/delete-observation.dto';
import { UsersService } from 'src/user/services/users.service';
import { StationStatusQueryDto } from '../dtos/station-status-query.dto';
import { StationStatusDataQueryDto } from '../dtos/station-status-data-query.dto';
import { DataAvailabilitySummaryQueryDto, DurationTypeEnum } from '../dtos/data-availability-summary-query.dto';
import { GeneralSettingsService } from 'src/settings/services/general-settings.service';
import { SettingIdEnum } from 'src/settings/dtos/setting-id.enum';
import { ClimsoftDisplayTimeZoneDto } from 'src/settings/dtos/settings/climsoft-display-timezone.dto';
import { DateUtils } from 'src/shared/utils/date.utils';
import { DataFlowQueryDto } from '../dtos/data-flow-query.dto';
import { ViewObservationLogDto } from '../dtos/view-observation-log.dto';
import { ViewUserDto } from 'src/user/dtos/view-user.dto';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DataAvailabilityDetailsQueryDto } from '../dtos/data-availability-details-query.dto';
import { DataAvailaibilityDetailsDto } from '../dtos/data-availability-details.dto';
import { ObservationEventUtils } from '../events/observations-saved.event';
import { StationsService } from 'src/metadata/stations/services/stations.service';
import { ElementsService } from 'src/metadata/elements/services/elements.service';
import { SourceSpecificationsService } from 'src/metadata/source-specifications/services/source-specifications.service';
import { SourceTypeEnum } from 'src/metadata/source-specifications/enums/source-type.enum';
import {
    ObservationDataImportResultDto,
    ObservationDataImportRowDto,
} from '../dtos/import-observation-data.dto';
import { ViewSourceSpecificationDto } from 'src/metadata/source-specifications/dtos/view-source-specification.dto';
import { getObservationOriginLabel } from './observation-source-label.util';
import { LoggedInUserDto } from 'src/user/dtos/logged-in-user.dto';
import { DataEntryAndCorrectionCheckService } from './data-entry-corection-check.service';

@Injectable()
export class ObservationsService {
    private readonly logger = new Logger(ObservationsService.name);

    constructor(
        @InjectRepository(ObservationEntity) private observationRepo: Repository<ObservationEntity>,
        private dataSource: DataSource,
        private usersService: UsersService,
        private generalSettingsService: GeneralSettingsService,
        private eventEmitter: EventEmitter2,
        private stationsService: StationsService,
        private elementsService: ElementsService,
        private sourceSpecificationsService: SourceSpecificationsService,
        private dataEntryCheckService: DataEntryAndCorrectionCheckService,
    ) {
    }

 

    public async findFormData(queryDto: EntryFormObservationQueryDto): Promise<ViewObservationDto[]> {
        const entities: ObservationEntity[] = await this.observationRepo.findBy({
            stationId: queryDto.stationId,
            elementId: In(queryDto.elementIds),
            interval: queryDto.interval,
            sourceId: queryDto.sourceId,
            level: queryDto.level,
            datetime: Between(new Date(queryDto.fromDate), new Date(queryDto.toDate)),
            deleted: false,
        });

        return this.createViewObsDtos(entities);
    }

    public async findProcessed(queryDto: ViewObservationQueryDTO): Promise<ViewObservationDto[]> {
        // TODO. This is a temporary check. Find out how we can do this at the dto validation level. 
        if (!(queryDto.page && queryDto.pageSize && queryDto.pageSize <= 1000)) {
            throw new BadRequestException("You must specify page and page size. Page size must be less than or equal to 1000")
        }

        const findOptions: FindManyOptions<ObservationEntity> = {
            order: {
                datetime: "ASC", // Sort by date time first
                stationId: "ASC",
                elementId: "ASC",
                interval: "ASC",
                level: "ASC",
            },
            where: this.getProcessedFilter(queryDto),
            skip: (queryDto.page - 1) * queryDto.pageSize,
            take: queryDto.pageSize
        };

        return this.createViewObsDtos(await this.observationRepo.find(findOptions));
    }

    public async count(selectObsevationDto: ViewObservationQueryDTO): Promise<number> {
        const whereOptions: FindOptionsWhere<ObservationEntity> = this.getProcessedFilter(selectObsevationDto);
        return this.observationRepo.countBy(whereOptions);
    }

    private getProcessedFilter(queryDto: ViewObservationQueryDTO): FindOptionsWhere<ObservationEntity> {
        const whereOptions: FindOptionsWhere<ObservationEntity> = {};

        if (queryDto.stationIds) {
            whereOptions.stationId = queryDto.stationIds.length === 1 ? queryDto.stationIds[0] : In(queryDto.stationIds);
        }

        if (queryDto.elementIds) {
            whereOptions.elementId = queryDto.elementIds.length === 1 ? queryDto.elementIds[0] : In(queryDto.elementIds);
        }

        if (queryDto.level !== undefined) {
            whereOptions.level = queryDto.level;
        }

        if (queryDto.intervals) {
            whereOptions.interval = queryDto.intervals.length === 1 ? queryDto.intervals[0] : In(queryDto.intervals);
        }

        if (queryDto.sourceIds) {
            whereOptions.sourceId = queryDto.sourceIds.length === 1 ? queryDto.sourceIds[0] : In(queryDto.sourceIds);
        }

        this.setProcessedObsDateFilter(queryDto, whereOptions);

        if (queryDto.qcStatus) {
            whereOptions.qcStatus = queryDto.qcStatus;
        }

        whereOptions.deleted = queryDto.deleted;

        return whereOptions;
    }

    private setProcessedObsDateFilter(selectObsevationDto: ViewObservationQueryDTO, selectOptions: FindOptionsWhere<ObservationEntity>) {
        let dateOperator: FindOperator<Date> | null = null;
        if (selectObsevationDto.fromDate && selectObsevationDto.toDate) {
            if (selectObsevationDto.fromDate === selectObsevationDto.toDate) {
                dateOperator = Equal(new Date(selectObsevationDto.fromDate));
            } else {
                dateOperator = Between(new Date(selectObsevationDto.fromDate), new Date(selectObsevationDto.toDate));
            }

        } else if (selectObsevationDto.fromDate) {
            dateOperator = MoreThanOrEqual(new Date(selectObsevationDto.fromDate));
        } else if (selectObsevationDto.toDate) {
            dateOperator = LessThanOrEqual(new Date(selectObsevationDto.toDate));
        }

        if (dateOperator !== null) {
            if (selectObsevationDto.useEntryDate) {
                selectOptions.entryDateTime = dateOperator;
            } else {
                selectOptions.datetime = dateOperator;
            }
        }

    }

    private async createViewObsDtos(obsEntities: ObservationEntity[]): Promise<ViewObservationDto[]> {
        const obsView: ViewObservationDto[] = [];
        const sourceIds = [...new Set(obsEntities.map(obsEntity => obsEntity.sourceId))];
        const sourcesById = new Map<number, ViewSourceSpecificationDto>(
            this.sourceSpecificationsService.findSourcesByIds(sourceIds).map(source => [source.id, source])
        );

        for (const obsEntity of obsEntities) {
            const source = sourcesById.get(obsEntity.sourceId);
            const viewObs: ViewObservationDto = {
                stationId: obsEntity.stationId,
                elementId: obsEntity.elementId,
                sourceId: obsEntity.sourceId,
                level: obsEntity.level,
                interval: obsEntity.interval,
                datetime: obsEntity.datetime.toISOString(),
                value: obsEntity.value,
                flag: obsEntity.flag,
                comment: obsEntity.comment,
                qcStatus: obsEntity.qcStatus,
                qcTestLog: obsEntity.qcTestLog,
                log: this.createViewLog(obsEntity),
                entryDatetime: obsEntity.entryDateTime.toISOString(),
                sourceName: source?.name ?? '',
                sourceType: source?.sourceType ?? null,
                observationOrigin: getObservationOriginLabel(source),
            };
            obsView.push(viewObs);
        }
        return obsView;
    }

    private createViewLog(entity: ObservationEntity): ViewObservationLogDto[] {
        const viewLogDto: ViewObservationLogDto[] = [];
        let user: ViewUserDto | undefined;
        if (entity.log) {
            for (const logItem of entity.log) {
                user = this.usersService.findOne(logItem.entryUserId);
                viewLogDto.push({
                    value: logItem.value,
                    flag: logItem.flag,
                    qcStatus: logItem.qcStatus,
                    comment: logItem.comment,
                    deleted: logItem.deleted,
                    entryUserName: user ? user.name : '',
                    entryUserEmail: user ? user.email : '',
                    entryDateTime: logItem.entryDateTime,
                });
            }
        }

        // Include the current values as log.
        // Important because present values should be part of the record history
        user = this.usersService.findOne(entity.entryUserId);
        const currentValuesAsLogObj: ViewObservationLogDto = {
            value: entity.value,
            flag: entity.flag,
            qcStatus: entity.qcStatus,
            comment: entity.comment,
            deleted: entity.deleted,
            entryUserName: user ? user.name : '',
            entryUserEmail: user ? user.email : '',
            entryDateTime: entity.entryDateTime.toISOString()
        }

        viewLogDto.push(currentValuesAsLogObj);
        return viewLogDto;
    }

    /**
     * Counts the number of records needed to be saved to V4.
     * Important note. Maximum count is 1,000,001 to limit compute needed
     * @returns 
     */
    public async countObservationsNotSavedToV4(): Promise<number> {
        return this.observationRepo.count({
            where: { savedToV4: false },
            take: 1000001, // Important. Limit to 1 million and 1 for performance reasons
        });
    }

    /**
     * 
     * @param createObservationDtos 
     * @param userId 
     * @param ignoreV4Saving When true, observations will be indicated as already saved to v4 and they will not be uploaded to version 4 databse
     */
    public async bulkPut(createObservationDtos: CreateObservationDto[], userId: number, qcStatus = QCStatusEnum.NONE, ignoreV4Saving: boolean = false): Promise<void> {
        let startTime: number = Date.now();

        // Transform dtos to entities
        const obsEntities: ObservationEntity[] = [];
        for (const dto of createObservationDtos) {
            const entity: ObservationEntity = this.observationRepo.create({
                stationId: dto.stationId,
                elementId: dto.elementId,
                level: dto.level,
                sourceId: dto.sourceId,
                datetime: new Date(dto.datetime),
                interval: dto.interval,
                value: dto.value,
                flag: dto.flag,
                qcStatus: qcStatus,
                comment: dto.comment ? dto.comment : null,
                entryUserId: userId,
                deleted: false,
                savedToV4: ignoreV4Saving,
            });

            obsEntities.push(entity);
        }
        this.logger.log(`DTO transformation took: ${(Date.now() - startTime)} milliseconds`);

        // Save in batches of 1000 to minimise excess payload errors when saving to postgres
        this.logger.log(`Saving ${obsEntities.length} entities from user - ${userId}`);
        startTime = Date.now();
        const batchSize = 1000; // batch size of 1000 seems to be safer (incase there are comments) and faster.
        for (let i = 0; i < obsEntities.length; i += batchSize) {
            const batch = obsEntities.slice(i, i + batchSize);
            //await this.insertOrUpdateObsValues(this.observationRepo, batch);


            await this.observationRepo
                .createQueryBuilder()
                .insert()
                .into(ObservationEntity)
                .values(batch)
                .orUpdate(
                    [
                        "value",
                        "flag",
                        "qc_status",
                        "comment",
                        "deleted",
                        "saved_to_v4",
                        "entry_user_id",
                    ],
                    [
                        "station_id",
                        "element_id",
                        "level",
                        "source_id",
                        "date_time",
                        "interval",
                    ],
                    {
                        skipUpdateIfNoValuesChanged: true,
                    }
                )
                .execute();


            this.logger.log(`${batch.length} entities from user - ${userId} successfully saved!`);
        }
        this.logger.log(`Saving entities from user - ${userId}, took: ${(Date.now() - startTime)} milliseconds`);

        const observationKeys = ObservationEventUtils.deduplicateObservationKeys(
            obsEntities.map(obs => ObservationEventUtils.mapEntityKey(obs))
        );

        this.logger.log(`Emitting observations.saved for ${observationKeys.length} observation(s)`);
        if (observationKeys.length > 0) {
            this.logger.debug(`observations.saved sample key: ${JSON.stringify({
                ...observationKeys[0],
                datetime: observationKeys[0].datetime.toISOString(),
            })}`);
        }

        this.eventEmitter.emit('observations.saved', {
            observationKeys,
        });

    }

    public async importObservationDataRows(rows: ObservationDataImportRowDto[], user: LoggedInUserDto): Promise<ObservationDataImportResultDto> {
        const rejectedRows: ObservationDataImportResultDto['rejectedRows'] = [];
        const acceptedRows: { rowNumber: number; sourceRow: ObservationDataImportRowDto; observation: CreateObservationDto }[] = [];
        const stationIds = new Set(this.stationsService.find().map(station => station.id));
        const elements = this.elementsService.find();
        const elementById = new Map(elements.map(element => [element.id, element]));
        const elementByCode = new Map<string, number>();
        for (const element of elements) {
            elementByCode.set(element.abbreviation.toLowerCase(), element.id);
            elementByCode.set(element.name.toLowerCase(), element.id);
        }

        const sources = this.sourceSpecificationsService.findAll().filter(source => !source.disabled);
        const sourceById = new Map(sources.map(source => [source.id, source]));
        const sourceByName = new Map(sources.map(source => [source.name.toLowerCase(), source]));
        const defaultSource = sources.find(source => source.sourceType === SourceTypeEnum.IMPORT) || sources[0];

        rows.forEach((row, index) => {
            const rowNumber = index + 2;
            const stationId = this.toOptionalString(row.stationId);
            const elementText = this.toOptionalString(row.element);
            const observationDatetimeText = this.toOptionalString(row.observationDatetime);
            const reasons: string[] = [];

            if (!stationId) reasons.push('Station ID is required');
            if (stationId && !stationIds.has(stationId)) reasons.push(`Station ID '${stationId}' does not exist`);

            if (!elementText) reasons.push('Element is required');
            const elementId = elementText ? this.resolveElementId(elementText, elementById, elementByCode) : undefined;
            if (elementText && elementId === undefined) reasons.push(`Element '${elementText}' does not exist`);

            if (!observationDatetimeText) reasons.push('Observation datetime is required');
            const observationDatetime = observationDatetimeText ? new Date(observationDatetimeText) : null;
            if (observationDatetimeText && !this.isValidDate(observationDatetime)) reasons.push('Observation datetime must be a valid date/time');

            const value = this.parseRequiredNumber(row.value, 'Value', reasons);
            const level = this.parseOptionalInteger(row.level, 'Level', reasons) ?? 0;
            const interval = this.parseOptionalInteger(row.interval, 'Interval', reasons) ?? 0;
            const sourceId = this.resolveSourceId(row.source, sourceById, sourceByName, defaultSource?.id, reasons);
            this.validateManualImportSourcePermission(sourceId, user, reasons);

            if (reasons.length > 0 || !stationId || elementId === undefined || !observationDatetime) {
                rejectedRows.push({
                    rowNumber,
                    stationId,
                    element: elementText,
                    reasons,
                    row,
                });
                return;
            }

            acceptedRows.push({
                rowNumber,
                sourceRow: row,
                observation: {
                    stationId,
                    elementId,
                    sourceId,
                    level,
                    datetime: observationDatetime.toISOString(),
                    interval,
                    value,
                    flag: null,
                    comment: this.toOptionalString(row.comment) || null,
                },
            });
        });

        let importedRows = 0;
        for (let i = 0; i < acceptedRows.length; i++) {
            try {
                await this.dataEntryCheckService.checkData([acceptedRows[i].observation], user, 'data-entry');
                await this.bulkPut([acceptedRows[i].observation], user.id, QCStatusEnum.NONE);
                importedRows++;
            } catch (error) {
                rejectedRows.push({
                    rowNumber: acceptedRows[i].rowNumber,
                    stationId: acceptedRows[i].observation.stationId,
                    element: String(acceptedRows[i].observation.elementId),
                    reasons: [this.formatImportSaveError(error)],
                    row: acceptedRows[i].sourceRow,
                });
            }
        }

        return {
            totalRows: rows.length,
            importedRows,
            rejectedRows,
        };
    }

    private validateManualImportSourcePermission(sourceId: number, user: LoggedInUserDto, reasons: string[]): void {
        if (user.isSystemAdmin || sourceId === 0) return;

        if (!user.permissions) {
            reasons.push('Could not check import permissions');
            return;
        }

        const importPermissions = user.permissions.importPermissions;
        if (!importPermissions) {
            reasons.push('Not authorised to import data');
            return;
        }

        if (importPermissions.importTemplateIds && !importPermissions.importTemplateIds.includes(sourceId)) {
            reasons.push('Not authorised to access the import');
        }
    }

    private resolveElementId(
        elementText: string,
        elementById: Map<number, unknown>,
        elementByCode: Map<string, number>,
    ): number | undefined {
        const numericElementId = Number(elementText);
        if (Number.isInteger(numericElementId) && elementById.has(numericElementId)) return numericElementId;
        return elementByCode.get(elementText.toLowerCase());
    }

    private resolveSourceId(
        sourceValue: unknown,
        sourceById: Map<number, unknown>,
        sourceByName: Map<string, unknown>,
        defaultSourceId: number | undefined,
        reasons: string[],
    ): number {
        const sourceText = this.toOptionalString(sourceValue);
        if (!sourceText) {
            if (defaultSourceId !== undefined) return defaultSourceId;
            reasons.push('Source is required because no import source exists');
            return 0;
        }

        const numericSourceId = Number(sourceText);
        if (Number.isInteger(numericSourceId) && sourceById.has(numericSourceId)) return numericSourceId;
        const sourceByNameMatch = sourceByName.get(sourceText.toLowerCase());
        if (sourceByNameMatch && typeof sourceByNameMatch === 'object' && 'id' in sourceByNameMatch && typeof sourceByNameMatch.id === 'number') {
            return sourceByNameMatch.id;
        }

        reasons.push(`Source '${sourceText}' does not exist`);
        return 0;
    }

    private toOptionalString(value: unknown): string | undefined {
        if (value === undefined || value === null) return undefined;
        const text = String(value).trim();
        return text === '' ? undefined : text;
    }

    private parseRequiredNumber(value: unknown, fieldName: string, reasons: string[]): number {
        const text = this.toOptionalString(value);
        if (!text) {
            reasons.push(`${fieldName} is required`);
            return 0;
        }

        const numberValue = Number(text);
        if (!Number.isFinite(numberValue)) {
            reasons.push(`${fieldName} must be numeric`);
            return 0;
        }

        return numberValue;
    }

    private parseOptionalInteger(value: unknown, fieldName: string, reasons: string[]): number | undefined {
        const text = this.toOptionalString(value);
        if (!text) return undefined;

        const numberValue = Number(text);
        if (!Number.isInteger(numberValue)) {
            reasons.push(`${fieldName} must be an integer`);
            return undefined;
        }

        return numberValue;
    }

    private isValidDate(value: Date | null): value is Date {
        return value instanceof Date && !Number.isNaN(value.getTime());
    }

    private formatImportSaveError(error: unknown): string {
        if (error && typeof error === 'object' && 'detail' in error && typeof error.detail === 'string') {
            return error.detail;
        }
        if (error instanceof Error && error.message) {
            return error.message;
        }
        return 'Could not save observation row';
    }

    public async softDelete(obsDtos: DeleteObservationDto[], userId: number): Promise<number> {
        return this.softDeleteOrRestore(obsDtos, true, userId)
    }

    public async restore(obsDtos: DeleteObservationDto[], userId: number): Promise<number> {
        return this.softDeleteOrRestore(obsDtos, false, userId)
    }

    private async softDeleteOrRestore(obsDtos: DeleteObservationDto[], deletedStatus: boolean, userId: number): Promise<number> {
        // Build an array of objects representing each composite primary key. 
        const compositeKeys = obsDtos.map((obs) => ({
            stationId: obs.stationId,
            elementId: obs.elementId,
            level: obs.level,
            datetime: obs.datetime,
            interval: obs.interval,
            sourceId: obs.sourceId,
        }));


        // Use QueryBuilder's whereInIds to update all matching rows in a single query.
        const updatedResults: UpdateResult = await this.observationRepo
            .createQueryBuilder()
            .update(ObservationEntity)
            .set({
                deleted: deletedStatus,
                savedToV4: false,
                entryUserId: userId,
            })
            .whereInIds(compositeKeys)
            .execute();

        this.eventEmitter.emit(deletedStatus ? 'observations.deleted' : 'observations.restored');

        // If affected results not supported then just return the dtos length.
        // Note, affected results will always be defined because the API uses postgres.
        return updatedResults.affected ? updatedResults.affected : obsDtos.length;
    }

    public async hardDelete(deleteObsDtos: DeleteObservationDto[]): Promise<number> {
        // Build an array of objects representing each composite primary key. 
        const compositeKeys = deleteObsDtos.map((obs) => ({
            stationId: obs.stationId,
            elementId: obs.elementId,
            level: obs.level,
            datetime: obs.datetime,
            interval: obs.interval,
            sourceId: obs.sourceId,
        }));

        // Use QueryBuilder's whereInIds to update all matching rows in a single query.
        const updatedResults: DeleteResult = await this.observationRepo.createQueryBuilder()
            .delete()
            .from(ObservationEntity)
            .whereInIds(compositeKeys)
            .execute();

        return updatedResults.affected ? updatedResults.affected : deleteObsDtos.length;
    }

    // NOTE. Left here for future reference. In fututure we want to be able to delete by station id and source id. 
    // This will be useful code to reuse.
    private async hardDeleteBy(deleteObsDtos: DeleteObservationDto[]): Promise<number> {
        let succesfulChanges: number = 0;
        for (const dto of deleteObsDtos) {
            const result = await this.observationRepo.createQueryBuilder()
                .delete()
                .from(ObservationEntity)
                .where('station_id = :station_id', { station_id: dto.stationId })
                .andWhere('element_id = :element_id', { element_id: dto.elementId })
                .andWhere('level = :level', { level: dto.level })
                .andWhere('date_time = :date_time', { date_time: dto.datetime })
                .andWhere('interval = :interval', { interval: dto.interval })
                .andWhere('source_id = :source_id', { source_id: dto.sourceId })
                .execute();

            if (result.affected) {
                succesfulChanges = succesfulChanges + 1;
            }
        }

        return succesfulChanges;
    }

    public async findStationsStatus(stationStatusQuery: StationStatusQueryDto): Promise<string[]> {
        const durationType: 'HOURS' | 'DAYS' = stationStatusQuery.durationType === 'hours' ? 'HOURS' : 'DAYS';
        const duration: number = stationStatusQuery.duration;
        let extraSQLCondition: string = '';
        if (stationStatusQuery.stationIds && stationStatusQuery.stationIds.length > 0) {
            extraSQLCondition = extraSQLCondition + `station_id IN (${stationStatusQuery.stationIds.map(id => `'${id}'`).join(',')}) AND `;
        }

        if (stationStatusQuery.elementId !== undefined && stationStatusQuery.elementId > 0) {
            extraSQLCondition = extraSQLCondition + ` element_id = ${stationStatusQuery.elementId} AND `;
        }

        // TODO. Use parameterised queries
        const results = await this.dataSource.manager.query(
            `
            SELECT DISTINCT station_id 
            FROM observations 
            WHERE ${extraSQLCondition} date_time >= NOW() - INTERVAL '${duration} ${durationType}' AND deleted = FALSE;
            `);

        return results.map((item: { station_id: any; }) => item.station_id);
    }

    public async findStationsStatusData(stationId: string, stationStatusQuery: StationStatusDataQueryDto): Promise<{ elementId: number, level: number, datetime: string, interval: number, sourceId: number, value: number | null, flag: string | null }[]> {
        const durationType: 'HOURS' | 'DAYS' = stationStatusQuery.durationType === 'hours' ? 'HOURS' : 'DAYS';
        const duration: number = stationStatusQuery.duration;

        let extraSQLCondition: string = '';
        if (stationStatusQuery.elementId !== undefined && stationStatusQuery.elementId > 0) {
            extraSQLCondition = extraSQLCondition + ` AND o.element_id = ${stationStatusQuery.elementId}`;
        }

        // TODO. use parameterised queries
        const results = await this.dataSource.manager.query(
            `
            SELECT o.element_id AS "elementId", o."level" AS "level", o.date_time AS "datetime", o."interval" AS "interval", o.source_id AS "sourceId", o.value AS "value", o.flag AS "flag" 
            FROM observations o 
            WHERE o.station_id = '${stationId}' ${extraSQLCondition} AND o.date_time >= NOW() - INTERVAL '${duration} ${durationType}' AND o.deleted = FALSE 
            ORDER BY o.element_id, o.date_time;
            `);


        // Return the path to the generated CSV file
        return results;
    }

    public async findDataAvailabilitySummary(filter: DataAvailabilitySummaryQueryDto): Promise<{ stationId: string; recordCount: number; dateValue: number }[]> {
        let sqlExtract: string;
        let sqlCondition: string;

        if (DateUtils.isMoreThanMaxCalendarYears(new Date(filter.fromDate), new Date(filter.toDate), 31)) {
            throw new BadRequestException('Date range exceeds 30 years');
        }

        sqlCondition = `deleted = FALSE AND date_time BETWEEN '${filter.fromDate}' AND '${filter.toDate}'`;

        if (filter.stationIds && filter.stationIds.length > 0) {
            sqlCondition = `${sqlCondition} AND station_id IN (${filter.stationIds.map(id => `'${id}'`).join(',')})`;
        }

        if (filter.elementIds && filter.elementIds.length > 0) {
            sqlCondition = `${sqlCondition} AND element_id IN (${filter.elementIds.join(',')})`;
        }

        if (filter.level !== undefined) {
            sqlCondition = `${sqlCondition} AND level = ${filter.level}`;
        }

        if (filter.interval) {
            sqlCondition = `${sqlCondition} AND interval = ${filter.interval}`;
        }

        if (filter.excludeConfirmedMissing) {
            sqlCondition = `${sqlCondition} AND value IS NOT NULL`;
        }

        // TODO. this setting should be retrived from the cache
        const utcOffset: number = ((await this.generalSettingsService.findOne(SettingIdEnum.DISPLAY_TIME_ZONE)).parameters as ClimsoftDisplayTimeZoneDto).utcOffset
        const strTimeZone: string = `'UTC+${utcOffset}'`;

        switch (filter.durationType) {
            case DurationTypeEnum.DAY:
                sqlExtract = `EXTRACT(HOUR FROM (date_time AT TIME ZONE 'UTC' AT TIME ZONE ${strTimeZone})) AS extracted_date_value`;
                break;
            case DurationTypeEnum.MONTH:
                sqlExtract = `EXTRACT(DAY FROM (date_time AT TIME ZONE 'UTC' AT TIME ZONE ${strTimeZone})) AS extracted_date_value`;
                break;
            case DurationTypeEnum.YEAR:
                sqlExtract = `EXTRACT(MONTH FROM (date_time AT TIME ZONE 'UTC' AT TIME ZONE ${strTimeZone})) AS extracted_date_value`;
                break;
            case DurationTypeEnum.YEARS:
                sqlExtract = `EXTRACT(YEAR FROM (date_time AT TIME ZONE 'UTC' AT TIME ZONE ${strTimeZone})) AS extracted_date_value`;
                break;
            default:
                throw new BadRequestException('Duration type not supported');
        }

        // TODO. Change this to use a postgres function and use parameterised values
        const sql = `
            SELECT station_id, COUNT(element_id) AS record_count, ${sqlExtract} FROM observations 
            WHERE ${sqlCondition} 
            GROUP BY station_id, extracted_date_value ORDER BY station_id, extracted_date_value;
            `

        //console.log('Availability summary SQL :', sql)

        const rows = await this.dataSource.manager.query(sql);

        //console.log('results: ', results)

        return rows.map((r: any) => {
            return {
                stationId: r.station_id,
                recordCount: Number(r.record_count),
                dateValue: Number(r.extracted_date_value)
            };
        });
    }

    public async findDataAvailabilityDetails(filter: DataAvailabilityDetailsQueryDto): Promise<DataAvailaibilityDetailsDto[]> {
        if (DateUtils.isMoreThanMaxCalendarYears(new Date(filter.fromDate), new Date(filter.toDate), 31)) {
            throw new BadRequestException('Date range exceeds 30 years');
        }

        // Build param array in the exact order of the function signature
        const params = [
            filter.stationIds?.length ? filter.stationIds : null,     // p_station_ids varchar[]
            filter.elementIds?.length ? filter.elementIds : null,     // p_element_ids int[]
            filter.level ?? null,                                     // p_level int
            filter.interval ?? null,                                  // p_interval int
            filter.fromDate ?? null,                                  // p_from_date timestamptz
            filter.toDate ?? null                                     // p_to_date timestamptz
        ];

        const sql = `SELECT * FROM func_data_availaibility_details($1, $2, $3, $4, $5, $6)`;

        const rows = await this.dataSource.query(sql, params);

        return rows.map((r: any) => ({
            stationId: r.station_id,
            elementId: r.element_id,
            level: r.level,
            interval: r.interval,
            fromDate: r.from_date,
            toDate: r.to_date,
            expected: Number(r.expected),
            nonMissing: Number(r.non_missing),
            confirmedMissing: Number(r.confirmed_missing),
            gaps: Number(r.gaps),
            gapsPlusMissing: Number(r.gaps_plus_missing),
            qcNones: Number(r.qc_nones),
            qcPasses: Number(r.qc_passes),
            qcFails: Number(r.qc_fails),
        }));
    }

    public async findDataFlow(filter: DataFlowQueryDto): Promise<ViewObservationDto[]> {
        // Important. limit the date selection to 10 years for perfomance reasons
        //TODO. Later find a way of doing this at the DTO level
        if (DateUtils.isMoreThanMaxCalendarYears(new Date(filter.fromDate), new Date(filter.toDate), 11)) {
            throw new BadRequestException('Date range exceeds 10 years');
        }

        // TODO merge this with find processed observations method
        const obsEntities = await this.observationRepo.findBy({
            stationId: filter.stationIds.length === 1 ? filter.stationIds[0] : In(filter.stationIds),
            elementId: filter.elementId,
            level: filter.level,
            interval: filter.interval,
            datetime: Between(new Date(filter.fromDate), new Date(filter.toDate)),
            deleted: false,
        });

        return this.createViewObsDtos(obsEntities);
    }

}
