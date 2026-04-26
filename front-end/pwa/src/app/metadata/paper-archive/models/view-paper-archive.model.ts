export interface ViewPaperArchiveModel {
  id: number;
  stationId: string;
  sourceId: number | null;
  observationDate: string;
  observationHour: number | null;
  uploadedBy: number;
  uploadedAt: string;
  originalFileName: string;
  storedFileName: string;
  archivePath: string;
  checksum: string;
  notes: string;
  status: 'active' | 'needs_review';
}
