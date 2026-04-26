import { Injectable, Logger } from '@nestjs/common';
import * as path from 'node:path';
import { FileIOService } from 'src/shared/services/file-io.service';
import { resolveRuntimeAssetPath } from 'src/shared/utils/runtime-asset-path.util';
import { DataSource } from 'typeorm';

@Injectable()
export class SqlScriptsLoaderService {
    private readonly logger = new Logger(SqlScriptsLoaderService.name);

    constructor(
        private dataSource: DataSource,
        private fileIOService: FileIOService,) { }



    /**
     * Used by the migrations service
     */
    public async addEntryDatetimeTriggerToDB() {
        try {
            const entryDatetimeScriptsDirPath = resolveRuntimeAssetPath(__dirname, 'default-triggers', 'default-entry-date-time.sql');
            const sql: string = await this.fileIOService.readFile(entryDatetimeScriptsDirPath, 'utf8');
            //console.log('ENTRY DATE TIME SQL:', sql);
            await this.dataSource.query(sql);
            this.logger.log('default entry date time triggers added');
        } catch (error) {
            this.logger.error(`Developer error in adding entry date time triggers`);
            throw new Error(error);
        }
    }

    /**
     * Used by the migrations service
     */
    public async addLogsTriggersToDB() {
        try {
            const logScriptsDirPath = path.dirname(resolveRuntimeAssetPath(__dirname, 'logging-triggers', 'station-log.sql'));
            const fileNames: string[] = await this.fileIOService.getFileNamesInDirectory(logScriptsDirPath);

            let sql: string = ''
            for (const fileName of fileNames) {
                sql = sql + await this.fileIOService.readFile(`${logScriptsDirPath}/${fileName}`, 'utf8') + '\n\n';
            }

            //console.log('LOG SQL:', sql);
            await this.dataSource.query(sql);
            this.logger.log('Logging triggers added');
        } catch (error) {
            this.logger.error(`Developer error in adding logs triggers: ${error}`);
            throw new Error(error);
        }
    }

    /**
     * Used by the migrations service
     */
    public async addQCTestsFunctionsToDB() {
        try {
            const entryDatetimeScriptsDirPath = resolveRuntimeAssetPath(__dirname, 'qc-tests', 'qc-tests-functions.sql');
            const sql: string = await this.fileIOService.readFile(entryDatetimeScriptsDirPath, 'utf8');
            //console.log('ENTRY DATE TIME SQL:', sql);
            await this.dataSource.query(sql);
            this.logger.log('qc tests functions added');
        } catch (error) {
            this.logger.error(`Developer error in adding qc tests functions`);
            throw new Error(error);
        }
    }

     /**
     * Used by the migrations service
     */
    public async addDataAvailabilityFunctionsToDB() {
        try {
            const entryDatetimeScriptsDirPath = resolveRuntimeAssetPath(__dirname, 'data-availability', 'data-availiability-details-function.sql');
            const sql: string = await this.fileIOService.readFile(entryDatetimeScriptsDirPath, 'utf8');
            //console.log('ENTRY DATE TIME SQL:', sql);
            await this.dataSource.query(sql);
            this.logger.log('data availability functions added');
        } catch (error) {
            this.logger.error(`Developer error in adding data availability functions`);
            throw new Error(error);
        }
    }

}
