import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { AppConfigService } from 'src/app/app-config.service';
import { PagesDataService, ToastEventTypeEnum } from 'src/app/core/services/pages-data.service';
import { StationsCacheService } from 'src/app/metadata/stations/services/stations-cache.service';
import { LocalStorageService } from 'src/app/shared/services/local-storage.service';
import {
  AwsImportRowModel,
  AwsImportSpecModel,
  ObservationDataImportResultModel,
  ObservationDataImportRowModel,
  StationMetadataImportResultModel,
  StationMetadataImportRowModel,
} from './manual-station-import.model';

type ManualImportOption = 'station-metadata' | 'observation-data' | 'aws-import';
type StationField = keyof StationMetadataImportRowModel;
type ObservationField = keyof ObservationDataImportRowModel;
type AwsField = keyof AwsImportRowModel;

interface PreviewRow {
  rowNumber: number;
  values: Record<string, string>;
}

interface StationFieldOption {
  id: StationField;
  label: string;
  required?: boolean;
}

interface ObservationFieldOption {
  id: ObservationField;
  label: string;
  required?: boolean;
}

interface AwsFieldOption {
  id: AwsField;
  label: string;
  required?: boolean;
}

interface SavedAwsSpecOption {
  key: string;
  label: string;
}

const AWS_IMPORT_SPECS_STORAGE_KEY = '_aws_import_specs';

@Component({
  selector: 'app-import-selection',
  templateUrl: './import-selection.component.html',
  styleUrls: ['./import-selection.component.scss']
})
export class ImportSelectionComponent {
  protected selectedOption: ManualImportOption | null = null;
  protected readonly importOptions = [
    {
      id: 'station-metadata' as ManualImportOption,
      name: 'Station Metadata Import',
      description: 'Import station ids, names, locations, external ids, and comments from a CSV file.',
    },
    {
      id: 'observation-data' as ManualImportOption,
      name: 'Observation Data Import',
      description: 'Import raw observation values for existing stations and elements.',
    },
    {
      id: 'aws-import' as ManualImportOption,
      name: 'AWS Import',
      description: 'Import AWS observation files, map incoming columns, and load records into the shared observation pipeline.',
    },
  ];

  protected readonly stationFields: StationFieldOption[] = [
    { id: 'id', label: 'Station ID', required: true },
    { id: 'name', label: 'Station Name', required: true },
    { id: 'description', label: 'Description' },
    { id: 'latitude', label: 'Latitude' },
    { id: 'longitude', label: 'Longitude' },
    { id: 'elevation', label: 'Elevation' },
    { id: 'wmoId', label: 'WMO ID' },
    { id: 'wigosId', label: 'WIGOS ID' },
    { id: 'icaoId', label: 'ICAO ID' },
    { id: 'comment', label: 'Comment' },
  ];

  protected readonly observationFields: ObservationFieldOption[] = [
    { id: 'stationId', label: 'Station ID', required: true },
    { id: 'element', label: 'Element', required: true },
    { id: 'observationDatetime', label: 'Observation Datetime', required: true },
    { id: 'value', label: 'Value', required: true },
    { id: 'level', label: 'Level' },
    { id: 'interval', label: 'Interval' },
    { id: 'source', label: 'Source' },
    { id: 'comment', label: 'Comment' },
  ];

  protected readonly awsFields: AwsFieldOption[] = [
    { id: 'stationId', label: 'Station ID', required: true },
    { id: 'element', label: 'Element', required: true },
    { id: 'observationDatetime', label: 'Observation Datetime', required: true },
    { id: 'value', label: 'Value', required: true },
    { id: 'level', label: 'Level' },
    { id: 'interval', label: 'Interval' },
    { id: 'source', label: 'Source' },
    { id: 'comment', label: 'Comment' },
    { id: 'recordId', label: 'Record ID' },
  ];

  protected stationDelimiter = ',';
  protected stationFileName = '';
  protected stationHeaders: string[] = [];
  protected stationPreviewRows: PreviewRow[] = [];
  protected stationParsedRows: Record<string, string>[] = [];
  protected stationColumnMapping: Partial<Record<StationField, string>> = {};
  protected stationParseError = '';
  protected stationImportError = '';
  protected stationImporting = false;
  protected stationResult: StationMetadataImportResultModel | null = null;

  protected observationDelimiter = ',';
  protected observationFileName = '';
  protected observationHeaders: string[] = [];
  protected observationPreviewRows: PreviewRow[] = [];
  protected observationParsedRows: Record<string, string>[] = [];
  protected observationColumnMapping: Partial<Record<ObservationField, string>> = {};
  protected observationParseError = '';
  protected observationImportError = '';
  protected observationImporting = false;
  protected observationResult: ObservationDataImportResultModel | null = null;

  protected awsDelimiter = ',';
  protected awsCustomDelimiter = '|';
  protected awsStartRow = 1;
  protected awsFileName = '';
  protected awsHeaders: string[] = [];
  protected awsPreviewRows: PreviewRow[] = [];
  protected awsParsedRows: Record<string, string>[] = [];
  protected awsColumnMapping: Partial<Record<AwsField, string>> = {};
  protected awsParseError = '';
  protected awsImportError = '';
  protected awsImporting = false;
  protected awsResult: ObservationDataImportResultModel | null = null;
  protected awsStationId: string | null = null;
  protected awsMissingDataFlag = '-9999';
  protected awsMappingSpecName = '';
  protected savedAwsSpecs: SavedAwsSpecOption[] = [];
  protected selectedAwsSpecKey = '';

  private readonly stationImportUrl: string;
  private readonly observationImportUrl: string;
  private selectedStationFileText = '';
  private selectedObservationFileText = '';
  private selectedAwsFileText = '';

  constructor(
    private pagesDataService: PagesDataService,
    private appConfigService: AppConfigService,
    private http: HttpClient,
    private stationsCacheService: StationsCacheService,
    private localStorageService: LocalStorageService,
  ) {
    this.pagesDataService.setPageHeader('Manual Import');
    this.stationImportUrl = `${this.appConfigService.apiBaseUrl}/stations/manual-import`;
    this.observationImportUrl = `${this.appConfigService.apiBaseUrl}/observations/manual-import`;
    this.refreshSavedAwsSpecs();
  }

  protected selectOption(option: ManualImportOption): void {
    this.selectedOption = option;
    this.stationResult = null;
    this.stationImportError = '';
    this.observationResult = null;
    this.observationImportError = '';
    this.awsResult = null;
    this.awsImportError = '';
  }

  protected async onStationFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.stationFileName = file.name;
    this.stationResult = null;
    this.stationImportError = '';
    this.stationParseError = '';

    try {
      const text = await file.text();
      this.selectedStationFileText = text;
      this.parseStationCsvText(text);
    } catch (error) {
      this.clearStationParsedData();
      this.stationParseError = error instanceof Error ? error.message : 'Could not read the selected file.';
    }
  }

  protected onStationDelimiterChange(): void {
    if (!this.selectedStationFileText) return;
    this.stationResult = null;
    this.stationImportError = '';
    this.stationParseError = '';
    this.parseStationCsvText(this.selectedStationFileText);
  }

  protected setStationMapping(field: StationField, column: string): void {
    this.stationColumnMapping = {
      ...this.stationColumnMapping,
      [field]: column || undefined,
    };
    this.stationResult = null;
    this.stationImportError = '';
  }

  protected canImportStations(): boolean {
    return !!this.stationColumnMapping.id && !!this.stationColumnMapping.name && this.stationParsedRows.length > 0 && !this.stationImporting;
  }

  protected importStations(): void {
    if (!this.canImportStations()) return;

    const rows = this.stationParsedRows.map((row) => this.mapStationRow(row));
    this.stationImporting = true;
    this.stationResult = null;
    this.stationImportError = '';

    this.http.post<StationMetadataImportResultModel>(this.stationImportUrl, { rows }).subscribe({
      next: (result) => {
        this.stationResult = result;
        this.stationImporting = false;
        this.stationsCacheService.checkForUpdates();
      },
      error: (error) => {
        this.stationImporting = false;
        this.stationImportError = error?.error?.message || 'Station metadata import failed.';
      },
    });
  }

  protected async onObservationFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.observationFileName = file.name;
    this.observationResult = null;
    this.observationImportError = '';
    this.observationParseError = '';

    try {
      const text = await file.text();
      this.selectedObservationFileText = text;
      this.parseObservationCsvText(text);
    } catch (error) {
      this.clearObservationParsedData();
      this.observationParseError = error instanceof Error ? error.message : 'Could not read the selected file.';
    }
  }

  protected onObservationDelimiterChange(): void {
    if (!this.selectedObservationFileText) return;
    this.observationResult = null;
    this.observationImportError = '';
    this.observationParseError = '';
    this.parseObservationCsvText(this.selectedObservationFileText);
  }

  protected setObservationMapping(field: ObservationField, column: string): void {
    this.observationColumnMapping = {
      ...this.observationColumnMapping,
      [field]: column || undefined,
    };
    this.observationResult = null;
    this.observationImportError = '';
  }

  protected canImportObservations(): boolean {
    return !!this.observationColumnMapping.stationId
      && !!this.observationColumnMapping.element
      && !!this.observationColumnMapping.observationDatetime
      && !!this.observationColumnMapping.value
      && this.observationParsedRows.length > 0
      && !this.observationImporting;
  }

  protected importObservations(): void {
    if (!this.canImportObservations()) return;

    const rows = this.observationParsedRows.map((row) => this.mapObservationRow(row));
    this.observationImporting = true;
    this.observationResult = null;
    this.observationImportError = '';

    this.http.post<ObservationDataImportResultModel>(this.observationImportUrl, { rows }).subscribe({
      next: (result) => {
        this.observationResult = result;
        this.observationImporting = false;
      },
      error: (error) => {
        this.observationImporting = false;
        this.observationImportError = error?.error?.message || 'Observation data import failed.';
      },
    });
  }

  protected async onAwsFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.awsFileName = file.name;
    this.awsResult = null;
    this.awsImportError = '';
    this.awsParseError = '';

    try {
      const text = await file.text();
      this.selectedAwsFileText = text;
      this.parseAwsText(text);
    } catch (error) {
      this.clearAwsParsedData();
      this.awsParseError = error instanceof Error ? error.message : 'Could not read the selected AWS file.';
    }
  }

  protected onAwsDelimiterChange(): void {
    if (!this.selectedAwsFileText) return;
    this.awsResult = null;
    this.awsImportError = '';
    this.awsParseError = '';
    this.parseAwsText(this.selectedAwsFileText);
  }

  protected setAwsMapping(field: AwsField, column: string): void {
    this.awsColumnMapping = {
      ...this.awsColumnMapping,
      [field]: column || undefined,
    };
    this.awsResult = null;
    this.awsImportError = '';
  }

  protected canImportAws(): boolean {
    return !!this.awsColumnMapping.element
      && !!this.awsColumnMapping.observationDatetime
      && !!this.awsColumnMapping.value
      && (!!this.awsColumnMapping.stationId || !!this.awsStationId)
      && this.awsParsedRows.length > 0
      && !this.awsImporting;
  }

  protected importAwsObservations(): void {
    if (!this.canImportAws()) return;

    const rows = this.awsParsedRows.map((row) => this.mapAwsRow(row));
    this.awsImporting = true;
    this.awsResult = null;
    this.awsImportError = '';

    this.http.post<ObservationDataImportResultModel>(this.observationImportUrl, { rows }).subscribe({
      next: (result) => {
        this.awsResult = result;
        this.awsImporting = false;
        this.pagesDataService.showToast({
          title: 'AWS Import',
          message: `Imported ${result.importedRows} AWS observation row(s) into the shared observation pipeline.`,
          type: ToastEventTypeEnum.SUCCESS,
        });
      },
      error: (error) => {
        this.awsImporting = false;
        this.awsImportError = error?.error?.message || 'AWS observation import failed.';
      },
    });
  }

  protected saveAwsSpec(): void {
    const specName = this.awsMappingSpecName.trim();
    if (!specName) {
      this.pagesDataService.showToast({
        title: 'AWS Import',
        message: 'Specification name is required before saving header specs.',
        type: ToastEventTypeEnum.ERROR,
      });
      return;
    }

    const specs = this.getSavedAwsSpecs();
    const now = new Date().toISOString();
    const specKey = this.buildAwsSpecKey(specName);
    const existing = specs[specKey];
    specs[specKey] = {
      name: specName,
      delimiter: this.awsDelimiter,
      customDelimiter: this.awsCustomDelimiter,
      startRow: this.awsStartRow,
      stationId: this.awsStationId,
      missingDataFlag: this.awsMissingDataFlag,
      columnMapping: this.awsColumnMapping,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.localStorageService.setItem<Record<string, AwsImportSpecModel>>(AWS_IMPORT_SPECS_STORAGE_KEY, specs);
    this.selectedAwsSpecKey = specKey;
    this.refreshSavedAwsSpecs();
    this.pagesDataService.showToast({
      title: 'AWS Import',
      message: `Saved AWS header specification "${specName}".`,
      type: ToastEventTypeEnum.SUCCESS,
    });
  }

  protected loadAwsSpec(): void {
    if (!this.selectedAwsSpecKey) {
      this.pagesDataService.showToast({
        title: 'AWS Import',
        message: 'Select a saved AWS header specification first.',
        type: ToastEventTypeEnum.ERROR,
      });
      return;
    }

    const spec = this.getSavedAwsSpecs()[this.selectedAwsSpecKey];
    if (!spec) {
      this.pagesDataService.showToast({
        title: 'AWS Import',
        message: 'The selected AWS header specification could not be found.',
        type: ToastEventTypeEnum.ERROR,
      });
      return;
    }

    this.awsMappingSpecName = spec.name;
    this.awsDelimiter = spec.delimiter;
    this.awsCustomDelimiter = spec.customDelimiter || this.awsCustomDelimiter;
    this.awsStartRow = spec.startRow;
    this.awsStationId = spec.stationId ?? null;
    this.awsMissingDataFlag = spec.missingDataFlag ?? this.awsMissingDataFlag;
    this.awsColumnMapping = { ...spec.columnMapping };

    if (this.selectedAwsFileText) {
      this.parseAwsText(this.selectedAwsFileText);
    }

    this.pagesDataService.showToast({
      title: 'AWS Import',
      message: `Loaded AWS header specification "${spec.name}".`,
      type: ToastEventTypeEnum.INFO,
    });
  }

  private parseStationCsvText(text: string): void {
    const rows = this.parseDelimitedRows(text, this.stationDelimiter);
    const nonEmptyRows = rows.filter((row) => row.some((value) => value.trim() !== ''));

    if (nonEmptyRows.length < 2) {
      this.clearStationParsedData();
      this.stationParseError = 'The file must include a header row and at least one station row.';
      return;
    }

    this.stationHeaders = nonEmptyRows[0].map((header) => header.trim()).filter((header) => header !== '');
    if (this.stationHeaders.length === 0) {
      this.clearStationParsedData();
      this.stationParseError = 'No CSV headers were found.';
      return;
    }

    this.stationParsedRows = nonEmptyRows.slice(1).map((row) => {
      const parsedRow: Record<string, string> = {};
      this.stationHeaders.forEach((header, index) => {
        parsedRow[header] = row[index]?.trim() || '';
      });
      return parsedRow;
    });

    this.stationPreviewRows = this.stationParsedRows.slice(0, 5).map((row, index) => ({
      rowNumber: index + 2,
      values: row,
    }));
    this.stationColumnMapping = this.guessStationColumnMapping(this.stationHeaders);
  }

  private parseObservationCsvText(text: string): void {
    const rows = this.parseDelimitedRows(text, this.observationDelimiter);
    const nonEmptyRows = rows.filter((row) => row.some((value) => value.trim() !== ''));

    if (nonEmptyRows.length < 2) {
      this.clearObservationParsedData();
      this.observationParseError = 'The file must include a header row and at least one observation row.';
      return;
    }

    this.observationHeaders = nonEmptyRows[0].map((header) => header.trim()).filter((header) => header !== '');
    if (this.observationHeaders.length === 0) {
      this.clearObservationParsedData();
      this.observationParseError = 'No CSV headers were found.';
      return;
    }

    this.observationParsedRows = nonEmptyRows.slice(1).map((row) => {
      const parsedRow: Record<string, string> = {};
      this.observationHeaders.forEach((header, index) => {
        parsedRow[header] = row[index]?.trim() || '';
      });
      return parsedRow;
    });

    this.observationPreviewRows = this.observationParsedRows.slice(0, 5).map((row, index) => ({
      rowNumber: index + 2,
      values: row,
    }));
    this.observationColumnMapping = this.guessObservationColumnMapping(this.observationHeaders);
  }

  private parseAwsText(text: string): void {
    const delimiter = this.resolveAwsDelimiter();
    if (!delimiter) {
      this.clearAwsParsedData();
      this.awsParseError = 'Delimiter is required for AWS import.';
      return;
    }

    const rows = this.parseDelimitedRows(text, delimiter);
    const nonEmptyRows = rows.filter((row) => row.some((value) => value.trim() !== ''));
    const headerIndex = Math.max(this.awsStartRow - 1, 0);

    if (nonEmptyRows.length <= headerIndex) {
      this.clearAwsParsedData();
      this.awsParseError = 'Start row is beyond the available AWS file content.';
      return;
    }

    const headerRow = nonEmptyRows[headerIndex];
    this.awsHeaders = headerRow.map((header) => header.trim()).filter((header) => header !== '');
    if (this.awsHeaders.length === 0) {
      this.clearAwsParsedData();
      this.awsParseError = 'No AWS file headers were found at the selected start row.';
      return;
    }

    this.awsParsedRows = nonEmptyRows.slice(headerIndex + 1).map((row) => {
      const parsedRow: Record<string, string> = {};
      this.awsHeaders.forEach((header, index) => {
        parsedRow[header] = row[index]?.trim() || '';
      });
      return parsedRow;
    });

    this.awsPreviewRows = this.awsParsedRows.slice(0, 8).map((row, index) => ({
      rowNumber: index + headerIndex + 2,
      values: row,
    }));
    this.awsColumnMapping = Object.keys(this.awsColumnMapping).length > 0
      ? this.awsColumnMapping
      : this.guessAwsColumnMapping(this.awsHeaders);
  }

  private parseDelimitedRows(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const nextChar = text[index + 1];

      if (char === '"' && inQuotes && nextChar === '"') {
        value += '"';
        index++;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        row.push(value);
        value = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') index++;
        row.push(value);
        rows.push(row);
        row = [];
        value = '';
      } else {
        value += char;
      }
    }

    row.push(value);
    rows.push(row);
    return rows;
  }

  private guessStationColumnMapping(headers: string[]): Partial<Record<StationField, string>> {
    const normalizedHeaders = new Map(headers.map((header) => [this.normalizeHeader(header), header]));
    const guesses: Record<StationField, string[]> = {
      id: ['id', 'stationid', 'station_id', 'stationnumber', 'station_no'],
      name: ['name', 'stationname', 'station_name'],
      description: ['description', 'stationdescription', 'station_description'],
      latitude: ['latitude', 'lat'],
      longitude: ['longitude', 'lon', 'lng'],
      elevation: ['elevation', 'altitude'],
      wmoId: ['wmoid', 'wmo_id', 'wmo'],
      wigosId: ['wigosid', 'wigos_id', 'wigos'],
      icaoId: ['icaoid', 'icao_id', 'icao'],
      comment: ['comment', 'comments', 'remarks'],
    };

    const mapping: Partial<Record<StationField, string>> = {};
    for (const field of this.stationFields) {
      const match = guesses[field.id].map((guess) => normalizedHeaders.get(guess)).find(Boolean);
      if (match) mapping[field.id] = match;
    }
    return mapping;
  }

  private guessObservationColumnMapping(headers: string[]): Partial<Record<ObservationField, string>> {
    const normalizedHeaders = new Map(headers.map((header) => [this.normalizeHeader(header), header]));
    const guesses: Record<ObservationField, string[]> = {
      stationId: ['stationid', 'station_id', 'station', 'stationnumber', 'station_no'],
      element: ['element', 'elementid', 'element_id', 'elementcode', 'element_code', 'abbreviation'],
      observationDatetime: ['observationdatetime', 'observation_datetime', 'datetime', 'date_time', 'timestamp', 'date'],
      value: ['value', 'obsvalue', 'obs_value', 'observation', 'measurement'],
      level: ['level'],
      interval: ['interval', 'period'],
      source: ['source', 'sourceid', 'source_id'],
      comment: ['comment', 'comments', 'remarks'],
    };

    const mapping: Partial<Record<ObservationField, string>> = {};
    for (const field of this.observationFields) {
      const match = guesses[field.id].map((guess) => normalizedHeaders.get(guess)).find(Boolean);
      if (match) mapping[field.id] = match;
    }
    return mapping;
  }

  private guessAwsColumnMapping(headers: string[]): Partial<Record<AwsField, string>> {
    const normalizedHeaders = new Map(headers.map((header) => [this.normalizeHeader(header), header]));
    const guesses: Record<AwsField, string[]> = {
      stationId: ['stationid', 'station_id', 'station', 'siteid', 'site_id'],
      element: ['element', 'elementcode', 'element_code', 'parameter', 'sensor'],
      observationDatetime: ['datetime', 'timestamp', 'observationdatetime', 'observation_datetime', 'date_time'],
      value: ['value', 'observation', 'measurement', 'reading'],
      level: ['level', 'sensorlevel'],
      interval: ['interval', 'period', 'timeinterval'],
      source: ['source', 'stationtype', 'feedsource'],
      comment: ['comment', 'comments', 'remarks'],
      recordId: ['recordid', 'record_id', 'messageid', 'message_id'],
    };

    const mapping: Partial<Record<AwsField, string>> = {};
    for (const field of this.awsFields) {
      const match = guesses[field.id].map((guess) => normalizedHeaders.get(guess)).find(Boolean);
      if (match) mapping[field.id] = match;
    }
    return mapping;
  }

  private normalizeHeader(header: string): string {
    return header.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
  }

  private mapStationRow(row: Record<string, string>): StationMetadataImportRowModel {
    const mappedRow: StationMetadataImportRowModel = {};
    for (const field of this.stationFields) {
      const column = this.stationColumnMapping[field.id];
      if (column) mappedRow[field.id] = row[column] ?? '';
    }
    return mappedRow;
  }

  private mapObservationRow(row: Record<string, string>): ObservationDataImportRowModel {
    const mappedRow: ObservationDataImportRowModel = {};
    for (const field of this.observationFields) {
      const column = this.observationColumnMapping[field.id];
      if (column) mappedRow[field.id] = row[column] ?? '';
    }
    return mappedRow;
  }

  private mapAwsRow(row: Record<string, string>): ObservationDataImportRowModel {
    const mappedRow: AwsImportRowModel = {};
    for (const field of this.awsFields) {
      const column = this.awsColumnMapping[field.id];
      if (!column) continue;
      let value = row[column] ?? '';
      if (this.awsMissingDataFlag && value === this.awsMissingDataFlag) {
        value = '';
      }
      mappedRow[field.id] = value;
    }

    if (!mappedRow.stationId && this.awsStationId) {
      mappedRow.stationId = this.awsStationId;
    }

    // Do not send a fake source label here; non-empty values are resolved as real source specifications by the backend.

    return mappedRow;
  }

  private clearStationParsedData(): void {
    this.stationHeaders = [];
    this.stationPreviewRows = [];
    this.stationParsedRows = [];
    this.stationColumnMapping = {};
  }

  private clearObservationParsedData(): void {
    this.observationHeaders = [];
    this.observationPreviewRows = [];
    this.observationParsedRows = [];
    this.observationColumnMapping = {};
  }

  private clearAwsParsedData(): void {
    this.awsHeaders = [];
    this.awsPreviewRows = [];
    this.awsParsedRows = [];
    this.awsColumnMapping = {};
  }

  private resolveAwsDelimiter(): string {
    return this.awsDelimiter === '__other__' ? this.awsCustomDelimiter : this.awsDelimiter;
  }

  private getSavedAwsSpecs(): Record<string, AwsImportSpecModel> {
    return this.localStorageService.getItem<Record<string, AwsImportSpecModel>>(AWS_IMPORT_SPECS_STORAGE_KEY) ?? {};
  }

  private refreshSavedAwsSpecs(): void {
    this.savedAwsSpecs = Object.entries(this.getSavedAwsSpecs())
      .map(([key, spec]) => ({
        key,
        label: `${spec.name} • ${new Date(spec.updatedAt).toLocaleDateString()}`,
      }))
      .sort((left, right) => right.label.localeCompare(left.label));
  }

  private buildAwsSpecKey(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }
}
