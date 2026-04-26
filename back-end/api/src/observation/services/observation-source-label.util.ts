import { SourceTypeEnum } from 'src/metadata/source-specifications/enums/source-type.enum';
import { ViewSourceSpecificationDto } from 'src/metadata/source-specifications/dtos/view-source-specification.dto';
import { FormSourceDTO } from 'src/metadata/source-specifications/dtos/form-source.dto';

export type ObservationOriginLabel =
    | 'mobile_form'
    | 'manual_hourly_form'
    | 'manual_daily_form'
    | 'manual_monthly_form'
    | 'manual_form'
    | 'manual_csv_import'
    | 'aws_ingestion'
    | 'import';

export function getObservationOriginLabel(source?: ViewSourceSpecificationDto): ObservationOriginLabel {
    if (!source) return 'import';

    const sourceText = `${source.name} ${source.description} ${source.comment}`.toLowerCase();

    if (source.sourceType === SourceTypeEnum.FORM) {
        if (sourceText.includes('mobile')) return 'mobile_form';

        const interval = (source.parameters as FormSourceDTO).interval;
        if (interval === 60) return 'manual_hourly_form';
        if (interval === 1440) return 'manual_daily_form';
        if (interval === 44640) return 'manual_monthly_form';
        return 'manual_form';
    }

    if (sourceText.includes('aws')) return 'aws_ingestion';
    if (sourceText.includes('csv') || sourceText.includes('manual')) return 'manual_csv_import';

    return 'import';
}
