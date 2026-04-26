import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PagesDataService } from 'src/app/core/services/pages-data.service';
import { Subject, takeUntil } from 'rxjs';
import { AppAuthService } from 'src/app/app-auth.service';
import { ObservationsService } from '../../services/observations.service';
import { ViewSourceModel } from 'src/app/metadata/source-specifications/models/view-source.model';
import { CachedMetadataService } from 'src/app/metadata/metadata-updates/cached-metadata.service';
import { StationFormsService } from 'src/app/metadata/stations/services/station-forms.service';
import { StationProcessingMethodEnum } from 'src/app/metadata/stations/models/station-processing-method.enum';
import { SourceTypeEnum } from 'src/app/metadata/source-specifications/models/source-type.enum';

type EntryFormKind = 'hourly' | 'daily' | 'monthly';

interface EntryFormCard {
  kind: EntryFormKind;
  title: string;
  description: string;
  cadence: string;
  iconClass: string;
  source?: ViewSourceModel;
}

const FORM_CARDS: EntryFormCard[] = [
  {
    kind: 'hourly',
    title: 'Hourly Data Form',
    description: 'Key hourly weather observations in a fast grid-style workflow.',
    cadence: 'Hourly',
    iconClass: 'bi-clock-history',
  },
  {
    kind: 'daily',
    title: 'Daily Data Form',
    description: 'Enter daily summaries and day-level observations.',
    cadence: 'Daily',
    iconClass: 'bi-calendar-day',
  },
  {
    kind: 'monthly',
    title: 'Monthly Data Form',
    description: 'Capture monthly totals, means, and summary values.',
    cadence: 'Monthly',
    iconClass: 'bi-calendar3',
  },
];

@Component({
  selector: 'app-station-form-selection',
  templateUrl: './station-form-selection.component.html',
  styleUrls: ['./station-form-selection.component.scss']
})
export class StationFormSelectionComponent implements OnDestroy {
  protected formCards: EntryFormCard[] = FORM_CARDS;
  protected isLoadingForms: boolean = true;
  protected openingFormKind: EntryFormKind | null = null;
  protected openingErrorMessage: string = '';
  private currentUser: any;
  private destroy$ = new Subject<void>();

  constructor(
    private pagesDataService: PagesDataService,
    private cachedMetadataService: CachedMetadataService,
    private stationFormsService: StationFormsService,
    private observationService: ObservationsService,
    private appAuthService: AppAuthService,
    private router: Router,
    private route: ActivatedRoute) {

    this.pagesDataService.setPageHeader('Data Entry');

    this.appAuthService.user.pipe(
      takeUntil(this.destroy$),
    ).subscribe(user => {
      this.currentUser = user;
    });

    this.cachedMetadataService.allMetadataLoaded.pipe(
      takeUntil(this.destroy$)
    ).subscribe(allMetadataLoaded => {
      if (!allMetadataLoaded) return;
      this.formCards = this.buildFormCards(this.cachedMetadataService.sourcesMetadata);
      this.isLoadingForms = false;
    });

    this.observationService.syncObservations();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  protected onFormClick(formCard: EntryFormCard): void {
    this.openingErrorMessage = '';

    if (!formCard.source) {
      this.router.navigate(['form-placeholder', formCard.kind], { relativeTo: this.route.parent });
      return;
    }

    this.openingFormKind = formCard.kind;
    let formOpened = false;
    this.stationFormsService.getStationsAssignedToUseForm(formCard.source.id).pipe(
      takeUntil(this.destroy$),
    ).subscribe({
      next: stationIds => {
        const stationId = this.getFirstPermittedManualStationId(stationIds);
        if (!stationId || formOpened) return;

        formOpened = true;
        this.router.navigate(
          ['form-entry', stationId, formCard.source!.id],
          { relativeTo: this.route.parent, queryParams: { from: 'forms' } }
        );
      },
      error: () => {
        this.openingFormKind = null;
        this.openingErrorMessage = 'This form could not load its assigned stations. Try again when metadata sync is available.';
      },
      complete: () => {
        if (formOpened) return;
        this.openingFormKind = null;
        this.openingErrorMessage = 'This form has no permitted manual stations assigned yet.';
      }
    });
  }

  protected getCardStatus(formCard: EntryFormCard): string {
    return formCard.source ? 'Available' : 'Placeholder';
  }

  protected isOpening(formCard: EntryFormCard): boolean {
    return this.openingFormKind === formCard.kind;
  }

  private buildFormCards(sources: ViewSourceModel[]): EntryFormCard[] {
    const formSources = sources.filter(source => source.sourceType === SourceTypeEnum.FORM && !source.disabled);

    return FORM_CARDS.map(card => {
      return {
        ...card,
        source: this.findSourceForKind(card.kind, formSources),
      };
    });
  }

  private findSourceForKind(kind: EntryFormKind, sources: ViewSourceModel[]): ViewSourceModel | undefined {
    const exactName = `${kind} data form`;
    const sourceByExactName = sources.find(source => source.name.trim().toLowerCase() === exactName);
    if (sourceByExactName) return sourceByExactName;

    return sources.find(source => {
      const searchableText = `${source.name} ${source.description ?? ''}`.toLowerCase();
      return searchableText.includes(kind);
    });
  }

  private getFirstPermittedManualStationId(stationIdsAssignedToForm: string[]): string | null {
    const manualStationIds = new Set(
      this.cachedMetadataService.stationsMetadata
        .filter(station =>
          station.stationObsProcessingMethod === StationProcessingMethodEnum.MANUAL ||
          station.stationObsProcessingMethod === StationProcessingMethodEnum.HYBRID
        )
        .map(station => station.id)
    );

    const manualAssignedStationIds = stationIdsAssignedToForm.filter(stationId => manualStationIds.has(stationId));
    if (manualAssignedStationIds.length === 0) return null;

    if (!this.currentUser || this.currentUser.isSystemAdmin) return manualAssignedStationIds[0];

    const permittedStationIds: string[] | undefined = this.currentUser.permissions?.entryPermissions?.stationIds;
    if (!permittedStationIds || permittedStationIds.length === 0) return manualAssignedStationIds[0];

    return manualAssignedStationIds.find(stationId => permittedStationIds.includes(stationId)) ?? null;
  }
}
