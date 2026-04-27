import { Component, OnDestroy, OnInit } from '@angular/core';
import { ViewObservationQueryModel } from 'src/app/data-ingestion/models/view-observation-query.model';
import { PagesDataService, ToastEventTypeEnum } from 'src/app/core/services/pages-data.service';
import { Subject, take, takeUntil } from 'rxjs';
import { IntervalsUtil } from 'src/app/shared/controls/interval-selector/Intervals.util';
import { NumberUtils } from 'src/app/shared/utils/number.utils';
import { PagingParameters } from 'src/app/shared/controls/page-input/paging-parameters';
import { DateUtils } from 'src/app/shared/utils/date.utils';
import { ObservationsService } from 'src/app/data-ingestion/services/observations.service';
import { ActivatedRoute } from '@angular/router';
import { CachedMetadataService } from 'src/app/metadata/metadata-updates/cached-metadata.service';
import { ObservationEntry } from 'src/app/observations/models/observation-entry.model';
import { ViewObservationModel } from 'src/app/data-ingestion/models/view-observation.model';
import { QCStatusEnum } from 'src/app/data-ingestion/models/qc-status.enum';
import { LmsAiService } from 'src/app/quality-control/services/lms-ai.service';


@Component({
  selector: 'app-data-explorer',
  templateUrl: './data-explorer.component.html',
  styleUrls: ['./data-explorer.component.scss']
})
export class DataExplorerComponent implements OnInit, OnDestroy {
  protected observationsEntries!: ObservationEntry[];
  protected queryFilter!: ViewObservationQueryModel;
  protected pageInputDefinition: PagingParameters = new PagingParameters();
  protected enableQueryButton: boolean = true;
  protected numOfChanges: number = 0;
  protected allBoundariesIndices: number[] = [];
  protected hasQueried: boolean = false;
  protected isLoading: boolean = false;
  protected activeMode: 'observations' | 'lms-ai' = 'observations';
  protected lmsRows: Record<string, string>[] = [];
  protected lmsTotal = 0;
  protected lmsQuery = {
    stationId: '',
    stationName: '',
    elementCode: '',
    elementName: '',
    dateFrom: '',
    dateTo: '',
    outcome: '',
    finalDecision: '',
    severity: '',
    modelName: '',
    reviewSource: '',
    limit: 100,
    offset: 0,
  };
  protected lmsLoading = false;
  protected lmsErrorMessage = '';
  private utcOffset!: number;
  private allMetadataLoaded: boolean = false;

  private destroy$ = new Subject<void>();

  constructor(
    private pagesDataService: PagesDataService,
    private observationService: ObservationsService,
    private lmsAiService: LmsAiService,
    private cachedMetadataSearchService: CachedMetadataService,
    private route: ActivatedRoute,
  ) {

    this.pagesDataService.setPageHeader('Data Explorer');

    this.cachedMetadataSearchService.allMetadataLoaded.pipe(
      takeUntil(this.destroy$),
    ).subscribe(allMetadataLoaded => {
      if (!allMetadataLoaded) return;
      this.utcOffset = this.cachedMetadataSearchService.utcOffSet;
      this.allMetadataLoaded = allMetadataLoaded;
      this.queryData();
    });


  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      if (params.keys.length === 0) return;

      const stationIds: string[] = params.getAll('stationIds');
      const elementIds: string[] = params.getAll('elementIds');
      const sourceIds: string[] = params.getAll('sourceIds');
      const intervals: string[] = params.getAll('intervals');
      const level: string | null = params.get('level');
      const fromDate: string | null = params.get('fromDate');
      const toDate: string | null = params.get('toDate');

      this.queryFilter = { deleted: false };
      if (stationIds.length > 0) this.queryFilter.stationIds = stationIds;
      if (elementIds.length > 0) this.queryFilter.elementIds = elementIds.map(Number);
      if (sourceIds.length > 0) this.queryFilter.sourceIds = sourceIds.map(Number);
      if (intervals.length > 0) this.queryFilter.intervals = intervals.map(Number);
      if (level !== null) this.queryFilter.level = Number(level);
      if (fromDate) this.queryFilter.fromDate = fromDate;
      if (toDate) this.queryFilter.toDate = toDate;

      this.queryData();

    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  protected get componentName(): string {
    return DataExplorerComponent.name;
  }

  protected onQueryClick(observationFilter: ViewObservationQueryModel): void {
    // Get the data based on the selection filter
    this.queryFilter = { ...observationFilter, deleted: false };
    this.pageInputDefinition.onFirst();
    this.queryData();
  }

  protected queryData(): void {
    if (!(this.allMetadataLoaded && this.queryFilter && this.utcOffset !== undefined)) {
      return;
    }

    this.enableQueryButton = false;
    this.isLoading = true;
    this.hasQueried = true;
    this.observationsEntries = [];
    this.pageInputDefinition.setTotalRowCount(0);
    this.observationService.count(this.queryFilter).pipe(take(1)).subscribe(
      {
        next: count => {
          this.enableQueryButton = true;
          this.pageInputDefinition.setTotalRowCount(count);
          if (count > 0) {
            this.loadData();
          } else {
            this.isLoading = false;
          }
        },
        error: err => {
          this.pagesDataService.showToast({ title: 'Data Exploration', message: err, type: ToastEventTypeEnum.ERROR });
          this.enableQueryButton = true;
          this.isLoading = false;
        },
      });
  }


  protected loadData(): void {
    this.enableQueryButton = false;
    this.isLoading = true;
    this.numOfChanges = 0;
    this.allBoundariesIndices = [];
    this.observationsEntries = [];
    this.queryFilter.page = this.pageInputDefinition.page;
    this.queryFilter.pageSize = this.pageInputDefinition.pageSize;

    this.observationService.findProcessed(this.queryFilter).pipe(
      take(1)
    ).subscribe({
      next: data => {

        const observationsEntries: ObservationEntry[] = data.map(observation => {
          const stationMetadata = this.cachedMetadataSearchService.getStation(observation.stationId);
          const elementMetadata = this.cachedMetadataSearchService.getElement(observation.elementId);
          const sourceMetadata = this.cachedMetadataSearchService.getSource(observation.sourceId);

          const observationView: ObservationEntry = {
            observation: observation,
            confirmAsCorrect: false,
            delete: false,
            change: 'no_change', 
            stationName: stationMetadata?.name ?? observation.stationId,
            elementAbbrv: elementMetadata?.name ?? observation.elementId.toString(),
            sourceName: observation.sourceName ?? sourceMetadata?.name ?? observation.sourceId.toString(),
            formattedDatetime: DateUtils.getPresentableDatetime(observation.datetime, this.utcOffset),
            intervalName: IntervalsUtil.getIntervalName(observation.interval), 
          }
          return observationView;

        });

        this.setRowBoundaryLineSettings(observationsEntries);
        this.observationsEntries = observationsEntries;
      },
      error: err => {
        this.pagesDataService.showToast({ title: 'Data Exploration', message: err, type: ToastEventTypeEnum.ERROR });
        this.enableQueryButton = true;
        this.isLoading = false;
      },
      complete: () => {
        this.enableQueryButton = true;
        this.isLoading = false;
      }
    });
  }

  protected setRowBoundaryLineSettings(observationsEntries: ObservationEntry[]): void {
    const obsIdentifierMap = new Map<string, number>();

    for (let i = 0; i < observationsEntries.length; i++) {
      const obs = observationsEntries[i].observation;
      const obsIdentifier = `${obs.stationId}-${obs.elementId}-${obs.level}-${obs.interval}-${obs.datetime}`;
      // Update the map with the latest index for each unique identifier
      obsIdentifierMap.set(obsIdentifier, i);
    }

    // set all last occurrence indices as boundaries
    this.allBoundariesIndices = Array.from(obsIdentifierMap.values());
    // If length indices array is the same as entries, then no need to show boundaries
    if (observationsEntries.length === this.allBoundariesIndices.length) {
      this.allBoundariesIndices = [];
    }
  }

  protected includeLowerBoundaryLine(index: number): boolean {
    return this.allBoundariesIndices.includes(index);
  }


  protected getRowNumber(currentRowIndex: number): number {
    return NumberUtils.getRowNumber(this.pageInputDefinition.page, this.pageInputDefinition.pageSize, currentRowIndex);
  }

  protected getSourceLabel(observation: ViewObservationModel, sourceName?: string): string {
    return observation.observationOrigin ?? sourceName ?? observation.sourceId.toString();
  }

  protected getValueLabel(observation: ViewObservationModel): string {
    if (observation.value === null || observation.value === undefined) {
      return observation.flag ?? '';
    }

    return observation.flag ? `${observation.value} ${observation.flag}` : observation.value.toString();
  }

  protected getQcStatusClass(qcStatus: QCStatusEnum): string {
    switch (qcStatus) {
      case QCStatusEnum.PASSED:
        return 'status-passed';
      case QCStatusEnum.FAILED:
        return 'status-failed';
      default:
        return 'status-none';
    }
  }

  protected queryLmsAiOutputs(): void {
    this.lmsLoading = true;
    this.lmsErrorMessage = '';
    this.lmsAiService.qcAssessments({
      stationId: this.lmsQuery.stationId || undefined,
      stationName: this.lmsQuery.stationName || undefined,
      elementCode: this.lmsQuery.elementCode || undefined,
      elementName: this.lmsQuery.elementName || undefined,
      dateFrom: this.lmsQuery.dateFrom || undefined,
      dateTo: this.lmsQuery.dateTo || undefined,
      outcome: this.lmsQuery.outcome || undefined,
      finalDecision: this.lmsQuery.finalDecision || undefined,
      severity: this.lmsQuery.severity || undefined,
      modelName: this.lmsQuery.modelName || undefined,
      reviewSource: this.lmsQuery.reviewSource || undefined,
      limit: this.lmsQuery.limit,
      offset: this.lmsQuery.offset,
    }).pipe(take(1)).subscribe({
      next: result => {
        this.lmsRows = result.rows;
        this.lmsTotal = result.total;
        this.lmsErrorMessage = result.errorMessage || '';
      },
      complete: () => this.lmsLoading = false,
    });
  }

  protected onModeChange(mode: 'observations' | 'lms-ai'): void {
    this.activeMode = mode;
  }

  protected searchLmsAiOutputs(): void {
    this.lmsQuery.offset = 0;
    this.queryLmsAiOutputs();
  }

  protected nextLmsPage(): void {
    if (this.lmsQuery.offset + this.lmsQuery.limit >= this.lmsTotal) return;
    this.lmsQuery.offset += this.lmsQuery.limit;
    this.queryLmsAiOutputs();
  }

  protected previousLmsPage(): void {
    this.lmsQuery.offset = Math.max(0, this.lmsQuery.offset - this.lmsQuery.limit);
    this.queryLmsAiOutputs();
  }

  protected get lmsPageStart(): number {
    return this.lmsTotal === 0 ? 0 : this.lmsQuery.offset + 1;
  }

  protected get lmsPageEnd(): number {
    return Math.min(this.lmsTotal, this.lmsQuery.offset + this.lmsRows.length);
  }

  protected getLmsDecision(row: Record<string, string>): string {
    return row['finalDecision'] || row['outcome'] || '';
  }

  protected getLmsStationLabel(row: Record<string, string>): string {
    return row['stationName'] || row['stationId'] || '';
  }

  protected getLmsElementLabel(row: Record<string, string>): string {
    return row['elementName'] || row['elementCode'] || '';
  }
}
