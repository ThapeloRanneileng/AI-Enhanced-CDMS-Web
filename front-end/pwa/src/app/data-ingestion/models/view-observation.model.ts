import { CreateObservationModel } from "./create-observation.model";
import { QCStatusEnum } from "./qc-status.enum";
import { ViewObservationLogModel } from "./view-observation-log.model";

export interface ViewObservationModel extends CreateObservationModel {
    qcStatus: QCStatusEnum;
    qcTestLog: {
        qcTestId: number;
        qcStatus: QCStatusEnum;
    }[] | null;
    log: ViewObservationLogModel[];
    entryDatetime: string;
    sourceName?: string;
    sourceType?: 'form' | 'import' | null;
    observationOrigin?: 'mobile_form' | 'manual_hourly_form' | 'manual_daily_form' | 'manual_monthly_form' | 'manual_form' | 'manual_csv_import' | 'aws_ingestion' | 'import';
}

export interface ViewQCTestLog {
    id: number;
    name: string,
    qcStatus: QCStatusEnum
}
