import { Component } from '@angular/core';
import { PagesDataService, ToastEventTypeEnum } from 'src/app/core/services/pages-data.service';

type AnomalySeverity = 'Critical' | 'High' | 'Medium' | 'Low';
type ReviewStatus = 'Pending Review' | 'In Review' | 'Approved' | 'Overridden' | 'Escalated';
type ReviewerDecision = 'Awaiting action' | 'Approve' | 'Override' | 'Escalate';

interface AnomalySignal {
  label: string;
  value: string;
}

interface AnomalyActivity {
  actor: string;
  action: string;
  timestamp: string;
}

interface AnomalyWorkItem {
  id: string;
  stationId: string;
  stationName: string;
  element: string;
  observedAt: string;
  anomalyType: string;
  severity: AnomalySeverity;
  confidence: number;
  aiModel: string;
  source: string;
  assignedTo: string;
  reviewStatus: ReviewStatus;
  reviewerDecision: ReviewerDecision;
  reviewerNotes: string;
  workflowSla: string;
  region: string;
  observationValue: string;
  baselineRange: string;
  recommendedAction: string;
  impactSummary: string;
  signals: AnomalySignal[];
  activity: AnomalyActivity[];
}

interface QueueFilters {
  search: string;
  severity: AnomalySeverity | 'All';
  reviewStatus: ReviewStatus | 'All';
  assignment: string;
  region: string;
  highConfidenceOnly: boolean;
}

@Component({
  selector: 'app-ai-anomaly-center',
  templateUrl: './ai-anomaly-center.component.html',
  styleUrls: ['./ai-anomaly-center.component.scss']
})
export class AiAnomalyCenterComponent {
  protected readonly reviewers: string[] = [
    'Unassigned',
    'D. Mokoena',
    'K. Ndlovu',
    'R. Phiri',
    'L. Dlamini'
  ];
  protected readonly severityOptions: Array<AnomalySeverity | 'All'> = ['All', 'Critical', 'High', 'Medium', 'Low'];
  protected readonly reviewStatusOptions: Array<ReviewStatus | 'All'> = [
    'All',
    'Pending Review',
    'In Review',
    'Approved',
    'Overridden',
    'Escalated'
  ];

  protected readonly anomalies: AnomalyWorkItem[] = [
    {
      id: 'ANM-24031',
      stationId: '67890',
      stationName: 'Maseru Airport',
      element: 'Rainfall',
      observedAt: '2026-03-18 06:00',
      anomalyType: 'Extreme spike versus station climatology',
      severity: 'Critical',
      confidence: 99,
      aiModel: 'FusionNet v3.4',
      source: 'AWS ingest stream',
      assignedTo: 'D. Mokoena',
      reviewStatus: 'In Review',
      reviewerDecision: 'Awaiting action',
      reviewerNotes: 'Cross-check against nearby gauges before final override. Satellite blend indicates lower accumulation.',
      workflowSla: '45 min remaining',
      region: 'Lowlands',
      observationValue: '118.4 mm / 1h',
      baselineRange: '3.1 to 14.8 mm / 1h',
      recommendedAction: 'Override to nearby-network consensus after instrument validation.',
      impactSummary: 'High-impact rainfall outlier likely to distort flash-flood nowcasting and daily climate products.',
      signals: [
        { label: 'Neighbour divergence', value: '+412%' },
        { label: 'Sensor drift score', value: '0.87' },
        { label: 'Recent maintenance', value: '12 days ago' }
      ],
      activity: [
        { actor: 'AI Engine', action: 'Flagged as spike anomaly', timestamp: '2026-03-18 06:03' },
        { actor: 'Rules Engine', action: 'Marked critical due to flood-product dependency', timestamp: '2026-03-18 06:04' },
        { actor: 'D. Mokoena', action: 'Started review', timestamp: '2026-03-18 06:16' }
      ]
    },
    {
      id: 'ANM-24028',
      stationId: '68112',
      stationName: 'Quthing',
      element: 'Temperature',
      observedAt: '2026-03-18 03:00',
      anomalyType: 'Step change after sensor reset',
      severity: 'High',
      confidence: 94,
      aiModel: 'Temporal Sentinel',
      source: 'Manual sync batch',
      assignedTo: 'R. Phiri',
      reviewStatus: 'Pending Review',
      reviewerDecision: 'Awaiting action',
      reviewerNotes: '',
      workflowSla: '2h 10m remaining',
      region: 'Southern',
      observationValue: '31.9 C',
      baselineRange: '17.2 to 24.6 C',
      recommendedAction: 'Inspect calibration event log and confirm if reset offset was applied.',
      impactSummary: 'Bias could affect heat index bulletins and station ranking reports.',
      signals: [
        { label: 'Shift magnitude', value: '+8.3 C' },
        { label: 'Persistence window', value: '4 records' },
        { label: 'Model agreement', value: '3/3 detectors' }
      ],
      activity: [
        { actor: 'AI Engine', action: 'Flagged abrupt level shift', timestamp: '2026-03-18 03:05' },
        { actor: 'Workflow', action: 'Queued for human review', timestamp: '2026-03-18 03:06' }
      ]
    },
    {
      id: 'ANM-24022',
      stationId: '67108',
      stationName: 'Mokhotlong',
      element: 'Wind Speed',
      observedAt: '2026-03-17 22:00',
      anomalyType: 'Flatline during active synoptic period',
      severity: 'High',
      confidence: 91,
      aiModel: 'FusionNet v3.4',
      source: 'Telemetry gateway',
      assignedTo: 'Unassigned',
      reviewStatus: 'Escalated',
      reviewerDecision: 'Escalate',
      reviewerNotes: 'Escalated to field operations for anemometer inspection and line diagnostics.',
      workflowSla: 'Escalated',
      region: 'Highlands',
      observationValue: '0.0 m/s for 9h',
      baselineRange: '4.2 to 17.5 m/s',
      recommendedAction: 'Escalate to maintenance team and suspend downstream exposure products.',
      impactSummary: 'Persistent zero wind values are inconsistent with synoptic pattern and likely indicate device failure.',
      signals: [
        { label: 'Flatline duration', value: '9 hours' },
        { label: 'Regional gust alerts', value: '6 nearby stations' },
        { label: 'Telemetry health', value: 'Intermittent' }
      ],
      activity: [
        { actor: 'AI Engine', action: 'Detected flatline anomaly', timestamp: '2026-03-17 22:10' },
        { actor: 'L. Dlamini', action: 'Escalated to field operations', timestamp: '2026-03-17 22:48' }
      ]
    },
    {
      id: 'ANM-24017',
      stationId: '67041',
      stationName: 'Butha-Buthe',
      element: 'Pressure',
      observedAt: '2026-03-17 18:00',
      anomalyType: 'Cross-station inconsistency',
      severity: 'Medium',
      confidence: 82,
      aiModel: 'Spatial Guard',
      source: 'AWS ingest stream',
      assignedTo: 'K. Ndlovu',
      reviewStatus: 'Approved',
      reviewerDecision: 'Approve',
      reviewerNotes: 'Passed review. Valid frontal passage confirmed from neighbouring stations and synoptic chart.',
      workflowSla: 'Closed',
      region: 'Northern',
      observationValue: '997.1 hPa',
      baselineRange: '1001.4 to 1007.9 hPa',
      recommendedAction: 'Approve if synoptic context supports transient drop.',
      impactSummary: 'Moderate discrepancy, but event context suggests legitimate weather-driven pressure fall.',
      signals: [
        { label: 'Neighbour spread', value: '5.6 hPa' },
        { label: 'Frontal probability', value: '78%' },
        { label: 'Historical rarity', value: '1 in 14 months' }
      ],
      activity: [
        { actor: 'AI Engine', action: 'Flagged spatial inconsistency', timestamp: '2026-03-17 18:04' },
        { actor: 'K. Ndlovu', action: 'Approved observation', timestamp: '2026-03-17 18:30' }
      ]
    },
    {
      id: 'ANM-24011',
      stationId: '67320',
      stationName: 'Semonkong',
      element: 'Humidity',
      observedAt: '2026-03-17 12:00',
      anomalyType: 'Model disagreement on low humidity event',
      severity: 'Low',
      confidence: 74,
      aiModel: 'Ensemble Review',
      source: 'Manual sync batch',
      assignedTo: 'Unassigned',
      reviewStatus: 'Overridden',
      reviewerDecision: 'Override',
      reviewerNotes: 'Operator override accepted. Low humidity trace matched manual field sheet and station metadata note.',
      workflowSla: 'Closed',
      region: 'Foothills',
      observationValue: '14%',
      baselineRange: '24% to 61%',
      recommendedAction: 'Override only when manual field validation is present.',
      impactSummary: 'Low-severity anomaly with mixed model confidence and manual corroboration.',
      signals: [
        { label: 'Detector split', value: '2 of 4 agree' },
        { label: 'Manual sheet', value: 'Available' },
        { label: 'Instrument class', value: 'Legacy probe' }
      ],
      activity: [
        { actor: 'AI Engine', action: 'Flagged ensemble disagreement', timestamp: '2026-03-17 12:12' },
        { actor: 'R. Phiri', action: 'Overrode anomaly', timestamp: '2026-03-17 12:44' }
      ]
    }
  ];

  protected filters: QueueFilters = {
    search: '',
    severity: 'All',
    reviewStatus: 'All',
    assignment: 'All',
    region: 'All',
    highConfidenceOnly: false
  };
  protected selectedAnomalyId: string = this.anomalies[0].id;
  protected noteDraft: string = this.anomalies[0].reviewerNotes;

  constructor(private pagesDataService: PagesDataService) {
    this.pagesDataService.setPageHeader('AI Anomaly Center');
  }

  protected get regionOptions(): string[] {
    return ['All', ...new Set(this.anomalies.map(anomaly => anomaly.region))];
  }

  protected get assignmentOptions(): string[] {
    return ['All', ...this.reviewers];
  }

  protected get selectedAnomaly(): AnomalyWorkItem | undefined {
    return this.anomalies.find(anomaly => anomaly.id === this.selectedAnomalyId);
  }

  protected get filteredAnomalies(): AnomalyWorkItem[] {
    return this.anomalies.filter(anomaly => {
      const searchValue = this.filters.search.trim().toLowerCase();
      const matchesSearch = searchValue.length === 0
        || anomaly.id.toLowerCase().includes(searchValue)
        || anomaly.stationName.toLowerCase().includes(searchValue)
        || anomaly.stationId.toLowerCase().includes(searchValue)
        || anomaly.element.toLowerCase().includes(searchValue)
        || anomaly.anomalyType.toLowerCase().includes(searchValue);
      const matchesSeverity = this.filters.severity === 'All' || anomaly.severity === this.filters.severity;
      const matchesStatus = this.filters.reviewStatus === 'All' || anomaly.reviewStatus === this.filters.reviewStatus;
      const matchesAssignment = this.filters.assignment === 'All' || anomaly.assignedTo === this.filters.assignment;
      const matchesRegion = this.filters.region === 'All' || anomaly.region === this.filters.region;
      const matchesConfidence = !this.filters.highConfidenceOnly || anomaly.confidence >= 90;

      return matchesSearch && matchesSeverity && matchesStatus && matchesAssignment && matchesRegion && matchesConfidence;
    });
  }

  protected get pendingCount(): number {
    return this.anomalies.filter(anomaly => anomaly.reviewStatus === 'Pending Review' || anomaly.reviewStatus === 'In Review').length;
  }

  protected get escalatedCount(): number {
    return this.anomalies.filter(anomaly => anomaly.reviewStatus === 'Escalated').length;
  }

  protected get approvalRate(): number {
    const closedItems = this.anomalies.filter(anomaly =>
      anomaly.reviewStatus === 'Approved' || anomaly.reviewStatus === 'Overridden'
    );

    if (closedItems.length === 0) {
      return 0;
    }

    const approved = closedItems.filter(anomaly => anomaly.reviewStatus === 'Approved').length;
    return Math.round((approved / closedItems.length) * 100);
  }

  protected get averageConfidence(): number {
    const totalConfidence = this.anomalies.reduce((sum, anomaly) => sum + anomaly.confidence, 0);
    return Math.round(totalConfidence / this.anomalies.length);
  }

  protected get criticalExposureCount(): number {
    return this.anomalies.filter(anomaly => anomaly.severity === 'Critical' || anomaly.severity === 'High').length;
  }

  protected selectAnomaly(anomalyId: string): void {
    this.selectedAnomalyId = anomalyId;
    const anomaly = this.selectedAnomaly;
    this.noteDraft = anomaly ? anomaly.reviewerNotes : '';
  }

  protected assignSelected(reviewer: string): void {
    const anomaly = this.selectedAnomaly;
    if (!anomaly) {
      return;
    }

    anomaly.assignedTo = reviewer;
    if (anomaly.reviewStatus === 'Pending Review' && reviewer !== 'Unassigned') {
      anomaly.reviewStatus = 'In Review';
    }

    this.recordActivity(anomaly, 'Workflow Manager', `Assigned case to ${reviewer}`);
    this.pagesDataService.showToast({
      title: 'AI Anomaly Center',
      message: `${anomaly.id} assigned to ${reviewer}.`,
      type: ToastEventTypeEnum.SUCCESS
    });
  }

  protected saveNotes(): void {
    const anomaly = this.selectedAnomaly;
    if (!anomaly) {
      return;
    }

    anomaly.reviewerNotes = this.noteDraft.trim();
    this.recordActivity(anomaly, 'Reviewer', 'Updated reviewer notes');
    this.pagesDataService.showToast({
      title: 'AI Anomaly Center',
      message: `Reviewer notes saved for ${anomaly.id}.`,
      type: ToastEventTypeEnum.SUCCESS
    });
  }

  protected approveSelected(): void {
    this.applyDecision('Approved', 'Approve', 'Approved anomaly and released observation.');
  }

  protected overrideSelected(): void {
    this.applyDecision('Overridden', 'Override', 'Overrode anomaly after manual validation.');
  }

  protected escalateSelected(): void {
    this.applyDecision('Escalated', 'Escalate', 'Escalated anomaly to field operations.');
  }

  protected getSeverityClass(severity: AnomalySeverity): string {
    switch (severity) {
      case 'Critical':
        return 'severity-critical';
      case 'High':
        return 'severity-high';
      case 'Medium':
        return 'severity-medium';
      case 'Low':
        return 'severity-low';
    }
  }

  protected getStatusClass(status: ReviewStatus): string {
    switch (status) {
      case 'Pending Review':
        return 'status-pending';
      case 'In Review':
        return 'status-review';
      case 'Approved':
        return 'status-approved';
      case 'Overridden':
        return 'status-overridden';
      case 'Escalated':
        return 'status-escalated';
    }
  }

  private applyDecision(
    reviewStatus: ReviewStatus,
    reviewerDecision: ReviewerDecision,
    toastMessage: string
  ): void {
    const anomaly = this.selectedAnomaly;
    if (!anomaly) {
      return;
    }

    anomaly.reviewerNotes = this.noteDraft.trim();
    anomaly.reviewStatus = reviewStatus;
    anomaly.reviewerDecision = reviewerDecision;
    anomaly.workflowSla = reviewStatus === 'Escalated' ? 'Escalated' : 'Closed';
    if (anomaly.assignedTo === 'Unassigned') {
      anomaly.assignedTo = 'D. Mokoena';
    }

    this.recordActivity(anomaly, anomaly.assignedTo, toastMessage);
    this.pagesDataService.showToast({
      title: 'AI Anomaly Center',
      message: `${anomaly.id}: ${toastMessage}`,
      type: ToastEventTypeEnum.SUCCESS
    });
  }

  private recordActivity(anomaly: AnomalyWorkItem, actor: string, action: string): void {
    anomaly.activity = [
      {
        actor,
        action,
        timestamp: this.getCurrentTimestamp()
      },
      ...anomaly.activity
    ];
  }

  private getCurrentTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    const hours = `${now.getHours()}`.padStart(2, '0');
    const minutes = `${now.getMinutes()}`.padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }
}
