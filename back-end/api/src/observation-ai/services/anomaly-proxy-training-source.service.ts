import { Injectable } from '@nestjs/common';
import { SUPPORTED_ANOMALY_ELEMENT_CODES, SupportedAnomalyElementCode } from './anomaly-training-data-preparation.service';

export type ProxyTrainingSourceName = 'era5' | 'era5_land' | 'ghcn_daily' | 'chirps' | 'meteostat';

export interface ProxyTrainingSourceDescriptor {
  name: ProxyTrainingSourceName;
  cadence: 'hourly' | 'daily' | 'monthly';
  supportedElementCodes: SupportedAnomalyElementCode[];
  role: string;
  replacementStrategy: string;
}

@Injectable()
export class AnomalyProxyTrainingSourceService {
  public listProxySources(): ProxyTrainingSourceDescriptor[] {
    return [
      {
        name: 'era5',
        cadence: 'hourly',
        supportedElementCodes: ['TEMP', 'RH', 'PRES', 'WS', 'WD'],
        role: 'Proxy atmospheric training data for hourly model bootstrapping.',
        replacementStrategy: 'Replace or fine-tune with LMS shared-observation history when available.',
      },
      {
        name: 'era5_land',
        cadence: 'hourly',
        supportedElementCodes: ['TEMP', 'RN'],
        role: 'Proxy near-surface climate features where station history is sparse.',
        replacementStrategy: 'Use only as cold-start support once LMS station history is available.',
      },
      {
        name: 'ghcn_daily',
        cadence: 'daily',
        supportedElementCodes: ['TEMP', 'RN'],
        role: 'Station-style daily proxy training data.',
        replacementStrategy: 'Replace with LMS daily station observations by station group.',
      },
      {
        name: 'chirps',
        cadence: 'daily',
        supportedElementCodes: ['RN'],
        role: 'Rainfall-focused proxy data for daily and monthly precipitation models.',
        replacementStrategy: 'Fine-tune against LMS rainfall observations and local gauge history.',
      },
      {
        name: 'meteostat',
        cadence: 'daily',
        supportedElementCodes: [...SUPPORTED_ANOMALY_ELEMENT_CODES],
        role: 'Fast prototype/demo proxy source when full public-data ingestion is unavailable.',
        replacementStrategy: 'Remove from production training once curated LMS or public reanalysis datasets are configured.',
      },
    ];
  }
}
