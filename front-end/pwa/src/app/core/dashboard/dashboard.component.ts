import { Component, OnDestroy } from '@angular/core';
import { catchError, forkJoin, of, Subject, take, takeUntil } from 'rxjs';
import { PagesDataService } from '../services/pages-data.service';
import { AppAuthService } from 'src/app/app-auth.service';
import { LoggedInUserModel } from 'src/app/admin/users/models/logged-in-user.model';
import { CachedMetadataService } from 'src/app/metadata/metadata-updates/cached-metadata.service';
import { ObservationsService } from 'src/app/data-ingestion/services/observations.service';
import { QCStatusEnum } from 'src/app/data-ingestion/models/qc-status.enum';
import { SourceTypeEnum } from 'src/app/metadata/source-specifications/models/source-type.enum';
import { ViewObservationModel } from 'src/app/data-ingestion/models/view-observation.model';
import { DateUtils } from 'src/app/shared/utils/date.utils';
import { APP_BRANDING } from '../app-branding';
import { LmsAiService, LmsAiStatus } from 'src/app/quality-control/services/lms-ai.service';

interface DashboardKpi {
  label: string;
  value: string;
  detail: string;
  icon: string;
  tone: 'blue' | 'navy' | 'green' | 'amber' | 'red' | 'cyan';
}

interface WeatherMetric {
  label: string;
  value: string;
  detail: string;
  icon: string;
  elementCodes: string[];
}

interface ReportCard {
  title: string;
  cadence: string;
  description: string;
  icon: string;
  route: string;
}

interface ActivityItem {
  label: string;
  detail: string;
  icon: string;
  tone: 'blue' | 'green' | 'amber' | 'red';
}

interface QuickAction {
  title: string;
  detail: string;
  icon: string;
  route: string;
}

interface SnapshotFact {
  label: string;
  detail: string;
  icon: string;
  tone: 'blue' | 'green' | 'amber' | 'red';
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnDestroy {
  protected readonly appBranding = APP_BRANDING;

  protected user!: LoggedInUserModel;
  protected selectedStationName = 'Station network';
  protected selectedStationId: string | null = null;
  protected dataFreshness = 'Live data summary';
  protected kpis: DashboardKpi[] = [];
  protected weatherMetrics: WeatherMetric[] = [];
  protected stationSnapshotFacts: SnapshotFact[] = [];
  protected reports: ReportCard[] = [];
  protected activities: ActivityItem[] = [];
  protected quickActions: QuickAction[] = [];
  protected loadingMetrics = true;
  protected lmsAiStatus: LmsAiStatus | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private pagesDataService: PagesDataService,
    private appAuthService: AppAuthService,
    private cachedMetadataSearchService: CachedMetadataService,
    private observationsService: ObservationsService,
    private lmsAiService: LmsAiService,) {
    this.pagesDataService.setPageHeader('Dashboard');
    this.setDashboardPlaceholders();

    this.appAuthService.user.pipe(
      takeUntil(this.destroy$),
    ).subscribe(user => {
      if (!user) {
        throw new Error('User not logged in');
      }

      this.user = user;
    });

    // calling this to make sure when a user re-logs in. The metadata updates automatically.
    // This also makes other components to have access to the metadata almost instantaneously.
    this.cachedMetadataSearchService.allMetadataLoaded.pipe(
      takeUntil(this.destroy$),
    ).subscribe(allMetadataLoaded => {
      if (allMetadataLoaded) {
        this.refreshDashboardMetrics();
        this.refreshLmsAiStatus();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setDashboardPlaceholders(): void {
    this.kpis = [
      { label: 'Total Observations', value: '...', detail: 'Shared observation store', icon: 'bi-database-check', tone: 'blue' },
      { label: 'Active Stations', value: '...', detail: 'Operational station metadata', icon: 'bi-broadcast-pin', tone: 'green' },
      { label: 'Manual Entries', value: '...', detail: 'Hourly, daily and monthly forms', icon: 'bi-pencil-square', tone: 'cyan' },
      { label: 'AWS Ingestions', value: '...', detail: 'Automated station sources', icon: 'bi-cloud-arrow-down', tone: 'navy' },
      { label: 'QC Failed', value: '...', detail: 'Records needing attention', icon: 'bi-shield-exclamation', tone: 'red' },
      { label: 'QC Pending Review', value: '...', detail: 'Awaiting QC workflow', icon: 'bi-hourglass-split', tone: 'amber' },
    ];

    this.weatherMetrics = [
      { label: 'Temperature', value: '--', detail: 'Latest TEMP observation', icon: 'bi-thermometer-half', elementCodes: ['TEMP'] },
      { label: 'Rainfall', value: '--', detail: 'Latest RN observation', icon: 'bi-cloud-rain', elementCodes: ['RN'] },
      { label: 'Humidity', value: '--', detail: 'Latest RH observation', icon: 'bi-moisture', elementCodes: ['RH'] },
      { label: 'Pressure', value: '--', detail: 'Latest PRES observation', icon: 'bi-speedometer2', elementCodes: ['PRES'] },
      { label: 'Wind', value: '--', detail: 'Latest WS / WD observation', icon: 'bi-wind', elementCodes: ['WS', 'WD'] },
    ];

    this.stationSnapshotFacts = [
      { label: 'Latest Observation', detail: 'Waiting for station data', icon: 'bi-clock-history', tone: 'blue' },
      { label: 'QC Status', detail: 'No station observations loaded', icon: 'bi-shield-check', tone: 'green' },
      { label: 'Source Coverage', detail: 'Sources appear when observations load', icon: 'bi-diagram-3', tone: 'amber' },
    ];

    this.reports = [
      { title: 'Daily CDMS Summary', cadence: 'Daily', description: 'AI-Enhanced CDMS station values, missing data and QC status.', icon: 'bi-calendar2-day', route: '/data-extraction/manual-export-selection' },
      { title: 'Monthly CDMS Climate Summary', cadence: 'Monthly', description: 'AI-Enhanced CDMS climate totals, averages and operational summaries.', icon: 'bi-calendar3', route: '/data-extraction/manual-export-selection' },
      { title: 'Station CDMS Report', cadence: 'On demand', description: 'Focused AI-Enhanced CDMS report for a selected station and element set.', icon: 'bi-file-earmark-bar-graph', route: '/data-extraction/manual-export-selection' },
    ];

    this.activities = [
      { label: 'Manual entries', detail: 'Ready from Hourly, Daily and Monthly forms', icon: 'bi-pencil-square', tone: 'blue' },
      { label: 'AWS ingestions', detail: 'Connector records appear through the shared pipeline', icon: 'bi-cloud-arrow-down', tone: 'green' },
      { label: 'QC actions', detail: 'Failed and pending records route to QC Review Workspace', icon: 'bi-shield-check', tone: 'amber' },
      { label: 'Recent imports', detail: 'Manual CSV imports are queryable in Data Explorer', icon: 'bi-upload', tone: 'blue' },
    ];

    this.quickActions = [
      { title: 'Data Entry', detail: 'Enter manual observations', icon: 'bi-keyboard', route: '/data-ingestion/forms' },
      { title: 'Manual Import', detail: 'Upload CSV observations', icon: 'bi-filetype-csv', route: '/data-ingestion/manual-import-selection' },
      { title: 'QC Review Workspace', detail: 'Review failed observations', icon: 'bi-shield-exclamation', route: '/quality-control/review-workspace' },
      { title: 'Data Explorer', detail: 'Query saved observations', icon: 'bi-search', route: '/data-monitoring/data-explorer' },
      { title: 'Reports', detail: 'Generate exports and summaries', icon: 'bi-file-earmark-arrow-down', route: '/data-extraction/manual-export-selection' },
    ];
  }

  private refreshDashboardMetrics(): void {
    this.loadingMetrics = true;
    const stations = this.cachedMetadataSearchService.stationsMetadata;
    const sources = this.cachedMetadataSearchService.sourcesMetadata;
    const manualSourceIds = sources.filter(source => source.sourceType === SourceTypeEnum.FORM).map(source => source.id);
    const awsSourceIds = sources
      .filter(source => source.name.toLowerCase().includes('aws'))
      .map(source => source.id);
    const activeStations = stations.filter(station => !station.dateClosed).length || stations.length;

    if (stations.length > 0) {
      this.selectedStationId = this.selectedStationId ?? stations[0].id;
      this.refreshSelectedStationSnapshot(this.selectedStationId);
    }

    forkJoin({
      total: this.observationsService.count({ deleted: false }).pipe(catchError(() => of(0))),
      manual: this.observationsService.count({ deleted: false, sourceIds: manualSourceIds }).pipe(catchError(() => of(0))),
      aws: awsSourceIds.length > 0
        ? this.observationsService.count({ deleted: false, sourceIds: awsSourceIds }).pipe(catchError(() => of(0)))
        : of(0),
      failed: this.observationsService.count({ deleted: false, qcStatus: QCStatusEnum.FAILED }).pipe(catchError(() => of(0))),
      pending: this.observationsService.count({ deleted: false, qcStatus: QCStatusEnum.NONE }).pipe(catchError(() => of(0))),
    }).pipe(
      take(1),
      takeUntil(this.destroy$),
    ).subscribe(metrics => {
      this.kpis = [
        { ...this.kpis[0], value: this.formatNumber(metrics.total) },
        { ...this.kpis[1], value: this.formatNumber(activeStations) },
        { ...this.kpis[2], value: this.formatNumber(metrics.manual) },
        { ...this.kpis[3], value: this.formatNumber(metrics.aws) },
        { ...this.kpis[4], value: this.formatNumber(metrics.failed) },
        { ...this.kpis[5], value: this.formatNumber(metrics.pending) },
      ];
      this.dataFreshness = `${this.formatNumber(metrics.total)} observations available`;
      this.loadingMetrics = false;
    });
  }

  private refreshLmsAiStatus(): void {
    this.lmsAiService.status().pipe(
      take(1),
      takeUntil(this.destroy$),
      catchError(() => of(null)),
    ).subscribe(status => {
      this.lmsAiStatus = status;
    });
  }

  protected get lmsManifest(): any {
    return this.lmsAiStatus?.manifest ?? {};
  }

  protected get lmsModelSummary(): any {
    return this.lmsAiStatus?.modelSummary ?? {};
  }

  protected get ensembleAnomalyRate(): string {
    const rate = this.lmsModelSummary?.anomalyRatePerModel?.Ensemble ?? 0;
    return `${((Number(rate) || 0) * 100).toFixed(2)}%`;
  }

  protected formatNumber(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  private refreshWeatherSnapshot(stationId: string): void {
    const elements = this.cachedMetadataSearchService.elementsMetadata;
    const now = new Date();
    const fromDate = new Date();
    fromDate.setDate(now.getDate() - 45);

    const requests = this.weatherMetrics.map(metric => {
      const elementIds = elements
        .filter(element => metric.elementCodes.includes(element.abbreviation))
        .map(element => element.id);

      if (elementIds.length === 0) {
        return of([]);
      }

      return this.observationsService.findProcessed({
        deleted: false,
        stationIds: [stationId],
        elementIds,
        fromDate: fromDate.toISOString(),
        toDate: now.toISOString(),
        page: 1,
        pageSize: 200,
      }).pipe(catchError(() => of([])));
    });

    forkJoin(requests).pipe(
      take(1),
      takeUntil(this.destroy$),
    ).subscribe(results => {
      const stationObservations = results.flat();
      this.weatherMetrics = this.weatherMetrics.map((metric, index) => {
        const latest = this.getLatestObservation(results[index]);
        if (!latest) {
          return metric;
        }

        return {
          ...metric,
          value: this.formatObservationValue(latest),
          detail: DateUtils.getPresentableDatetime(latest.datetime, this.cachedMetadataSearchService.utcOffSet),
        };
      });
      this.setStationSnapshotFacts(stationObservations);
    });
  }

  protected onStationSelectionChange(stationId: string): void {
    if (!stationId) return;
    this.selectedStationId = stationId;
    this.refreshSelectedStationSnapshot(stationId);
  }

  private refreshSelectedStationSnapshot(stationId: string): void {
    const station = this.cachedMetadataSearchService.stationsMetadata.find(item => item.id === stationId);
    this.selectedStationName = station ? station.name : stationId;
    this.weatherMetrics = this.weatherMetrics.map(metric => ({
      ...metric,
      value: '--',
      detail: `Latest ${metric.elementCodes.join(' / ')} observation`,
    }));
    this.refreshWeatherSnapshot(stationId);
  }

  private getLatestObservation(observations: ViewObservationModel[]): ViewObservationModel | undefined {
    return observations.reduce<ViewObservationModel | undefined>((latest, current) => {
      if (!latest) return current;
      return new Date(current.datetime) > new Date(latest.datetime) ? current : latest;
    }, undefined);
  }

  private formatObservationValue(observation: ViewObservationModel): string {
    const element = this.cachedMetadataSearchService.elementsMetadata.find(item => item.id === observation.elementId);
    if (observation.value === null || observation.value === undefined) {
      return observation.flag ?? '--';
    }

    return `${observation.value}${element?.units ? ' ' + element.units : ''}`;
  }

  private setStationSnapshotFacts(observations: ViewObservationModel[]): void {
    const latest = this.getLatestObservation(observations);
    const failed = observations.filter(item => item.qcStatus === QCStatusEnum.FAILED).length;
    const sources = new Set(observations.map(item => item.sourceId)).size;

    this.stationSnapshotFacts = [
      {
        label: 'Latest Observation',
        detail: latest ? DateUtils.getPresentableDatetime(latest.datetime, this.cachedMetadataSearchService.utcOffSet) : 'No recent observations',
        icon: 'bi-clock-history',
        tone: 'blue',
      },
      {
        label: 'QC Status',
        detail: failed ? `${failed} failed records in snapshot` : 'No failed records in snapshot',
        icon: failed ? 'bi-shield-exclamation' : 'bi-shield-check',
        tone: failed ? 'red' : 'green',
      },
      {
        label: 'Source Coverage',
        detail: sources ? `${sources} source${sources === 1 ? '' : 's'} in latest values` : 'No source coverage yet',
        icon: 'bi-diagram-3',
        tone: 'amber',
      },
    ];
  }

}
