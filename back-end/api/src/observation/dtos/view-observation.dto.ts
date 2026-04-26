
import { QCTestLogVo } from "../entities/observation.entity";
import { QCStatusEnum } from "../enums/qc-status.enum";
import { CreateObservationDto } from "./create-observation.dto";
import { ViewObservationLogDto } from "./view-observation-log.dto"; 
import { SourceTypeEnum } from "src/metadata/source-specifications/enums/source-type.enum";
import { ObservationOriginLabel } from "../services/observation-source-label.util";

export class ViewObservationDto extends CreateObservationDto {
    qcStatus: QCStatusEnum;
    qcTestLog: QCTestLogVo[] | null;
    log: ViewObservationLogDto[];
    entryDatetime: string;
    sourceName: string;
    sourceType: SourceTypeEnum | null;
    observationOrigin: ObservationOriginLabel;
}
