import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AppConfigService } from 'src/app/app-config.service';
import { ViewPaperArchiveModel } from '../models/view-paper-archive.model';

@Injectable({ providedIn: 'root' })
export class PaperArchiveService {
  private readonly endPointUrl: string;

  constructor(
    appConfigService: AppConfigService,
    private http: HttpClient,
  ) {
    this.endPointUrl = `${appConfigService.apiBaseUrl}/paper-archive`;
  }

  public findAll(): Observable<ViewPaperArchiveModel[]> {
    return this.http.get<ViewPaperArchiveModel[]>(this.endPointUrl);
  }

  public upload(formData: FormData): Observable<ViewPaperArchiveModel> {
    return this.http.post<ViewPaperArchiveModel>(this.endPointUrl, formData);
  }

  public getFileUrl(id: number): string {
    return `${this.endPointUrl}/${id}/file`;
  }
}
