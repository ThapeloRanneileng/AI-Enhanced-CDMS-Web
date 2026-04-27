import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, take, takeUntil } from 'rxjs';
import { LoggedInUserModel } from 'src/app/admin/users/models/logged-in-user.model';
import { AppAuthService } from 'src/app/app-auth.service';
import { PagesDataService } from 'src/app/core/services/pages-data.service';
import { ViewExportSpecificationModel } from 'src/app/metadata/export-specifications/models/view-export-specification.model';
import { ExportSpecificationsService } from 'src/app/metadata/export-specifications/services/export-specifications.service';
import { LmsAiGenAiSummary, LmsAiService, LmsAiStatus } from 'src/app/quality-control/services/lms-ai.service';

interface SupervisorSummarySection {
  title: string;
  lines: string[];
}

@Component({
  selector: 'app-manual-export-selection',
  templateUrl: './manual-export-selection.component.html',
  styleUrls: ['./manual-export-selection.component.scss']
})
export class ManualExportSelectionComponent implements OnDestroy {
  protected exports!: ViewExportSpecificationModel[];
  protected lmsAiStatus: LmsAiStatus | null = null;
  protected lmsSupervisorSummary = '';
  protected lmsSupervisorSummarySections: SupervisorSummarySection[] = [];
  protected lmsGenAiSummary: LmsAiGenAiSummary | null = null;
  protected lmsGenAiReviewerExplanationCount = 0;
  protected readonly supervisorSummarySectionTitles = [
    'Pipeline Run Overview',
    'Data Ingestion Summary',
    'AI Model Summary',
    'Autoencoder Calibration Summary',
    'Anomaly Review Summary',
    'Highest-Risk Stations and Elements',
    'QC Review Handoff Summary',
    'Interpretation Notes',
    'Next Recommended Actions',
  ];
  private destroy$ = new Subject<void>();

  constructor(
    private pagesDataService: PagesDataService,
    private appAuthService: AppAuthService,
    private exportTemplateService: ExportSpecificationsService,
    private lmsAiService: LmsAiService,
    private router: Router,
    private route: ActivatedRoute,) {
    this.pagesDataService.setPageHeader('Select Export');

    this.appAuthService.user.pipe(
      takeUntil(this.destroy$),
    ).subscribe(user => {
      if (!user) {
        throw new Error('User not logged in');
      }

      if (user.isSystemAdmin || (user.permissions && user.permissions.exportPermissions)) {
        this.exportTemplateService.findAll().pipe(
          take(1)
        ).subscribe(data => {
          this.exports = this.filterOutPermittedExports(user, data);          
        });
      } else {
        throw new Error('User not allowed to export data');
      }
    });
    this.loadLmsReports();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // TODO. Temporary fix. This should be done at the server level
  protected filterOutPermittedExports(user: LoggedInUserModel, exports: ViewExportSpecificationModel[]): ViewExportSpecificationModel[] {

    if (user.isSystemAdmin) return exports;
    if (!user.permissions) return [];
    if (user.permissions.exportPermissions) {
      const templateIds = user.permissions.exportPermissions.exportTemplateIds;
      if (templateIds) {
        exports = exports.filter(item => templateIds.includes(item.id));
      }
      return exports;
    } else {
      return [];
    }

  }

  protected onSearch(): void { }

  protected onExportClick(source: ViewExportSpecificationModel): void {
    this.router.navigate(['manual-export-download', source.id], { relativeTo: this.route.parent });
  }

  protected get lmsManifest(): any {
    return this.lmsAiStatus?.manifest ?? {};
  }

  protected get lmsGenAiProvider(): string {
    return this.lmsGenAiSummary?.provider || this.lmsAiStatus?.genaiProvider || this.lmsManifest.genaiProvider || 'Not available';
  }

  private loadLmsReports(): void {
    this.lmsAiService.status().pipe(take(1)).subscribe({
      next: status => this.lmsAiStatus = status,
      error: () => this.lmsAiStatus = null,
    });
    this.lmsAiService.supervisorSummary().pipe(take(1)).subscribe({
      next: report => {
        this.lmsSupervisorSummary = report.content;
        this.lmsSupervisorSummarySections = this.parseSupervisorSummary(report.content);
      },
      error: () => this.lmsSupervisorSummary = '',
    });
    this.lmsAiService.genAiSummary().pipe(take(1)).subscribe({
      next: report => this.lmsGenAiSummary = report,
      error: () => this.lmsGenAiSummary = null,
    });
    this.lmsAiService.genAiReviewerExplanations({ limit: 1 }).pipe(take(1)).subscribe({
      next: result => this.lmsGenAiReviewerExplanationCount = result.total,
      error: () => this.lmsGenAiReviewerExplanationCount = 0,
    });
  }

  private parseSupervisorSummary(markdown: string): SupervisorSummarySection[] {
    const sections = new Map<string, string[]>();
    let currentTitle = '';

    (markdown || '').replace(/\\n/g, '\n').split(/\r?\n/).forEach(rawLine => {
      const line = rawLine.trim();
      if (!line || line.startsWith('# LMS Supervisor Summary')) return;
      const headingMatch = line.match(/^##\s+(.+)$/);
      if (headingMatch) {
        currentTitle = headingMatch[1].trim();
        sections.set(currentTitle, []);
        return;
      }
      if (currentTitle) sections.get(currentTitle)?.push(line.replace(/^-\s*/, ''));
    });

    return this.supervisorSummarySectionTitles.map(title => ({
      title,
      lines: sections.get(title) ?? [],
    }));
  }

}
