import { Injectable, Inject } from '@angular/core';
import { HttpClient, HttpEventType, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, throwError, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { GRID_CONFIG, GRID_AUTH_PROVIDER, GridConfig, GridAuthProvider } from '../tokens/grid-tokens';
import {
  GridMessageAttachment,
  GridFileUploadProgress,
  GridFileUploadStatus,
} from '../interfaces/grid.interface';

// Allowed MIME types for file uploads
const ALLOWED_FILE_TYPES: Set<string> = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
]);

const IMAGE_TYPES: Set<string> = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
]);

const MAX_FILE_SIZE = 50 * 1024 * 1024;

@Injectable()
export class GridFileUploadService {
  private baseUrl: string;

  constructor(
    private http: HttpClient,
    @Inject(GRID_CONFIG) private config: GridConfig,
    @Inject(GRID_AUTH_PROVIDER) private authProvider: GridAuthProvider
  ) {
    this.baseUrl = config.siteFrameApiUrl;
  }

  private getCurrentUserId(): string | null {
    return this.authProvider.getCurrentUserDocId();
  }

  validateFile(file: File): { valid: boolean; error?: string } {
    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, error: `File too large. Maximum size is ${this.formatFileSize(MAX_FILE_SIZE)}` };
    }
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
      return { valid: false, error: `File type not allowed: ${file.type || 'unknown'}` };
    }
    return { valid: true };
  }

  uploadFile(channelId: string, file: File): Observable<GridFileUploadProgress> {
    const userId = this.getCurrentUserId();
    if (!userId) {
      return throwError(() => new Error('User not logged in'));
    }

    const validation = this.validateFile(file);
    if (!validation.valid) {
      return throwError(() => new Error(validation.error));
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', userId);

    const progress$ = new Subject<GridFileUploadProgress>();

    progress$.next({ file, progress: 0, status: 'pending' });

    this.http
      .post<GridMessageAttachment>(
        `${this.baseUrl}/chat/channels/${channelId}/upload/`,
        formData,
        { reportProgress: true, observe: 'events' }
      )
      .pipe(
        catchError((error: HttpErrorResponse) => {
          const errorMessage = error.error?.error || error.message || 'Upload failed';
          progress$.next({ file, progress: 0, status: 'error', error: errorMessage });
          progress$.complete();
          return throwError(() => error);
        })
      )
      .subscribe({
        next: (event: HttpEvent<GridMessageAttachment>) => {
          if (event.type === HttpEventType.UploadProgress) {
            const percentDone = event.total ? Math.round((100 * event.loaded) / event.total) : 0;
            progress$.next({ file, progress: percentDone, status: 'uploading' });
          } else if (event.type === HttpEventType.Response) {
            const attachment = event.body as GridMessageAttachment;
            progress$.next({ file, progress: 100, status: 'complete', attachment });
            progress$.complete();
          }
        },
        error: () => {},
      });

    return progress$.asObservable();
  }

  uploadFiles(channelId: string, files: File[]): Observable<GridFileUploadProgress>[] {
    return files.map((file) => this.uploadFile(channelId, file));
  }

  deleteAttachment(attachmentId: string): Observable<void> {
    const userId = this.getCurrentUserId();
    if (!userId) {
      return throwError(() => new Error('User not logged in'));
    }
    return this.http
      .delete<void>(`${this.baseUrl}/chat/attachments/${attachmentId}/?user_id=${userId}`)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Failed to delete attachment:', error);
          return of(undefined as unknown as void);
        })
      );
  }

  getDownloadUrl(attachmentId: string): Observable<{ download_url: string; filename: string; expires_in: number }> {
    const userId = this.getCurrentUserId();
    if (!userId) {
      return throwError(() => new Error('User not logged in'));
    }
    return this.http.get<{ download_url: string; filename: string; expires_in: number }>(
      `${this.baseUrl}/chat/attachments/${attachmentId}/download/?user_id=${userId}`
    );
  }

  downloadAttachment(attachmentId: string, filename: string): void {
    this.getDownloadUrl(attachmentId).subscribe({
      next: (response) => {
        const link = document.createElement('a');
        link.href = response.download_url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      },
      error: (err) => console.error('Download failed:', err),
    });
  }

  isImage(fileType: string): boolean { return IMAGE_TYPES.has(fileType); }
  isImageAttachment(attachment: GridMessageAttachment): boolean { return this.isImage(attachment.file_type); }

  getFileIcon(fileType: string): string {
    if (this.isImage(fileType)) return 'image';
    if (fileType === 'application/pdf') return 'picture_as_pdf';
    if (fileType === 'application/msword' || fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'description';
    if (fileType === 'application/vnd.ms-excel' || fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'table_chart';
    if (fileType === 'text/plain' || fileType === 'text/csv') return 'text_snippet';
    if (fileType === 'application/zip' || fileType === 'application/x-zip-compressed') return 'folder_zip';
    return 'insert_drive_file';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getImageMaxWidth(attachment: GridMessageAttachment, maxWidth: number = 400): number {
    if (!attachment.width || !attachment.height) return maxWidth;
    return Math.min(attachment.width, maxWidth);
  }

  getAllowedExtensions(): string {
    return '.jpg,.jpeg,.png,.gif,.webp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip';
  }

  getMaxFileSize(): number { return MAX_FILE_SIZE; }
}
