import { Component, OnInit } from '@angular/core';
import { take } from 'rxjs';
import { PagesDataService, ToastEventTypeEnum } from 'src/app/core/services/pages-data.service';
import { ViewPaperArchiveModel } from '../models/view-paper-archive.model';
import { PaperArchiveService } from '../services/paper-archive.service';

@Component({
  selector: 'app-view-paper-archive',
  templateUrl: './view-paper-archive.component.html',
  styleUrls: ['./view-paper-archive.component.scss']
})
export class ViewPaperArchiveComponent implements OnInit {
  protected archives: ViewPaperArchiveModel[] = [];
  protected loading = false;
  protected uploading = false;
  protected selectedFile?: File;
  protected fileName = '';
  protected stationId = '';
  protected sourceId = '';
  protected observationDate = '';
  protected observationHour = '';
  protected notes = '';

  constructor(
    private paperArchiveService: PaperArchiveService,
    private pagesDataService: PagesDataService,
  ) { }

  ngOnInit(): void {
    this.loadArchives();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0];
    this.fileName = this.selectedFile?.name || '';
  }

  protected upload(): void {
    if (!this.selectedFile) return;

    const formData = new FormData();
    formData.append('file', this.selectedFile);
    if (this.stationId) formData.append('stationId', this.stationId);
    if (this.sourceId) formData.append('sourceId', this.sourceId);
    if (this.observationDate) formData.append('observationDate', this.observationDate);
    if (this.observationHour !== '') formData.append('observationHour', this.observationHour);
    if (this.notes) formData.append('notes', this.notes);

    this.uploading = true;
    this.paperArchiveService.upload(formData).pipe(take(1)).subscribe({
      next: () => {
        this.uploading = false;
        this.resetForm();
        this.pagesDataService.showToast({ title: 'Paper Archive', message: 'Archive uploaded', type: ToastEventTypeEnum.SUCCESS });
        this.loadArchives();
      },
      error: (err) => {
        this.uploading = false;
        this.pagesDataService.showToast({ title: 'Paper Archive', message: err.error?.message || 'Upload failed', type: ToastEventTypeEnum.ERROR });
      }
    });
  }

  protected fileUrl(id: number): string {
    return this.paperArchiveService.getFileUrl(id);
  }

  private loadArchives(): void {
    this.loading = true;
    this.paperArchiveService.findAll().pipe(take(1)).subscribe({
      next: (archives) => {
        this.archives = archives;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.pagesDataService.showToast({ title: 'Paper Archive', message: 'Could not load archive list', type: ToastEventTypeEnum.ERROR });
      }
    });
  }

  private resetForm(): void {
    this.selectedFile = undefined;
    this.fileName = '';
    this.stationId = '';
    this.sourceId = '';
    this.observationDate = '';
    this.observationHour = '';
    this.notes = '';
  }
}
