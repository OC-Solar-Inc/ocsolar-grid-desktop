import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GridApiService } from '../../services/grid-api.service';
import { GridChannelFile } from '../../interfaces/grid.interface';

@Component({
  selector: 'lib-channel-files-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './channel-files-panel.component.html',
  styleUrls: ['./channel-files-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChannelFilesPanelComponent implements OnChanges {
  @Input() channelId: string | null = null;
  @Input() channelName = '';

  @Output() close = new EventEmitter<void>();

  files: GridChannelFile[] = [];
  isLoading = false;
  hasMore = false;
  nextToken: string | null = null;
  error: string | null = null;

  private readonly PAGE_SIZE = 10;

  constructor(
    private gridApi: GridApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['channelId'] && this.channelId) {
      this.loadFiles();
    }
  }

  loadFiles(): void {
    if (!this.channelId || this.isLoading) return;

    this.isLoading = true;
    this.error = null;
    this.files = [];
    this.nextToken = null;

    this.gridApi.getChannelFiles(this.channelId, this.PAGE_SIZE).subscribe({
      next: (response) => {
        this.files = response.files;
        this.hasMore = response.has_more;
        this.nextToken = response.next_token;
        this.isLoading = false;
        this.cdr.markForCheck(); // Force immediate render
      },
      error: (err) => {
        console.error('Error loading channel files:', err);
        this.error = 'Failed to load files. Please try again.';
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  loadMore(): void {
    if (!this.channelId || !this.nextToken || this.isLoading) return;

    this.isLoading = true;

    this.gridApi
      .getChannelFiles(this.channelId, this.PAGE_SIZE, this.nextToken)
      .subscribe({
        next: (response) => {
          this.files = [...this.files, ...response.files];
          this.hasMore = response.has_more;
          this.nextToken = response.next_token;
          this.isLoading = false;
          this.cdr.markForCheck(); // Force immediate render
        },
        error: (err) => {
          console.error('Error loading more files:', err);
          this.error = 'Failed to load more files.';
          this.isLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  onClose(): void {
    this.close.emit();
  }

  openFile(file: GridChannelFile): void {
    // Open the presigned URL in a new tab
    window.open(file.url, '_blank');
  }

  downloadFile(file: GridChannelFile, event: Event): void {
    event.stopPropagation();
    // Create a temporary link and trigger download
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (this.isSameDay(date, today)) {
      return 'Today at ' + this.formatTime(date);
    } else if (this.isSameDay(date, yesterday)) {
      return 'Yesterday at ' + this.formatTime(date);
    } else {
      return (
        date.toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
        }) +
        ' at ' +
        this.formatTime(date)
      );
    }
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  getFileIcon(contentType: string): string {
    if (contentType.startsWith('image/')) {
      return 'image';
    } else if (contentType === 'application/pdf') {
      return 'picture_as_pdf';
    } else if (
      contentType.includes('spreadsheet') ||
      contentType.includes('excel') ||
      contentType === 'text/csv'
    ) {
      return 'table_chart';
    } else if (contentType.includes('word') || contentType.includes('document')) {
      return 'description';
    } else if (contentType.startsWith('text/')) {
      return 'article';
    } else if (contentType.includes('zip') || contentType.includes('archive')) {
      return 'folder_zip';
    }
    return 'insert_drive_file';
  }

  isImageFile(contentType: string): boolean {
    return contentType.startsWith('image/');
  }

  trackByKey(index: number, file: GridChannelFile): string {
    return file.s3_key;
  }
}
