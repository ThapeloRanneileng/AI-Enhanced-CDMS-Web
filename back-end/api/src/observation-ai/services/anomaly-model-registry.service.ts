import { Injectable } from '@nestjs/common';
import { ObservationEntity } from 'src/observation/entities/observation.entity';

export interface ObservationAnomalyModelDescriptor {
  modelId: string;
  modelVersion: string;
  supportsInference: boolean;
}

@Injectable()
export class AnomalyModelRegistryService {
  public resolveModel(observation: ObservationEntity): ObservationAnomalyModelDescriptor {
    return {
      modelId: `default-${observation.elementId}-${observation.interval}`,
      modelVersion: '0.1.0',
      supportsInference: true,
    };
  }
}
