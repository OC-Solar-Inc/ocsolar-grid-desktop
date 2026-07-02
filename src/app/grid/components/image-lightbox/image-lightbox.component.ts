import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GridMessageAttachment } from '../../interfaces/grid.interface';
import { GridFileUploadService } from '../../services/grid-file-upload.service';

/**
 * Full-screen in-app preview for image attachments.
 * Opens over the chat instead of kicking the user out to the system browser.
 * Esc or backdrop click closes; toolbar offers download and open-in-browser.
 */
@Component({
  selector: 'lib-image-lightbox',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './image-lightbox.component.html',
  styleUrls: ['./image-lightbox.component.scss'],
})
export class ImageLightboxComponent {
  @Input() attachment: GridMessageAttachment | null = null;
  @Output() closed = new EventEmitter<void>();

  imageFailed = false;

  constructor(private fileUploadService: GridFileUploadService) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    // Only close when the backdrop itself is clicked, not the image/toolbar
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  download(): void {
    if (!this.attachment) return;
    this.fileUploadService.downloadAttachment(
      this.attachment.id,
      this.attachment.original_filename
    );
  }

  openInBrowser(): void {
    if (!this.attachment) return;
    // Electron's window-open handler routes this to the system browser
    window.open(this.attachment.url, '_blank', 'noopener');
  }

  formatFileSize(bytes: number): string {
    return this.fileUploadService.formatFileSize(bytes);
  }
}
