import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppConfigService } from 'src/app/app-config.service';
import { AppAuthInterceptor } from 'src/app/app-auth.interceptor';
import { StringUtils } from 'src/app/shared/utils/string.utils';
import { ViewObservationAnomalyAssessmentQueryModel } from '../models/view-observation-anomaly-assessment-query.model';
import { ViewObservationAnomalyAssessmentModel } from '../models/view-observation-anomaly-assessment.model';

@Injectable({
  providedIn: 'root'
})
export class ObservationAnomalyAssessmentsService {
  private endPointUrl: string;

  constructor(
    private appConfigService: AppConfigService,
    private http: HttpClient,
  ) {
    this.endPointUrl = `${this.appConfigService.apiBaseUrl}/observation-anomaly-assessments`;
  }

  public find(query: ViewObservationAnomalyAssessmentQueryModel): Observable<ViewObservationAnomalyAssessmentModel[]> {
    return this.http.get<ViewObservationAnomalyAssessmentModel[]>(
      `${this.endPointUrl}/review-workspace`,
      { params: StringUtils.getQueryParams<ViewObservationAnomalyAssessmentQueryModel>(query) }
    ).pipe(
      catchError(AppAuthInterceptor.handleError)
    );
  }
}
