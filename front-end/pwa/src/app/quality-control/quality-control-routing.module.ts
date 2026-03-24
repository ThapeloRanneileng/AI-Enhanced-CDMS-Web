import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SourceChecksComponent } from './source-checks/source-checks.component';
import { QCAssessmentComponent } from './qc-data-checks/qc-assessment.component';
import { AiAnomalyCenterComponent } from './ai-anomaly-center/ai-anomaly-center.component';

const routes: Routes = [
  {
    path: '',
    children: [
      {
        path: '',
        redirectTo: 'review-workspace',
        pathMatch: 'full',
      },
      {
        path: 'source-checks',
        component: SourceChecksComponent
      },
      {
        path: 'review-workspace',
        component: QCAssessmentComponent
      },
      {
        path: 'qc-assessment',
        component: QCAssessmentComponent
      },
      {
        path: 'ai-anomaly-center',
        component: AiAnomalyCenterComponent
      },
    ]
  }

];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class QualityControlRoutingModule { }
