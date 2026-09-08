import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, Subscription, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
import { GridApiService } from '../../services/grid-api.service';
import { TEAM_MENTION_LABEL, isTeamMention } from '../../services/grid-mention.service';
import {
  GridChannel,
  GridJumpTarget,
  GridMessage,
  GridMessageSearchResponse,
} from '../../interfaces/grid.interface';
import { User } from '../../interfaces/user';

export type MessageSearchScope = 'all' | 'channel';

interface SnippetPart {
  text: string;
  match: boolean;
}

/** A search hit, pre-rendered for the template. */
export interface MessageSearchRow {
  message: GridMessage;
  sender: string;
  channel: string;
  time: string;
  isReply: boolean;
  parts: SnippetPart[];
}

interface SearchRequest {
  query: string;
  scope: MessageSearchScope;
}

const EMPTY_PAGE: GridMessageSearchResponse = { results: [], count: 0, offset: 0, has_more: false };

/**
 * Message search overlay (⌘K / Ctrl+K, the header magnifier, or the sidebar
 * search bar). Debounces input, queries the backend search endpoint
 * (websearch syntax + substring fallback), and emits the chosen result as a
 * jump target for the shell to land on. Supports "this channel only" scope,
 * keyboard navigation and "Show more" paging.
 */
@Component({
  selector: 'lib-message-search',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './message-search.component.html',
  styleUrls: ['./message-search.component.scss'],
})
export class MessageSearchComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() userMap: Map<string, User> = new Map();
  @Input() channels: GridChannel[] = [];
  @Input() currentChannel: GridChannel | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() resultSelected = new EventEmitter<GridJumpTarget>();

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('resultsBody') resultsBody?: ElementRef<HTMLElement>;

  readonly pageSize = 15;
  /** Characters of context kept on each side of the first match in a snippet. */
  private static readonly SNIPPET_CONTEXT = 90;

  query = '';
  scope: MessageSearchScope = 'all';
  rows: MessageSearchRow[] = [];
  activeIndex = -1;
  isSearching = false;
  isPaging = false;
  hasSearched = false;
  hasMore = false;
  /** Zero-based page of the current query/scope (pageSize rows per page). */
  page = 0;

  private terms: string[] = [];
  private searchSubject = new Subject<SearchRequest>();
  private sub?: Subscription;
  private pageSub?: Subscription;

  constructor(private gridApi: GridApiService) {}

  ngOnInit(): void {
    this.sub = this.searchSubject
      .pipe(
        debounceTime(150),
        distinctUntilChanged((a, b) => a.query === b.query && a.scope === b.scope),
        switchMap((req) => {
          this.pageSub?.unsubscribe();
          this.isPaging = false;
          this.page = 0;
          const trimmed = req.query.trim();
          if (trimmed.length < 2) {
            this.isSearching = false;
            this.hasSearched = false;
            return of<GridMessageSearchResponse>(EMPTY_PAGE);
          }
          this.isSearching = true;
          this.hasSearched = true;
          // Keep the stream alive if one search errors
          return this.gridApi
            .searchMessages(trimmed, { limit: this.pageSize, offset: 0, channelId: this.scopeChannelId(req.scope) })
            .pipe(catchError(() => of<GridMessageSearchResponse>(EMPTY_PAGE)));
        })
      )
      .subscribe((result) => this.showPage(result));
  }

  /** Replace the visible rows with one page of results. */
  private showPage(result: GridMessageSearchResponse): void {
    this.rows = result.results.map((m) => this.toRow(m));
    this.hasMore = result.has_more;
    this.activeIndex = this.rows.length > 0 ? 0 : -1;
    this.isSearching = false;
    this.isPaging = false;
    if (this.resultsBody) {
      this.resultsBody.nativeElement.scrollTop = 0;
    }
  }

  ngAfterViewInit(): void {
    // `autofocus` is unreliable for dynamically inserted elements
    this.searchInput?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.pageSub?.unsubscribe();
  }

  // ---- Keyboard ----

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (this.rows.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveActive(-1);
    } else if (event.key === 'ArrowRight' && (event.metaKey || event.ctrlKey || event.altKey)) {
      event.preventDefault();
      this.nextPage();
    } else if (event.key === 'ArrowLeft' && (event.metaKey || event.ctrlKey || event.altKey)) {
      event.preventDefault();
      this.prevPage();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = this.rows[this.activeIndex] ?? this.rows[0];
      if (row) this.selectRow(row);
    }
  }

  private moveActive(delta: number): void {
    const count = this.rows.length;
    this.activeIndex = ((this.activeIndex + delta) % count + count) % count;
    // Let the row render its active state, then keep it in view
    setTimeout(() => {
      this.resultsBody?.nativeElement
        .querySelector<HTMLElement>('.search-result.active')
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  // ---- Input / scope ----

  onQueryChange(value: string): void {
    this.query = value;
    this.terms = this.buildTerms(value);
    this.searchSubject.next({ query: value, scope: this.scope });
  }

  setScope(scope: MessageSearchScope): void {
    if (this.scope === scope) return;
    this.scope = scope;
    this.activeIndex = -1;
    this.searchSubject.next({ query: this.query, scope });
    this.searchInput?.nativeElement.focus();
  }

  private scopeChannelId(scope: MessageSearchScope): string | null {
    return scope === 'channel' && this.currentChannel ? this.currentChannel.id : null;
  }

  currentChannelLabel(): string {
    const channel = this.currentChannel;
    if (!channel) return '';
    if (this.isDmChannel(channel)) return channel.dm_user?.display_name || 'Direct Message';
    return channel.name || 'This channel';
  }

  isDmChannel(channel: GridChannel | null): boolean {
    return !!channel && (channel.channel_type === 'dm' || channel.channel_type === 'direct');
  }

  clear(): void {
    this.query = '';
    this.terms = [];
    this.rows = [];
    this.activeIndex = -1;
    this.hasMore = false;
    this.hasSearched = false;
    this.page = 0;
    this.pageSub?.unsubscribe();
    this.isPaging = false;
    this.searchInput?.nativeElement.focus();
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  // ---- Results ----

  // ---- Pagination ----

  /** 1-based index of the first row on the current page (for "31–60"). */
  get pageStart(): number {
    return this.page * this.pageSize + 1;
  }

  get pageEnd(): number {
    return this.page * this.pageSize + this.rows.length;
  }

  get canGoPrev(): boolean {
    return this.page > 0 && !this.isPaging;
  }

  get canGoNext(): boolean {
    return this.hasMore && !this.isPaging;
  }

  nextPage(): void {
    if (this.canGoNext) this.goToPage(this.page + 1);
  }

  prevPage(): void {
    if (this.canGoPrev) this.goToPage(this.page - 1);
  }

  private goToPage(page: number): void {
    const trimmed = this.query.trim();
    if (page < 0 || trimmed.length < 2) return;
    this.isPaging = true;
    this.pageSub?.unsubscribe();
    this.pageSub = this.gridApi
      .searchMessages(trimmed, {
        limit: this.pageSize,
        offset: page * this.pageSize,
        channelId: this.scopeChannelId(this.scope),
      })
      .pipe(catchError(() => of<GridMessageSearchResponse>(EMPTY_PAGE)))
      .subscribe((result) => {
        this.page = page;
        this.showPage(result);
      });
  }

  selectRow(row: MessageSearchRow): void {
    const message = row.message;
    if (!message.channel) return;
    this.resultSelected.emit({
      channelId: message.channel,
      messageId: message.id,
      parentId: message.parent || null,
    });
  }

  trackByRowId(index: number, row: MessageSearchRow): string {
    return row.message.id;
  }

  private toRow(message: GridMessage): MessageSearchRow {
    return {
      message,
      sender: this.senderName(message),
      channel: this.channelName(message),
      time: this.formatTime(message.created_at),
      isReply: !!message.parent,
      parts: this.snippetParts(message),
    };
  }

  senderName(message: GridMessage): string {
    if (message.user_id && this.userMap.has(message.user_id)) {
      return this.displayNameFor(message.user_id);
    }
    return message.slack_user_name || message.display_name || 'Unknown';
  }

  private displayNameFor(userId: string): string {
    if (isTeamMention(userId)) return TEAM_MENTION_LABEL;
    const u = this.userMap.get(userId);
    if (!u) return userId;
    return u.sFullName || `${u.sFirstName || ''} ${u.sLastName || ''}`.trim() || 'Unknown';
  }

  /**
   * Channel label: sidebar list first (knows DM partners), then the label the
   * search endpoint supplies (public channels the user hasn't joined).
   */
  channelName(message: GridMessage): string {
    const channel = this.channels.find((c) => c.id === message.channel);
    if (channel) {
      if (this.isDmChannel(channel)) return channel.dm_user?.display_name || 'Direct Message';
      return `#${channel.name}`;
    }
    if (message.channel_type === 'dm' || message.channel_type === 'direct') return 'Direct Message';
    return message.channel_name ? `#${message.channel_name}` : '';
  }

  // ---- Snippets ----

  /**
   * Search terms to highlight: each websearch token (quotes stripped,
   * `-excluded` and `OR` dropped, ≥2 chars) plus the whole query so a
   * multi-word substring match highlights as one run. Longest first so the
   * regex prefers the longer alternative.
   */
  private buildTerms(query: string): string[] {
    const tokens = query.match(/"[^"]*"|\S+/g) || [];
    const terms = tokens
      .map((t) => t.replace(/^"|"$/g, '').trim().toLowerCase())
      .filter((t) => t.length >= 2 && !t.startsWith('-') && t !== 'or');
    const whole = query.trim().toLowerCase();
    if (whole.length >= 2) terms.push(whole);
    return Array.from(new Set(terms)).sort((a, b) => b.length - a.length);
  }

  /** Message text with <@id> mentions rendered as @Name. */
  private plainContent(message: GridMessage): string {
    return (message.content || '')
      .replace(/<@([A-Za-z0-9_-]+)>/g, (_m, id) => `@${this.displayNameFor(id)}`)
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * A window of the message centred on the first matched term (so a hit deep
   * inside a long message is visible), with every term highlighted.
   */
  snippetParts(message: GridMessage): SnippetPart[] {
    const content = this.plainContent(message);
    const terms = this.terms;
    if (!content) return [];
    if (terms.length === 0) return [{ text: content, match: false }];

    const lower = content.toLowerCase();
    let first = -1;
    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx !== -1 && (first === -1 || idx < first)) first = idx;
    }

    const context = MessageSearchComponent.SNIPPET_CONTEXT;
    let start = 0;
    let end = content.length;
    let prefix = '';
    let suffix = '';

    if (first > context) {
      start = first - context;
      const boundary = content.lastIndexOf(' ', start);
      if (boundary > 0 && start - boundary < 20) start = boundary + 1;
      prefix = '… ';
    }
    const maxLength = context * 2 + 40;
    if (end - start > maxLength) {
      end = start + maxLength;
      const boundary = content.indexOf(' ', end);
      if (boundary !== -1 && boundary - end < 20) end = boundary;
      suffix = ' …';
    }

    const parts: SnippetPart[] = [];
    if (prefix) parts.push({ text: prefix, match: false });
    parts.push(...this.highlight(content.slice(start, end), terms));
    if (suffix) parts.push({ text: suffix, match: false });
    return parts;
  }

  private highlight(text: string, terms: string[]): SnippetPart[] {
    const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const re = new RegExp(pattern, 'gi');
    const parts: SnippetPart[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      const idx = m.index ?? 0;
      if (idx > last) parts.push({ text: text.slice(last, idx), match: false });
      parts.push({ text: m[0], match: true });
      last = idx + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last), match: false });
    return parts;
  }

  formatTime(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return (
      date.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  }
}
