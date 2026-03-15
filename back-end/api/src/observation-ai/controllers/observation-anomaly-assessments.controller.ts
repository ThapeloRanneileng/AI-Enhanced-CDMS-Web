import { Controller, Get, Query } from '@nestjs/common';
import { AuthorisedStationsPipe } from 'src/user/pipes/authorised-stations.pipe';
import { ObservationAnomalyAssessmentsQueryService } from '../services/observation-anomaly-assessments-query.service';
import { ViewObservationAnomalyAssessmentQueryDto } from '../dtos/view-observation-anomaly-assessment-query.dto';

@Controller('observation-anomaly-assessments')
export class ObservationAnomalyAssessmentsController {
  constructor(
    private readonly observationAnomalyAssessmentsQueryService: ObservationAnomalyAssessmentsQueryService,
  ) { }

  @Get()
  public find(@Query(AuthorisedStationsPipe) queryDto: ViewObservationAnomalyAssessmentQueryDto) {
    return this.observationAnomalyAssessmentsQueryService.find(queryDto);
  }

  @Get('count')
  public count(@Query(AuthorisedStationsPipe) queryDto: ViewObservationAnomalyAssessmentQueryDto) {
    return this.observationAnomalyAssessmentsQueryService.count(queryDto);
  }
}
