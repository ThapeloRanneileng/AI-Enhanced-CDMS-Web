export interface StationMetadataImportRowModel {
  id?: string;
  name?: string;
  description?: string;
  latitude?: string | number;
  longitude?: string | number;
  elevation?: string | number;
  wmoId?: string;
  wigosId?: string;
  icaoId?: string;
  comment?: string;
}

export interface StationMetadataRejectedRowModel {
  rowNumber: number;
  stationId?: string;
  reasons: string[];
  row: StationMetadataImportRowModel;
}

export interface StationMetadataImportResultModel {
  totalRows: number;
  importedRows: number;
  rejectedRows: StationMetadataRejectedRowModel[];
}

export interface ObservationDataImportRowModel {
  stationId?: string;
  element?: string;
  observationDatetime?: string;
  value?: string | number;
  level?: string | number;
  interval?: string | number;
  source?: string;
  comment?: string;
}

export interface ObservationDataRejectedRowModel {
  rowNumber: number;
  stationId?: string;
  element?: string;
  reasons: string[];
  row: ObservationDataImportRowModel;
}

export interface ObservationDataImportResultModel {
  totalRows: number;
  importedRows: number;
  rejectedRows: ObservationDataRejectedRowModel[];
}

export interface AwsImportRowModel extends ObservationDataImportRowModel {
  recordId?: string;
}

export interface AwsImportSpecModel {
  name: string;
  delimiter: string;
  customDelimiter?: string;
  startRow: number;
  stationId?: string | null;
  missingDataFlag?: string;
  columnMapping: Partial<Record<keyof AwsImportRowModel, string>>;
  createdAt: string;
  updatedAt: string;
}
