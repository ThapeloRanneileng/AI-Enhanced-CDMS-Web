import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FormEntryComponent } from './data-entry/form-entry/form-entry.component';

import { StationFormSelectionComponent } from './data-entry/station-form-selection/station-form-selection.component';
import { FormPlaceholderComponent } from './data-entry/form-placeholder/form-placeholder.component';
import { ImportSelectionComponent } from './import-entry/import-source-selection/import-selection.component';
import { DeletedDataComponent } from './deleted-data/deleted-data.component';
import { DataCorrectionComponent } from './data-correction/data-correction.component';
import { AwsRealTimeComponent } from './aws-real-time/aws-real-time.component';


const routes: Routes = [
  {
    path: '',
    data: {
      title: 'Data Entry'
    },
    children: [
      {
        path: '',
        redirectTo: 'forms',
        pathMatch: 'full',
      },
      {
        path: 'forms',
        component: StationFormSelectionComponent
      },
      {
        path: 'station-form-selection',
        redirectTo: 'forms',
        pathMatch: 'full',
      },
      {
        path: 'form-entry/:stationid/:sourceid',
        component: FormEntryComponent
      },
      {
        path: 'form-placeholder/:kind',
        component: FormPlaceholderComponent
      },
      {
        path: 'manual-import-selection',
        component: ImportSelectionComponent
      },
      {
        path: 'data-correction',
        component: DataCorrectionComponent
      },
      {
        path: 'deleted-data',
        component: DeletedDataComponent
      },
      {
        path: 'aws-real-time',
        component: AwsRealTimeComponent
      },
    ]
  }

];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class DataIngestionRoutingModule { }
