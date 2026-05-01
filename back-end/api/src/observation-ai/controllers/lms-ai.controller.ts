import { Body, Controller, ForbiddenException, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthorisedStationsPipe } from 'src/user/pipes/authorised-stations.pipe';
import { AuthUtil } from 'src/user/services/auth.util';
import { LmsAiQueryDto } from '../dtos/lms-ai-query.dto';
import { LmsAiOutputService } from '../services/lms-ai-output.service';
import { ReviewerDecisionDto } from '../dtos/reviewer-decision.dto';
import { ReviewerDecisionService } from '../services/reviewer-decision.service';
import { AuditService } from 'src/audit/audit.service';

@Controller('lms-ai')
export class LmsAiController {
  constructor(
    private readonly lmsAiOutputService: LmsAiOutputService,
    private readonly reviewerDecisionService: ReviewerDecisionService,
    private readonly auditService: AuditService,
  ) { }

  @Get('status')
  public status(@Req() request: Request) {
    return this.lmsAiOutputService.getStatus(this.hasBroadLmsReportAccess(request));
  }

  @Get('qc-review')
  public qcReview(@Query(AuthorisedStationsPipe) query: LmsAiQueryDto) {
    return this.lmsAiOutputService.getQcReview(query);
  }

  @Get('qc-assessments')
  public qcAssessments(@Query(AuthorisedStationsPipe) query: LmsAiQueryDto) {
    return this.lmsAiOutputService.getQcAssessments(query);
  }

  @Get('assessments')
  public assessments(@Query(AuthorisedStationsPipe) query: LmsAiQueryDto) {
    return this.lmsAiOutputService.getQcAssessments(query);
  }

  @Get('agent-insights')
  public agentInsights(@Query(AuthorisedStationsPipe) query: LmsAiQueryDto) {
    return this.lmsAiOutputService.getAgentInsights(query);
  }

  @Get('model-summary')
  public modelSummary(@Req() request: Request) {
    this.assertBroadLmsReportAccess(request);
    return this.lmsAiOutputService.getModelSummary();
  }

  @Get('manifest')
  public manifest(@Req() request: Request) {
    this.assertBroadLmsReportAccess(request);
    return this.lmsAiOutputService.getManifest();
  }

  @Get('supervisor-summary')
  public supervisorSummary(@Req() request: Request) {
    this.assertBroadLmsReportAccess(request);
    return this.lmsAiOutputService.getSupervisorSummary();
  }

  @Get('genai-summary')
  public genAiSummary(@Req() request: Request) {
    this.assertBroadLmsReportAccess(request);
    return this.lmsAiOutputService.getGenAiSummary();
  }

  @Get('genai-reviewer-explanations')
  public genAiReviewerExplanations(@Query(AuthorisedStationsPipe) query: LmsAiQueryDto) {
    return this.lmsAiOutputService.getGenAiReviewerExplanations(query);
  }

  @Get('ensemble')
  public ensemble(@Query(AuthorisedStationsPipe) query: LmsAiQueryDto) {
    return this.lmsAiOutputService.getEnsemble(query);
  }

  @Get('normalized-observations')
  public normalizedObservations(@Query(AuthorisedStationsPipe) query: LmsAiQueryDto) {
    return this.lmsAiOutputService.getNormalizedObservations(query);
  }

  @Get('rejected-records')
  public rejectedRecords(@Query(AuthorisedStationsPipe) query: LmsAiQueryDto) {
    return this.lmsAiOutputService.getRejectedRecords(query);
  }

  @Get('predictions')
  public predictions(@Query(AuthorisedStationsPipe) query: LmsAiQueryDto) {
    return this.lmsAiOutputService.getPredictions(query);
  }

  @Post('reviewer-decisions')
  public async recordReviewerDecision(@Req() request: Request, @Body() dto: ReviewerDecisionDto) {
    const user = AuthUtil.getLoggedInUser(request);
    this.auditService.log({
      userId: user.id,
      userEmail: user.email,
      action: 'QC_DECISION',
      resourceType: 'qc_review',
      resourceId: dto.assessmentId?.toString() ?? undefined,
      newValue: { decision: dto.decision, reasonCode: dto.reasonCode, comment: dto.comment },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    const saved = await this.reviewerDecisionService.save(dto, user.id);
    return { id: saved.id, decision: saved.decision, reviewedAt: saved.reviewedAt };
  }

  @Get('decision-stats')
  public async decisionStats(@Req() request: Request) {
    const user = AuthUtil.getSessionUser(request);
    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }
    return this.reviewerDecisionService.getDecisionStats();
  }

  private assertBroadLmsReportAccess(request: Request): void {
    if (!this.hasBroadLmsReportAccess(request)) {
      throw new ForbiddenException('Not authorised to access aggregate LMS reports');
    }
  }

  private hasBroadLmsReportAccess(request: Request): boolean {
    const user = AuthUtil.getSessionUser(request);
    if (!user) return false;
    if (AuthUtil.sessionUserIsAdmin(request)) return true;
    return !!user.permissions?.qcPermissions && !user.permissions.qcPermissions.stationIds;
  }
}
