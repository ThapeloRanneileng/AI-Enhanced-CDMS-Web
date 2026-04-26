import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { PagesDataService, ToastEventTypeEnum } from 'src/app/core/services/pages-data.service';
import { StringUtils } from 'src/app/shared/utils/string.utils';
import { CreateObservationModel } from 'src/app/data-ingestion/models/create-observation.model';
import { firstValueFrom, map, Subject, take, takeUntil } from 'rxjs';
import { FormEntryDefinition } from './defintitions/form-entry.definition';
import { ViewSourceModel } from 'src/app/metadata/source-specifications/models/view-source.model';
import { AssignSameInputComponent, SameInputStruct } from './assign-same-input/assign-same-input.component';
import { StationCacheModel } from 'src/app/metadata/stations/services/stations-cache.service';
import { LinearLayoutComponent } from './linear-layout/linear-layout.component';
import { GridLayoutComponent } from './grid-layout/grid-layout.component';
import { ObservationsService } from '../../services/observations.service';
import { StationFormsService } from 'src/app/metadata/stations/services/station-forms.service';
import { AppDatabase, AppComponentState, UserAppStateEnum } from 'src/app/app-database';
import { DateUtils } from 'src/app/shared/utils/date.utils';
import { AppLocationService } from 'src/app/app-location.service';
import * as turf from '@turf/turf';
import { CachedMetadataService } from 'src/app/metadata/metadata-updates/cached-metadata.service';
import { AppAuthInterceptor } from 'src/app/app-auth.interceptor';
import { AppAuthService } from 'src/app/app-auth.service';
import { EntryFormObservationQueryModel } from '../../models/entry-form-observation-query.model';
import { ViewObservationQueryModel } from '../../models/view-observation-query.model';
import { ViewObservationModel } from '../../models/view-observation.model';
import { ObservationEntry } from 'src/app/observations/models/observation-entry.model';
import { UserFormSettingsComponent } from './user-form-settings/user-form-settings.component';
import { ObservationAnomalyAssessmentsService } from 'src/app/quality-control/services/observation-anomaly-assessments.service';
import { ViewObservationAnomalyAssessmentModel } from 'src/app/quality-control/models/view-observation-anomaly-assessment.model';
import { NumberUtils } from 'src/app/shared/utils/number.utils';

type ObservationAnomalyReviewStatus = 'accepted' | 'overridden' | 'needs_investigation';

interface ObservationAnomalyReviewModel {
  observationKey: string;
  status: ObservationAnomalyReviewStatus;
  reviewedAt: string;
  reviewedByEmail?: string;
  assessmentId?: number;
}

interface ObservationAnomalyReviewState {
  reviews: Record<string, ObservationAnomalyReviewModel>;
}

interface ObservationLoadOptions {
  selectedObservationKey?: string | null;
  postSaveObservationKeys?: string[];
}

export interface UserFormSettingStruct {
  displayExtraInformationOption: boolean,
  incrementDateSelector: boolean;
  fieldsBorderSize: number;

  linearLayoutSettings: {
    height: number;
    maxRows: number;
  }

  gridLayoutSettings: {
    height: number;
    navigation: 'horizontal' | 'vertical';
  }
}

@Component({
  selector: 'app-form-entry',
  templateUrl: './form-entry.component.html',
  styleUrls: ['./form-entry.component.scss']
})
export class FormEntryComponent implements OnInit, OnDestroy {
  @ViewChild('appLinearLayout') linearLayoutComponent!: LinearLayoutComponent;
  @ViewChild('appGridLayout') gridLayoutComponent!: GridLayoutComponent;
  @ViewChild('appSameInputDialog') sameInputDialog!: AssignSameInputComponent;
  @ViewChild('appUserFormSettingsDialog') userFormSettingsDialog!: UserFormSettingsComponent;
  @ViewChild('formEntrySubmitButton') submitButton!: ElementRef;

  /** Station details */
  protected station!: StationCacheModel;

  /** Source (form) details */
  protected source!: ViewSourceModel;

  protected stationsIdsAssignedToForm!: string[];
  protected openedFromFormCatalog: boolean = false;

  /** Definitions used to determine form functionalities */
  protected formDefinitions!: FormEntryDefinition;

  protected refreshLayout: boolean = false;

  private totalIsValid!: boolean;

  protected defaultYearMonthValue!: string;
  protected defaultDateValue!: string;

  protected userFormSettings: UserFormSettingStruct = {
    displayExtraInformationOption: false,
    incrementDateSelector: false,
    fieldsBorderSize: 1,
    linearLayoutSettings: {
      height: 60,
      maxRows: 5
    },
    gridLayoutSettings: {
      height: 60,
      navigation: 'horizontal',
    }
  };

  protected userLocationErrorMessage: string = '';

  /**
 * Used to determine whether to display element selector 
 */
  protected displayElementSelector: boolean = false;

  /**
   * Used to determine whether to display date selector
   */
  protected displayDateSelector: boolean = false;

  /**
   * Used to determine whether to display year-month selector
   */
  protected displayYearMonthSelector: boolean = false;

  /**
   * Used to determine whether to display hour selector
   */
  protected displayHourSelector: boolean = false;

  // Key is `elementId-datetime`
  protected duplicateObservations: Map<string, ViewObservationModel> = new Map<string, ViewObservationModel>();
  protected observationAnomalyAssessmentsByKey: Map<string, ViewObservationAnomalyAssessmentModel> = new Map<string, ViewObservationAnomalyAssessmentModel>();

  protected observationEntries: ObservationEntry[] = [];
  protected selectedGridObservation: ObservationEntry | null = null;
  protected selectedObservationAnomalyAssessment: ViewObservationAnomalyAssessmentModel | null = null;
  protected isSelectedObservationAnomalyLoading: boolean = false;
  protected selectedObservationAnomalyErrorMessage: string = '';
  protected selectedObservationReview: ObservationAnomalyReviewModel | null = null;
  protected isSavingSelectedObservationReview: boolean = false;
  protected anomalyRefreshLogMessage: string = '';

  private currentUserEmail: string = '';

  private destroy$ = new Subject<void>();

  constructor
    (private pagesDataService: PagesDataService,
      private appAuthService: AppAuthService,
      private stationFormsService: StationFormsService,
      private observationService: ObservationsService,
      private observationAnomalyAssessmentsService: ObservationAnomalyAssessmentsService,
      private cachedMetadataService: CachedMetadataService,
      private locationService: AppLocationService,
      private route: ActivatedRoute,
      private location: Location,) {

    this.pagesDataService.setPageHeader('Data Entry');

    this.appAuthService.user.pipe(
      takeUntil(this.destroy$),
    ).subscribe(user => {
      if (!user) return;
      this.currentUserEmail = user.email;
      this.pagesDataService.showToast({ title: 'Data Entry', message: `You are currently logged in as ${user.email}`, type: ToastEventTypeEnum.WARNING, timeout: 6000 });
    });

    // Important note. 
    // Set user form settings then attempt to sync the observations. 
    // The 2 methods are both asynchronous and the user settings is needed first
    this.loadUserSettings();
    this.observationService.syncObservations();
  }

  ngOnInit(): void {
    const stationId = this.route.snapshot.params['stationid'];
    const sourceId = +this.route.snapshot.params['sourceid'];
    this.openedFromFormCatalog = this.route.snapshot.queryParams['from'] === 'forms';

    this.cachedMetadataService.allMetadataLoaded.pipe(
      takeUntil(this.destroy$),
    ).subscribe(allMetadataLoaded => {
      if (!allMetadataLoaded) return;

      this.station = this.cachedMetadataService.getStation(stationId);
      this.source = this.cachedMetadataService.getSource(sourceId);
      this.formDefinitions = new FormEntryDefinition(this.station, this.source, this.cachedMetadataService);

      this.loadObservations();

      /** Gets default date value (YYYY-MM-DD) used by date selector */
      const date: Date = new Date()
      this.defaultDateValue = date.toISOString().split('T')[0];
      // Gets default year-month value (YYYY-MM) used by year-month selector
      this.defaultYearMonthValue = `${this.formDefinitions.yearSelectorValue}-${StringUtils.addLeadingZero(this.formDefinitions.monthSelectorValue)}`;

      //-----------------------------------------------------
      // Set selectors to use
      //-----------------------------------------------------
      this.displayElementSelector = this.formDefinitions.elementSelectorValue !== null;
      if (this.formDefinitions.daySelectorValue) {
        this.displayDateSelector = true; // If day is included then use the date selector
      } else {
        this.displayYearMonthSelector = true; // If day is not included then use the year month selector
      }
      this.displayHourSelector = this.formDefinitions.hourSelectorValue !== null;
      //-----------------------------------------------------


      if (this.shouldDisplayStationSelector()) {
        // Get the station ids assigned to use the form
        this.stationFormsService.getStationsAssignedToUseForm(sourceId).pipe(
          takeUntil(this.destroy$),
        ).subscribe(stationIds => {
          this.stationsIdsAssignedToForm = stationIds;
        });
      }

      if (this.formDefinitions.formMetadata.allowEntryAtStationOnly) {
        this.onRequestLocation();
      }

    });

  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }



  /**
   * Loads any existing observations from the database
   */
  private loadObservations(options?: ObservationLoadOptions): void {
    // Reset controls
    this.totalIsValid = false;
    this.refreshLayout = false;
    this.observationEntries = [];
    this.duplicateObservations = new Map<string, ViewObservationModel>();
    this.observationAnomalyAssessmentsByKey = new Map<string, ViewObservationAnomalyAssessmentModel>();
    this.resetSelectedObservationPanel({
      keepSelection: !!options?.selectedObservationKey || !!options?.postSaveObservationKeys?.length,
      keepRefreshLog: !!options?.postSaveObservationKeys?.length,
    });

    const entryFormObsQuery: EntryFormObservationQueryModel = this.formDefinitions.createObservationQuery();
    this.observationService.findEntryFormData(entryFormObsQuery).pipe(
      take(1),
    ).subscribe(data => {
      this.observationEntries = this.formDefinitions.createObsEntries(data);
      this.refreshLayout = true;
      // Set firts value flag to have focus ready for rapid data entry
      if (this.linearLayoutComponent) this.linearLayoutComponent.setFocusToFirstVF();
      if (this.gridLayoutComponent) this.gridLayoutComponent.setFocusToFirstVF();

      // If double data entry is not allowed then fetch duplicates so that value flag component can prevent double data entry
      if (!this.formDefinitions.formMetadata.allowDoubleDataEntry) {
        this.loadDuplicates(entryFormObsQuery);
      }

      void this.loadVisibleObservationAnomalyAssessments(entryFormObsQuery);

      if (options?.selectedObservationKey || options?.postSaveObservationKeys?.length) {
        this.restoreSelectedObservationAfterLoad(options);
      }
    });
  }

  private loadDuplicates(entryFormObsQuery: EntryFormObservationQueryModel): void {
    const viewObsQuery: ViewObservationQueryModel = {
      stationIds: [entryFormObsQuery.stationId],
      elementIds: entryFormObsQuery.elementIds,
      level: entryFormObsQuery.level,
      intervals: [entryFormObsQuery.interval],
      fromDate: entryFormObsQuery.fromDate,
      toDate: entryFormObsQuery.toDate,
      deleted: false,
      page: 1,
      pageSize: 1000, // TODO. What should be done when it comes to instances that have more than 1000 rows. For instance - 31 days by 35 elements
    };

    this.observationService.findProcessed(viewObsQuery).pipe(
      take(1),
    ).subscribe(observations => {
      // Get same observations that are not from the current source id. They are the duplicates
      const newDuplicateObservations = new Map<string, ViewObservationModel>();
      for (const observation of observations) {
        if (observation.sourceId !== entryFormObsQuery.sourceId) {
          // Add utc because it needs to be displayed based on display utc offset
          observation.datetime = DateUtils.getDatetimesBasedOnUTCOffset(observation.datetime, this.source.utcOffset, 'add');

          newDuplicateObservations.set(`${observation.elementId}-${observation.datetime}`, observation);
        }
      }

      // Only set the duplicates map when there are duplicates. This makes angular detection to only be raised when there are dplicates
      if (newDuplicateObservations.size > 0) {
        this.duplicateObservations = newDuplicateObservations;
      }
    });
  }

  protected onStationChange(stationId: string) {
    this.formDefinitions.station = this.cachedMetadataService.getStation(stationId);
    this.station = this.formDefinitions.station;
    this.loadObservations();
  }

  protected shouldDisplayStationSelector(): boolean {
    return this.openedFromFormCatalog || !!this.formDefinitions?.formMetadata.allowStationSelection;
  }

  /**
   * Handles changes in element selection by updating internal state
   * @param id 
   * @returns 
   */
  public onElementChange(id: number | null): void {
    if (id === null) {
      return;
    }

    this.formDefinitions.elementSelectorValue = id;
    this.loadObservations();
  }

  /**
   * Handles changes in year and month selection by updating internal state
   * @param yearMonth 
   * @returns 
   */
  protected onYearMonthChange(yearMonth: string | null): void {
    if (!yearMonth) {
      return;
    }
    const splitValue = yearMonth.split('-');
    this.formDefinitions.yearSelectorValue = +splitValue[0];
    this.formDefinitions.monthSelectorValue = +splitValue[1];
    this.loadObservations();
  }

  /**
   * Handles changes in year, month and day selection by updating internal state
   * @param strDate 
   * @returns 
   */
  protected onDateChange(strDate: string | null): void {
    if (!strDate) {
      return;
    }
    const splitValue = strDate.split('-');
    this.formDefinitions.yearSelectorValue = +splitValue[0];
    this.formDefinitions.monthSelectorValue = +splitValue[1];
    this.formDefinitions.daySelectorValue = +splitValue[2];
    this.loadObservations();
  }

  /**
   * Handles changes in hour selection by updating internal state
   * @param hour 
   * @returns 
   */
  protected onHourChange(hour: number | null): void {
    if (hour === null) {
      return;
    }

    this.formDefinitions.hourSelectorValue = hour;
    this.loadObservations();
  }

  /**
   * Handles validation of total input from the layouts
   * @param totalIsValid 
   */
  protected onTotalIsValid(totalIsValid: boolean) {
    this.totalIsValid = totalIsValid;
  }

  /**
   * Updates its internal state depending on the options passed
   * @param option  'Same Input' | 'Clear Input' | 'Add Extra Info' | 'Settings'
   */
  protected onOptions(option: 'Same Input' | 'Clear Fields' | 'Settings'): void {
    switch (option) {
      case 'Same Input':
        this.sameInputDialog.showDialog();
        break;
      case 'Clear Fields':
        this.clear();
        break;
      case 'Settings':
        this.userFormSettingsDialog.showDialog(this.userFormSettings);
        break;
      default:
        console.warn('Developer eroor: Option NOT allowed', option)
        break;
    }
  }

  /**
   * Sets the same value flag to all entry fields
   * @param input 
   */
  protected onAssignSameValue(input: SameInputStruct): void {
    if (this.linearLayoutComponent) {
      this.linearLayoutComponent.sameInput(input.valueFlag, input.comment);
    }

    if (this.gridLayoutComponent) {
      this.gridLayoutComponent.sameInput(input.valueFlag, input.comment);
    }
  }

  /**
  * Clears all the observation value flags if they are not cleared and updates its internal state
  */
  private clear(): void {
    if (this.linearLayoutComponent) {
      this.linearLayoutComponent.clear();
    }

    if (this.gridLayoutComponent) {
      this.gridLayoutComponent.clear();
    }
  }

  protected onSaveUserSettings(newUserFormSettings: UserFormSettingStruct): void {
    this.userFormSettings = newUserFormSettings;
    AppDatabase.instance.userSettings.put({ name: UserAppStateEnum.ENTRY_FORM_SETTINGS, parameters: this.userFormSettings });
  }

  /**
   * Handles saving of observations by sending the data to the server and updating intenal state
   */
  protected onSubmit(): void {
    if (this.userLocationErrorMessage) {
      this.pagesDataService.showToast({ title: 'Data Entry', message: 'To submit data using this form, user Location is required', type: ToastEventTypeEnum.ERROR });
      return;
    }

    // Set total as valid, because everything has been cleared
    if (this.formDefinitions.formMetadata.requireTotalInput && !this.totalIsValid) {
      this.pagesDataService.showToast({ title: 'Observations', message: `Total value not entered`, type: ToastEventTypeEnum.ERROR, timeout: 6000 });
      return;
    }

    const createObservations: CreateObservationModel[] = [];
    const savedObservationKeys: string[] = [];
    for (const obsEntry of this.observationEntries) {
      if (obsEntry.change === 'valid_change') {
        savedObservationKeys.push(this.getObservationReviewKey(obsEntry));
        createObservations.push({
          stationId: obsEntry.observation.stationId,
          elementId: obsEntry.observation.elementId,
          sourceId: obsEntry.observation.sourceId,
          level: obsEntry.observation.level,

          // Subtracts the offset to get UTC time if offset is plus and add the offset to get UTC time if offset is minus
          // Note, it's subtraction and NOT addition because this is meant to submit data to the API NOT display it
          datetime: DateUtils.getDatetimesBasedOnUTCOffset(obsEntry.observation.datetime, this.source.utcOffset, 'subtract'),

          interval: obsEntry.observation.interval,
          value: obsEntry.observation.value,
          flag: obsEntry.observation.flag,
          comment: obsEntry.observation.comment,
        });
      } else if (obsEntry.change === 'invalid_change') {
        this.pagesDataService.showToast({ title: 'Observations', message: 'Invalid observation(s) detected', type: ToastEventTypeEnum.ERROR, timeout: 6000 });
        return;
      }
    }

    if (createObservations.length === 0) {
      this.pagesDataService.showToast({ title: 'Observations', message: 'No changes made', type: ToastEventTypeEnum.ERROR });
      return;
    }

    const obsMessage: string = `observation${createObservations.length === 1 ? '' : 's'}`;

    // Send to server for saving 
    this.observationService.bulkPutDataFromEntryForm(createObservations).pipe(
      take(1)
    ).subscribe({
      next: () => {
        this.pagesDataService.showToast({ title: 'Data Entry', message: `${createObservations.length} ${obsMessage} saved successfully`, type: ToastEventTypeEnum.SUCCESS });

        // Then sequence to next date if sequencing is on
        if (this.userFormSettings.incrementDateSelector) {
          this.sequenceToNextDate();
        }

        // Reload the data from server
        const selectedObservationKey = this.getSelectedObservationReviewKey();
        this.loadObservations({
          selectedObservationKey: selectedObservationKey,
          postSaveObservationKeys: savedObservationKeys,
        });
      },
      error: err => {
        if (AppAuthInterceptor.isKnownNetworkError(err)) {
          // If there is network error then save observations as unsynchronised and no need to send data to server
          this.pagesDataService.showToast({ title: 'Data Entry', message: `${createObservations.length} ${obsMessage} saved locally`, type: ToastEventTypeEnum.WARNING, timeout: 5000 });
        } else if (err.status === 400) {
          // If there is a bad request error then show the server message
          this.pagesDataService.showToast({ title: 'Data Entry', message: `${err.error.message}`, type: ToastEventTypeEnum.ERROR, timeout: 6000 });
        } else {
          // Log the error for tracing purposes
          console.log('data entry error: ', err);
          this.pagesDataService.showToast({ title: 'Data Entry', message: `Something wrong happened. Contact admin.`, type: ToastEventTypeEnum.ERROR, timeout: 6000 });
        }
      }
    }
    );

  }

  private sequenceToNextDate(): void {
    const currentYearValue: number = this.formDefinitions.yearSelectorValue;
    const currentMonthValue: number = this.formDefinitions.monthSelectorValue; // 1-indexed (January = 1)
    const today: Date = new Date();

    let newYear = currentYearValue;
    let newMonth = currentMonthValue;
    let newDay: number | null = null;

    //If there is a hour selector then sequence hour first before sequencing date 
    if (this.formDefinitions.hourSelectorValue !== null) {
      for (const allowedDataEntryHour of this.formDefinitions.formMetadata.hours) {
        // Set the next allowed hour
        if (allowedDataEntryHour > this.formDefinitions.hourSelectorValue) {
          this.formDefinitions.hourSelectorValue = allowedDataEntryHour;
          return;
        }
      }
      // If there was no next hour then set the first hour before moving to the next date
      this.formDefinitions.hourSelectorValue = this.formDefinitions.formMetadata.hours[0];
    }

    if (this.formDefinitions.daySelectorValue) {
      let currentDayValue = this.formDefinitions.daySelectorValue;

      const daysInMonth = new Date(newYear, newMonth, 0).getDate(); // Get days in the current month
      if (currentDayValue < daysInMonth) {
        newDay = currentDayValue + 1; // Sequence to the next day
      } else {
        // If it's the last day of the month, sequence to the first day of the next month
        newDay = 1;
        if (newMonth < 12) {
          newMonth++;
        } else {
          // If it's December, sequence to January of the next year
          newMonth = 1;
          newYear++;
        }
      }
    } else {
      // If daySelectorValue is not defined, sequence to the next month
      if (newMonth < 12) {
        newMonth++;
      } else {
        // If it's December, sequence to January of the next year
        newMonth = 1;
        newYear++;
      }
    }

    // Ensure sequencing does not exceed the current date
    const newDate = new Date(newYear, newMonth - 1, newDay || 1); // Use 1 if no day is specified
    if (newDate > today) {
      console.warn("Sequencing exceeds the current date. No changes applied.");
      return;
    }

    // Update the form definitions with the sequenced values
    this.formDefinitions.yearSelectorValue = newYear;
    this.formDefinitions.monthSelectorValue = newMonth;
    if (newDay !== null) {
      this.formDefinitions.daySelectorValue = newDay;
      /** Gets default date value (YYYY-MM-DD) used by date selector */
      this.defaultDateValue = this.formDefinitions.yearSelectorValue + '-' + StringUtils.addLeadingZero(this.formDefinitions.monthSelectorValue) + '-' + StringUtils.addLeadingZero(this.formDefinitions.daySelectorValue);
    }

    // Gets default year-month value (YYYY-MM) used by year-month selector
    this.defaultYearMonthValue = this.formDefinitions.yearSelectorValue + '-' + StringUtils.addLeadingZero(this.formDefinitions.monthSelectorValue);
  }

  /**
   * Handles cancel event and routes the application back to previous route page
   */
  protected onCancel(): void {
    this.location.back();
  }

  protected onUserInputVF(observationEntry: ObservationEntry) {
    // TODO
  }

  protected onGridCellSelected(observationEntry: ObservationEntry): void {
    this.showObservationAnomalyPanel(observationEntry);
  }

  protected async onSelectedObservationReview(status: ObservationAnomalyReviewStatus): Promise<void> {
    if (!this.selectedGridObservation || !this.selectedObservationAnomalyAssessment) {
      return;
    }

    const observationKey = this.getObservationReviewKey(this.selectedGridObservation);
    this.isSavingSelectedObservationReview = true;
    try {
      const savedState = await AppDatabase.instance.userSettings.get(UserAppStateEnum.OBSERVATION_ANOMALY_REVIEWS);
      const reviewState: ObservationAnomalyReviewState = savedState?.parameters ?? { reviews: {} };
      const newReview: ObservationAnomalyReviewModel = {
        observationKey: observationKey,
        status: status,
        reviewedAt: new Date().toISOString(),
        reviewedByEmail: this.currentUserEmail || undefined,
        assessmentId: this.selectedObservationAnomalyAssessment.id,
      };

      reviewState.reviews[observationKey] = newReview;
      await AppDatabase.instance.userSettings.put({
        name: UserAppStateEnum.OBSERVATION_ANOMALY_REVIEWS,
        parameters: reviewState,
      });

      if (this.getSelectedObservationReviewKey() === observationKey) {
        this.selectedObservationReview = newReview;
      }
    } catch (error) {
      this.pagesDataService.showToast({ title: 'AI Anomaly Review', message: 'Failed to save review', type: ToastEventTypeEnum.ERROR });
    } finally {
      this.isSavingSelectedObservationReview = false;
    }
  }

  protected onFocusSaveButton(): void {
    // Focusing the save button immediately has a bug of raising a click event immediately thus saving the contents even though its just a focus
    // This timeout is hacky way of solving the problem. 
    // TODO investigate why the above happens 
    setTimeout(() => {
      this.submitButton.nativeElement.focus();
    }, 0);

  }

  protected async loadUserSettings() {
    const savedUserFormSetting: AppComponentState | undefined = await AppDatabase.instance.userSettings.get(UserAppStateEnum.ENTRY_FORM_SETTINGS);
    if (savedUserFormSetting) {
      this.userFormSettings = savedUserFormSetting.parameters;
    }
  }

  protected onRequestLocation(): void {
    this.userLocationErrorMessage = 'Checking location...';
    this.locationService.getUserLocation().pipe(take(1)).subscribe({
      next: (userLocation) => {
        if (this.station.location) {
          if (this.isUserWithinStation(this.station.location, userLocation)) {
            this.userLocationErrorMessage = '';
          } else {
            this.userLocationErrorMessage = 'Location retrived is not at the station. To submit data entered, you have to be at the station.';
          }
        } else {
          this.userLocationErrorMessage = 'Update station location. To submit data entered, you have to be at the station.';
        }
      },
      error: (error) => {
        this.pagesDataService.showToast({ title: "Station Location", message: error, type: ToastEventTypeEnum.ERROR });
        this.userLocationErrorMessage = 'Error in getting your location. To submit data entered, you have to be at the station.';
      }
    });
  }

  /**
   * Checks if the user's current location is within a specified distance (meters) of the station.
   */
  private isUserWithinStation(
    stationLocation: { latitude: number; longitude: number; },
    userLocation: { latitude: number; longitude: number; },
    thresholdMeters: number = 200 // 200 because of the office distance from the instruments
  ): boolean {
    const stationPoint = turf.point([stationLocation.longitude, stationLocation.latitude]);
    const userPoint = turf.point([userLocation.longitude, userLocation.latitude]);
    const distance = turf.distance(stationPoint, userPoint, { units: 'meters' });
    return distance <= thresholdMeters;
  }

  protected formatAnomalyAssessmentOption(option: string | null): string {
    return StringUtils.formatEnumForDisplay(option);
  }

  protected formatAnomalyScore(score: number): number {
    return NumberUtils.roundOff(score, 3);
  }

  protected get formattedSelectedAnomalyCreatedAt(): string {
    if (!this.selectedObservationAnomalyAssessment) {
      return '';
    }

    return DateUtils.getPresentableDatetime(this.selectedObservationAnomalyAssessment.createdAt, this.cachedMetadataService.utcOffSet);
  }

  protected get selectedObservationElementName(): string {
    if (!this.selectedGridObservation) {
      return '';
    }

    const element = this.cachedMetadataService.getElement(this.selectedGridObservation.observation.elementId);
    return `${element.id} - ${element.name}`;
  }

  protected formatReviewStatus(status: ObservationAnomalyReviewStatus): string {
    return StringUtils.formatEnumForDisplay(status);
  }

  protected get formattedSelectedObservationReviewAt(): string {
    if (!this.selectedObservationReview) {
      return '';
    }

    return DateUtils.getPresentableDatetime(this.selectedObservationReview.reviewedAt, this.cachedMetadataService.utcOffSet);
  }

  private getObservationReviewKey(observationEntry: ObservationEntry): string {
    const observation = observationEntry.observation;
    return this.getObservationKeyFromParts(
      observation.stationId,
      observation.elementId,
      observation.level,
      observation.datetime,
      observation.interval,
      observation.sourceId,
    );
  }

  private getSelectedObservationReviewKey(): string | null {
    return this.selectedGridObservation ? this.getObservationReviewKey(this.selectedGridObservation) : null;
  }

  private async loadSelectedObservationReview(observationKey: string): Promise<void> {
    const savedState = await AppDatabase.instance.userSettings.get(UserAppStateEnum.OBSERVATION_ANOMALY_REVIEWS);
    const reviewState: ObservationAnomalyReviewState | undefined = savedState?.parameters;

    if (this.getSelectedObservationReviewKey() !== observationKey) {
      return;
    }

    this.selectedObservationReview = reviewState?.reviews?.[observationKey] ?? null;
  }

  private resetSelectedObservationPanel(options?: { keepSelection?: boolean; keepRefreshLog?: boolean }): void {
    if (!options?.keepSelection) {
      this.selectedGridObservation = null;
    }
    this.selectedObservationAnomalyAssessment = null;
    this.isSelectedObservationAnomalyLoading = false;
    this.selectedObservationAnomalyErrorMessage = '';
    this.selectedObservationReview = null;
    this.isSavingSelectedObservationReview = false;
    if (!options?.keepRefreshLog) {
      this.anomalyRefreshLogMessage = '';
    }
  }

  private restoreSelectedObservationAfterLoad(options: ObservationLoadOptions): void {
    const candidateKeys = [
      options.selectedObservationKey,
      ...(options.postSaveObservationKeys ?? []),
    ].filter((key): key is string => !!key);

    for (const key of candidateKeys) {
      const matchedObservation = this.getObservationEntryByKey(key);
      if (matchedObservation) {
        this.showObservationAnomalyPanel(matchedObservation, true, options.postSaveObservationKeys ?? []);
        return;
      }
    }

    if (options.postSaveObservationKeys && options.postSaveObservationKeys.length > 0) {
      this.anomalyRefreshLogMessage = `AI anomaly refresh skipped: ${options.postSaveObservationKeys.length} saved cell(s) were not visible after reload.`;
      console.info('[Data Entry] AI anomaly refresh skipped after save', {
        savedObservationKeys: options.postSaveObservationKeys,
      });
    }
  }

  private showObservationAnomalyPanel(observationEntry: ObservationEntry, triggeredByPostSave: boolean = false, savedObservationKeys: string[] = []): void {
    const observationKey = this.getObservationReviewKey(observationEntry);
    const persistedObservationDatetime = DateUtils.getDatetimesBasedOnUTCOffset(
      observationEntry.observation.datetime,
      this.source.utcOffset,
      'subtract',
    );
    this.selectedGridObservation = observationEntry;
    this.selectedObservationAnomalyAssessment = null;
    this.isSelectedObservationAnomalyLoading = true;
    this.selectedObservationAnomalyErrorMessage = '';
    this.selectedObservationReview = null;
    this.anomalyRefreshLogMessage = triggeredByPostSave ? 'Refreshing AI anomaly assessment after save...' : '';

    void this.loadSelectedObservationReview(observationKey);

    console.info('[Data Entry] Fetching AI anomaly assessment', {
      selectedObservationKey: observationKey,
      displayDatetime: observationEntry.observation.datetime,
      persistedLookupDatetime: persistedObservationDatetime,
      sourceUtcOffset: this.source.utcOffset,
      triggeredByPostSave,
    });

    this.observationAnomalyAssessmentsService.find({
      stationIds: [observationEntry.observation.stationId],
      elementIds: [observationEntry.observation.elementId],
      level: observationEntry.observation.level,
      intervals: [observationEntry.observation.interval],
      sourceIds: [observationEntry.observation.sourceId],
      fromDate: persistedObservationDatetime,
      toDate: persistedObservationDatetime,
      page: 1,
      pageSize: 1,
    }).pipe(
      take(1),
    ).subscribe({
      next: data => {
        if (this.getSelectedObservationReviewKey() !== observationKey) {
          return;
        }
        this.isSelectedObservationAnomalyLoading = false;
        this.selectedObservationAnomalyAssessment = data.length > 0 ? data[0] : null;
        if (data.length > 0) {
          this.observationAnomalyAssessmentsByKey.set(observationKey, data[0]);
        }
        if (triggeredByPostSave) {
          const affectedCount = savedObservationKeys.length;
          this.anomalyRefreshLogMessage = data.length > 0
            ? `AI anomaly assessment refreshed for ${affectedCount} recently saved cell(s).`
            : `AI anomaly assessment refresh completed, but no generated assessment was found for the selected saved cell.`;
          console.info('[Data Entry] AI anomaly refresh after save', {
            selectedObservationKey: observationKey,
            savedObservationCount: affectedCount,
            assessmentGenerated: data.length > 0,
          });
        }
      },
      error: err => {
        if (this.getSelectedObservationReviewKey() !== observationKey) {
          return;
        }
        this.isSelectedObservationAnomalyLoading = false;
        this.selectedObservationAnomalyErrorMessage = err?.error?.message || err?.message || 'Failed to load AI anomaly assessment';
        if (triggeredByPostSave) {
          this.anomalyRefreshLogMessage = 'AI anomaly refresh failed after save.';
          console.warn('[Data Entry] AI anomaly refresh failed after save', {
            selectedObservationKey: observationKey,
            savedObservationCount: savedObservationKeys.length,
            error: err,
          });
        }
      }
    });
  }

  private getObservationEntryByKey(observationKey: string): ObservationEntry | undefined {
    return this.observationEntries.find(entry => this.getObservationReviewKey(entry) === observationKey);
  }

  private async loadVisibleObservationAnomalyAssessments(entryFormObsQuery: EntryFormObservationQueryModel): Promise<void> {
    try {
      const pageSize = 1000;
      const fetchedAssessments: ViewObservationAnomalyAssessmentModel[] = [];
      let page = 1;

      while (true) {
        const batch = await firstValueFrom(this.observationAnomalyAssessmentsService.find({
          stationIds: [entryFormObsQuery.stationId],
          elementIds: entryFormObsQuery.elementIds,
          level: entryFormObsQuery.level,
          intervals: [entryFormObsQuery.interval],
          sourceIds: [entryFormObsQuery.sourceId],
          fromDate: entryFormObsQuery.fromDate,
          toDate: entryFormObsQuery.toDate,
          page,
          pageSize,
        }).pipe(take(1)));

        fetchedAssessments.push(...batch);

        if (batch.length < pageSize) {
          break;
        }

        page++;
      }

      const assessmentMap = new Map<string, ViewObservationAnomalyAssessmentModel>();

      for (const assessment of fetchedAssessments) {
        const displayDatetime = DateUtils.getDatetimesBasedOnUTCOffset(
          assessment.datetime,
          this.source.utcOffset,
          'add',
        );
        const observationKey = this.getObservationKeyFromParts(
          assessment.stationId,
          assessment.elementId,
          assessment.level,
          displayDatetime,
          assessment.interval,
          assessment.sourceId,
        );

        if (!assessmentMap.has(observationKey)) {
          assessmentMap.set(observationKey, assessment);
        }
      }

      this.observationAnomalyAssessmentsByKey = assessmentMap;
    } catch (err) {
      console.warn('[Data Entry] Failed to load visible AI anomaly assessments for grid highlighting', err);
      this.observationAnomalyAssessmentsByKey = new Map<string, ViewObservationAnomalyAssessmentModel>();
    }
  }

  private getObservationKeyFromParts(
    stationId: string,
    elementId: number,
    level: number,
    datetime: string,
    interval: number,
    sourceId: number,
  ): string {
    return [
      stationId,
      elementId,
      level,
      datetime,
      interval,
      sourceId,
    ].join('|');
  }

}
