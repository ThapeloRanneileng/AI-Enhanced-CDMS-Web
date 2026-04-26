import 'reflect-metadata';
import { SourceTypeEnum } from 'src/metadata/source-specifications/enums/source-type.enum';
import { ViewSourceSpecificationDto } from 'src/metadata/source-specifications/dtos/view-source-specification.dto';
import { getObservationOriginLabel } from './observation-source-label.util';
import { DataStructureTypeEnum } from 'src/metadata/source-specifications/dtos/import-source.dto';
import { LayoutType, SelectorFieldControlType } from 'src/metadata/source-specifications/dtos/form-source.dto';

function formSource(interval: number): ViewSourceSpecificationDto {
    return {
        id: interval,
        name: `${interval} form`,
        description: '',
        sourceType: SourceTypeEnum.FORM,
        utcOffset: 0,
        allowMissingValue: false,
        scaleValues: false,
        sampleFileName: '',
        disabled: false,
        comment: '',
        parameters: {
            selectors: [SelectorFieldControlType.ELEMENT],
            fields: [SelectorFieldControlType.HOUR],
            layout: LayoutType.GRID,
            elementIds: [1],
            hours: [0],
            interval,
        },
    };
}

function importSource(name: string, description = ''): ViewSourceSpecificationDto {
    return {
        id: 99,
        name,
        description,
        sourceType: SourceTypeEnum.IMPORT,
        utcOffset: 0,
        allowMissingValue: false,
        scaleValues: false,
        sampleFileName: '',
        disabled: false,
        comment: '',
        parameters: {
            dataStructureType: DataStructureTypeEnum.TABULAR,
            dataStructureParameters: {} as any,
            sourceMissingValueIndicators: '',
        },
    };
}

describe('getObservationOriginLabel', () => {
    it('labels standard manual form cadences', () => {
        expect(getObservationOriginLabel(formSource(60))).toBe('manual_hourly_form');
        expect(getObservationOriginLabel(formSource(1440))).toBe('manual_daily_form');
        expect(getObservationOriginLabel(formSource(44640))).toBe('manual_monthly_form');
    });

    it('labels mobile form sources explicitly', () => {
        const source = formSource(1440);
        source.name = 'Mobile daily observation form';

        expect(getObservationOriginLabel(source)).toBe('mobile_form');
    });

    it('labels import sources by source metadata text', () => {
        expect(getObservationOriginLabel(importSource('AWS ingestion'))).toBe('aws_ingestion');
        expect(getObservationOriginLabel(importSource('Manual CSV Import'))).toBe('manual_csv_import');
        expect(getObservationOriginLabel(importSource('Legacy file'))).toBe('import');
    });
});
