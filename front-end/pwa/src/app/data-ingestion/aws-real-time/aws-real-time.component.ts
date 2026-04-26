import { Component } from '@angular/core';
import { PagesDataService, ToastEventTypeEnum } from 'src/app/core/services/pages-data.service';
import { LocalStorageService } from 'src/app/shared/services/local-storage.service';

type AwsRealTimeSection = 'processing' | 'servers' | 'sites' | 'structures' | 'encoding';
type AwsServerMode = 'base-station' | 'message-switch';
type AwsTransferMode = 'ftp' | 'sftp';
type AwsSiteStatus = 'active' | 'paused' | 'draft';
type AwsEncodingForwardMode = 'shared-pipeline' | 'archive-only' | 'forward-and-store';

interface AwsProcessingConfig {
  pollingIntervalMinutes: number;
  batchWindowMinutes: number;
  autoCreateReviewQueue: boolean;
  retryFailedTransfers: boolean;
  defaultMissingDataFlag: string;
  sharedObservationSourceLabel: string;
}

interface AwsServerConfig {
  id: string;
  name: string;
  mode: AwsServerMode;
  transferMode: AwsTransferMode;
  address: string;
  inputFolder: string;
  username: string;
  password: string;
  confirmPassword: string;
  enabled: boolean;
}

interface AwsSiteConfig {
  id: string;
  siteId: string;
  siteName: string;
  inputDataFile: string;
  dataStructureId: string;
  missingDataFlag: string;
  serverId: string;
  status: AwsSiteStatus;
  stationId: string;
  operationalNotes: string;
}

interface AwsDataStructureConfig {
  id: string;
  name: string;
  filePattern: string;
  delimiter: string;
  headerRow: number;
  datetimeColumn: string;
  stationColumn: string;
  valueColumn: string;
  elementColumn: string;
  intervalColumn: string;
  levelColumn: string;
  notes: string;
}

interface AwsEncodingOptions {
  messageFormat: string;
  stationPrefix: string;
  timezoneHandling: string;
  forwardMode: AwsEncodingForwardMode;
  includeChecksum: boolean;
  includeStationMetadata: boolean;
}

interface AwsRealTimeState {
  processing: AwsProcessingConfig;
  servers: AwsServerConfig[];
  sites: AwsSiteConfig[];
  structures: AwsDataStructureConfig[];
  encoding: AwsEncodingOptions;
}

const STORAGE_KEY = 'aws_real_time_configuration';

@Component({
  selector: 'app-aws-real-time',
  templateUrl: './aws-real-time.component.html',
  styleUrls: ['./aws-real-time.component.scss']
})
export class AwsRealTimeComponent {
  protected readonly sections: Array<{ id: AwsRealTimeSection; label: string; icon: string }> = [
    { id: 'processing', label: 'Processing', icon: 'bi-cpu' },
    { id: 'servers', label: 'Servers', icon: 'bi-hdd-network' },
    { id: 'sites', label: 'Sites', icon: 'bi-broadcast-pin' },
    { id: 'structures', label: 'Data Structures', icon: 'bi-diagram-3' },
    { id: 'encoding', label: 'Encoding Options', icon: 'bi-code-slash' },
  ];
  protected activeSection: AwsRealTimeSection = 'processing';

  protected processing: AwsProcessingConfig = this.getDefaultProcessing();
  protected servers: AwsServerConfig[] = [];
  protected sites: AwsSiteConfig[] = [];
  protected structures: AwsDataStructureConfig[] = [];
  protected encoding: AwsEncodingOptions = this.getDefaultEncoding();

  protected serverDraft: AwsServerConfig = this.createServerDraft();
  protected siteDraft: AwsSiteConfig = this.createSiteDraft();
  protected structureDraft: AwsDataStructureConfig = this.createStructureDraft();

  protected editingServerId: string | null = null;
  protected editingSiteId: string | null = null;
  protected editingStructureId: string | null = null;

  constructor(
    private pagesDataService: PagesDataService,
    private localStorageService: LocalStorageService,
  ) {
    this.pagesDataService.setPageHeader('AWS Real Time');
    this.loadState();
  }

  protected setActiveSection(section: AwsRealTimeSection): void {
    this.activeSection = section;
  }

  protected saveProcessing(): void {
    this.persistState('AWS Real Time processing settings saved.');
  }

  protected saveEncoding(): void {
    this.persistState('AWS Real Time encoding options saved.');
  }

  protected saveServer(): void {
    if (!this.serverDraft.name || !this.serverDraft.address || !this.serverDraft.inputFolder) {
      this.showError('Server name, server address, and input folder are required.');
      return;
    }

    if (this.serverDraft.password !== this.serverDraft.confirmPassword) {
      this.showError('Server password confirmation does not match.');
      return;
    }

    const draft = { ...this.serverDraft };
    if (this.editingServerId) {
      this.servers = this.servers.map(server => server.id === this.editingServerId ? draft : server);
    } else {
      this.servers = [draft, ...this.servers];
    }

    this.persistState('AWS Real Time server settings saved.');
    this.resetServerDraft();
  }

  protected editServer(server: AwsServerConfig): void {
    this.serverDraft = { ...server };
    this.editingServerId = server.id;
    this.activeSection = 'servers';
  }

  protected removeServer(serverId: string): void {
    this.servers = this.servers.filter(server => server.id !== serverId);
    this.sites = this.sites.map(site => site.serverId === serverId ? { ...site, serverId: '' } : site);
    this.persistState('AWS Real Time server removed.');
    if (this.editingServerId === serverId) {
      this.resetServerDraft();
    }
  }

  protected cancelServerEdit(): void {
    this.resetServerDraft();
  }

  protected saveSite(): void {
    if (!this.siteDraft.siteId || !this.siteDraft.siteName || !this.siteDraft.serverId || !this.siteDraft.dataStructureId) {
      this.showError('Site ID, site name, server, and data structure are required.');
      return;
    }

    const draft = { ...this.siteDraft };
    if (this.editingSiteId) {
      this.sites = this.sites.map(site => site.id === this.editingSiteId ? draft : site);
    } else {
      this.sites = [draft, ...this.sites];
    }

    this.persistState('AWS Real Time site configuration saved.');
    this.resetSiteDraft();
  }

  protected editSite(site: AwsSiteConfig): void {
    this.siteDraft = { ...site };
    this.editingSiteId = site.id;
    this.activeSection = 'sites';
  }

  protected removeSite(siteId: string): void {
    this.sites = this.sites.filter(site => site.id !== siteId);
    this.persistState('AWS Real Time site configuration removed.');
    if (this.editingSiteId === siteId) {
      this.resetSiteDraft();
    }
  }

  protected cancelSiteEdit(): void {
    this.resetSiteDraft();
  }

  protected saveStructure(): void {
    if (!this.structureDraft.name || !this.structureDraft.filePattern || !this.structureDraft.stationColumn || !this.structureDraft.valueColumn) {
      this.showError('Structure name, file pattern, station column, and value column are required.');
      return;
    }

    const draft = { ...this.structureDraft };
    if (this.editingStructureId) {
      this.structures = this.structures.map(structure => structure.id === this.editingStructureId ? draft : structure);
    } else {
      this.structures = [draft, ...this.structures];
    }

    this.persistState('AWS Real Time data structure saved.');
    this.resetStructureDraft();
  }

  protected editStructure(structure: AwsDataStructureConfig): void {
    this.structureDraft = { ...structure };
    this.editingStructureId = structure.id;
    this.activeSection = 'structures';
  }

  protected removeStructure(structureId: string): void {
    this.structures = this.structures.filter(structure => structure.id !== structureId);
    this.sites = this.sites.map(site => site.dataStructureId === structureId ? { ...site, dataStructureId: '' } : site);
    this.persistState('AWS Real Time data structure removed.');
    if (this.editingStructureId === structureId) {
      this.resetStructureDraft();
    }
  }

  protected cancelStructureEdit(): void {
    this.resetStructureDraft();
  }

  protected getSectionCount(section: AwsRealTimeSection): number | null {
    switch (section) {
      case 'servers':
        return this.servers.length;
      case 'sites':
        return this.sites.length;
      case 'structures':
        return this.structures.length;
      default:
        return null;
    }
  }

  protected getServerName(serverId: string): string {
    return this.servers.find(server => server.id === serverId)?.name ?? 'Not linked';
  }

  protected getStructureName(structureId: string): string {
    return this.structures.find(structure => structure.id === structureId)?.name ?? 'Not linked';
  }

  private loadState(): void {
    const saved = this.localStorageService.getItem<AwsRealTimeState>(STORAGE_KEY);
    if (!saved) {
      this.seedDefaults();
      return;
    }

    this.processing = saved.processing ?? this.getDefaultProcessing();
    this.servers = saved.servers ?? [];
    this.sites = saved.sites ?? [];
    this.structures = saved.structures ?? [];
    this.encoding = saved.encoding ?? this.getDefaultEncoding();
  }

  private seedDefaults(): void {
    const defaultStructure = {
      ...this.createStructureDraft(),
      id: this.generateId('struct'),
      name: 'Standard AWS Delimited Feed',
      filePattern: '*.csv',
      delimiter: ',',
      headerRow: 1,
      datetimeColumn: 'datetime',
      stationColumn: 'station_id',
      valueColumn: 'value',
      elementColumn: 'element',
      intervalColumn: 'interval',
      levelColumn: 'level',
      notes: 'Default structure for shared observation-pipeline row-based AWS imports.',
    };
    const defaultServer = {
      ...this.createServerDraft(),
      id: this.generateId('server'),
      name: 'Primary AWS Gateway',
      mode: 'base-station' as AwsServerMode,
      transferMode: 'sftp' as AwsTransferMode,
      address: 'sftp.example.org',
      inputFolder: '/incoming/aws',
      username: 'aws_ingest',
      password: '',
      confirmPassword: '',
      enabled: true,
    };
    const defaultSite = {
      ...this.createSiteDraft(),
      id: this.generateId('site'),
      siteId: 'AWS-001',
      siteName: 'Primary Automatic Weather Station',
      inputDataFile: 'aws_primary_*.csv',
      dataStructureId: defaultStructure.id,
      missingDataFlag: '-9999',
      serverId: defaultServer.id,
      status: 'active' as AwsSiteStatus,
      stationId: 'AWS001',
      operationalNotes: 'Shared pipeline import enabled with review-queue handoff.',
    };

    this.structures = [defaultStructure];
    this.servers = [defaultServer];
    this.sites = [defaultSite];
    this.persistState('AWS Real Time workspace initialized.');
  }

  private persistState(message: string): void {
    this.localStorageService.setItem<AwsRealTimeState>(STORAGE_KEY, {
      processing: this.processing,
      servers: this.servers,
      sites: this.sites,
      structures: this.structures,
      encoding: this.encoding,
    });

    this.pagesDataService.showToast({
      title: 'AWS Real Time',
      message,
      type: ToastEventTypeEnum.SUCCESS,
    });
  }

  private showError(message: string): void {
    this.pagesDataService.showToast({
      title: 'AWS Real Time',
      message,
      type: ToastEventTypeEnum.ERROR,
    });
  }

  private resetServerDraft(): void {
    this.serverDraft = this.createServerDraft();
    this.editingServerId = null;
  }

  private resetSiteDraft(): void {
    this.siteDraft = this.createSiteDraft();
    this.editingSiteId = null;
  }

  private resetStructureDraft(): void {
    this.structureDraft = this.createStructureDraft();
    this.editingStructureId = null;
  }

  private createServerDraft(): AwsServerConfig {
    return {
      id: this.generateId('server'),
      name: '',
      mode: 'base-station',
      transferMode: 'sftp',
      address: '',
      inputFolder: '',
      username: '',
      password: '',
      confirmPassword: '',
      enabled: true,
    };
  }

  private createSiteDraft(): AwsSiteConfig {
    return {
      id: this.generateId('site'),
      siteId: '',
      siteName: '',
      inputDataFile: '',
      dataStructureId: '',
      missingDataFlag: '-9999',
      serverId: '',
      status: 'draft',
      stationId: '',
      operationalNotes: '',
    };
  }

  private createStructureDraft(): AwsDataStructureConfig {
    return {
      id: this.generateId('struct'),
      name: '',
      filePattern: '',
      delimiter: ',',
      headerRow: 1,
      datetimeColumn: '',
      stationColumn: '',
      valueColumn: '',
      elementColumn: 'element',
      intervalColumn: 'interval',
      levelColumn: 'level',
      notes: '',
    };
  }

  private getDefaultProcessing(): AwsProcessingConfig {
    return {
      pollingIntervalMinutes: 15,
      batchWindowMinutes: 60,
      autoCreateReviewQueue: true,
      retryFailedTransfers: true,
      defaultMissingDataFlag: '-9999',
      sharedObservationSourceLabel: 'AWS Real Time',
    };
  }

  private getDefaultEncoding(): AwsEncodingOptions {
    return {
      messageFormat: 'Delimited UTF-8',
      stationPrefix: 'AWS',
      timezoneHandling: 'Normalize to UTC before observation import',
      forwardMode: 'shared-pipeline',
      includeChecksum: false,
      includeStationMetadata: true,
    };
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
