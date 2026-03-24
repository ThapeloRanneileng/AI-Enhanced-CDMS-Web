import { Injectable } from '@nestjs/common';
import { ObservationEntity } from 'src/observation/entities/observation.entity';

export interface ObservationAnomalyModelDescriptor {
  modelId: string;
  modelFamily: string;
  modelVersion: string;
  supportsInference: boolean;
  candidateModelFamilies: string[];
}

@Injectable()
export class AnomalyModelRegistryService {
  public resolveModel(observation: ObservationEntity): ObservationAnomalyModelDescriptor {
    return {
      modelId: `default-${observation.elementId}-${observation.interval}`,
      modelFamily: 'seasonal_gaussian_ensemble',
      modelVersion: '0.2.0',
      supportsInference: true,
      candidateModelFamilies: [
        'seasonal_gaussian_ensemble',
        'isolation_forest',
        'one_class_svm',
        'autoencoder',
      ],
    };
  }
}
