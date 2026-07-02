import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { GridApiService } from '../../services/grid-api.service';
import { GridChannel, GridMessage } from '../../interfaces/grid.interface';
import { User } from '../../interfaces/user';

/**
 * Full-text message search overlay. Debounces input, queries the backend
 * search endpoint, and emits the chosen result's channel + message id for
 * the shell to navigate to.
 */
@Component({
  selector: 'lib-message-search',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './message-search.component.html',
  styleUrls: ['./message-search.component.scss'],
})
export class MessageSearchComponent implements OnInit, OnDestroy {
  @Input() userMap: Map<string, User> = new Map();
  @Input() channels: GridChannel[] = [];

  @Output() closed = new EventEmitter<void>();
  @Output() resultSelected = new EventEmitter<{ channelId: string; messageId: string }>();

  query = '';
  results: GridMessage[] = [];
  isSearching = false;
  hasSearched = false;

  private searchSubject = new Subject<string>();
  private sub?: Subscription;

  constructor(private gridApi: GridApiService) {}

  ngOnInit(): void {
    this.sub = this.searchSubject
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          const trimmed = q.trim();
          if (trimmed.length < 2) {
            this.isSearching = false;
            this.hasSearched = false;
            return of<GridMessage[]>([]);
          }
          this.isSearching = true;
          this.hasSearched = true;
          // Keep the stream alive if one search errors
          return this.gridApi.searchMessages(trimmed).pipe(
            catchError(() => of<GridMessage[]>([]))
          );
        })
      )
      .subscribe((results) => {
        this.results = results;
        this.isSearching = false;
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  onQueryChange(value: string): void {
    this.query = value;
    this.searchSubject.next(value);
  }

  clear(): void {
    this.query = '';
    this.results = [];
    this.hasSearched = false;
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  selectResult(message: GridMessage): void {
    const channelId = message.channel;
    if (!channelId) return;
    this.resultSelected.emit({ channelId, messageId: message.id });
  }

  senderName(message: GridMessage): string {
    if (message.user_id && this.userMap.has(message.user_id)) {
      const u = this.userMap.get(message.user_id)!;
      return u.sFullName || `${u.sFirstName || ''} ${u.sLastName || ''}`.trim() || 'Unknown';
    }
    return message.slack_user_name || message.display_name || 'Unknown';
  }

  channelName(message: GridMessage): string {
    const channel = this.channels.find((c) => c.id === message.channel);
    if (!channel) return '';
    if (channel.channel_type === 'dm' || channel.channel_type === 'direct') {
      return channel.dm_user?.display_name || 'Direct Message';
    }
    return `#${channel.name}`;
  }

  /** Render the message content with the query term highlighted. */
  highlightedSnippet(message: GridMessage): { text: string; match: boolean }[] {
    const content = message.content || '';
    const q = this.query.trim();
    if (!q) return [{ text: content, match: false }];

    const lower = content.toLowerCase();
    const qLower = q.toLowerCase();
    const parts: { text: string; match: boolean }[] = [];
    let i = 0;
    while (i < content.length) {
      const idx = lower.indexOf(qLower, i);
      if (idx === -1) {
        parts.push({ text: content.slice(i), match: false });
        break;
      }
      if (idx > i) parts.push({ text: content.slice(i, idx), match: false });
      parts.push({ text: content.slice(idx, idx + q.length), match: true });
      i = idx + q.length;
    }
    return parts;
  }

  formatTime(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' · ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  trackByMessageId(index: number, message: GridMessage): string {
    return message.id;
  }
}
