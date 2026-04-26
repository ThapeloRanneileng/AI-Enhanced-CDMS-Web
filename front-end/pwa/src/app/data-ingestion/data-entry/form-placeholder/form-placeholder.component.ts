import { Component } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { PagesDataService } from 'src/app/core/services/pages-data.service';

type PlaceholderFormKind = 'hourly' | 'daily' | 'monthly';

const FORM_TITLES: Record<PlaceholderFormKind, string> = {
  hourly: 'Hourly Data Form',
  daily: 'Daily Data Form',
  monthly: 'Monthly Data Form',
};

@Component({
  selector: 'app-form-placeholder',
  templateUrl: './form-placeholder.component.html',
  styleUrls: ['./form-placeholder.component.scss']
})
export class FormPlaceholderComponent {
  protected readonly formKind: PlaceholderFormKind;
  protected readonly title: string;

  constructor(
    private pagesDataService: PagesDataService,
    private route: ActivatedRoute,
    private location: Location,
  ) {
    const routeKind = this.route.snapshot.params['kind'] as PlaceholderFormKind;
    this.formKind = FORM_TITLES[routeKind] ? routeKind : 'daily';
    this.title = FORM_TITLES[this.formKind];
    this.pagesDataService.setPageHeader(this.title);
  }

  protected onBack(): void {
    this.location.back();
  }
}
