import 'reflect-metadata';
import { ArgumentMetadata } from '@nestjs/common';
import { ViewObservationAnomalyAssessmentQueryDto } from 'src/observation-ai/dtos/view-observation-anomaly-assessment-query.dto';
import { AuthorisedStationsPipe } from './authorised-stations.pipe';

describe('AuthorisedStationsPipe', () => {
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ViewObservationAnomalyAssessmentQueryDto,
  };

  it('authorises the controller-prefixed anomaly review workspace route with QC permissions', () => {
    const request = {
      route: { path: '/observation-anomaly-assessments/review-workspace' },
      session: {
        user: {
          isSystemAdmin: false,
          permissions: {
            qcPermissions: {
              stationIds: ['LESBUT1'],
            },
          },
        },
      },
    };
    const pipe = new AuthorisedStationsPipe(request as any);
    const query = {};

    expect(pipe.transform(query, metadata)).toEqual({ stationIds: ['LESBUT1'] });
  });
});
