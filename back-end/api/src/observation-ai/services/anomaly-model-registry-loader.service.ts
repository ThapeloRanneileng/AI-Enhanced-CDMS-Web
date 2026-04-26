import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AnomalyModelPersistenceService } from './anomaly-model-persistence.service';
import { AnomalyModelRegistryService } from './anomaly-model-registry.service';

@Injectable()
export class AnomalyModelRegistryLoaderService implements OnModuleInit {
  private readonly logger = new Logger(AnomalyModelRegistryLoaderService.name);

  constructor(
    private modelPersistenceService: AnomalyModelPersistenceService,
    private modelRegistryService: AnomalyModelRegistryService,
  ) { }

  public async onModuleInit(): Promise<void> {
    await this.modelPersistenceService.ensureTables();
    const models = await this.modelPersistenceService.loadPersistedModels();

    for (const model of models) {
      this.modelRegistryService.registerModel(model);
    }

    this.logger.log(`Loaded ${models.length} persisted anomaly model(s) into registry`);
  }
}
