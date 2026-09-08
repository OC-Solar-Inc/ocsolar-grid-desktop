import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, Subscription, forkJoin, of } from 'rxjs';
import { debounceTime, catchError } from 'rxjs/operators';
import { GridApiService } from '../../services/grid-api.service';
import { TEAM_MENTION_LABEL, isTeamMention } from '../../services/grid-mention.service';
import { GridChannel, GridJumpTarget, GridMessage, GridMessageSearchResponse } from '../../interfaces/grid.interface';
import { User } from '../../interfaces/user';

export type MessageSearchScope = 'all' | 'channel';
type SearchKind = 'all' | 'channel' | 'person' | 'message';
interface SnippetPart { text: string; match: boolean; }
export interface MessageSearchRow {
  message: GridMessage; sender: string; channel: string; time: string;
  isReply: boolean; parts: SnippetPart[];
}
export interface GridSearchEntry {
  kind: 'channel' | 'person' | 'message'; id: string; label: string; detail: string;
  channel?: GridChannel; user?: User; message?: MessageSearchRow;
}
const EMPTY_PAGE: GridMessageSearchResponse = { results: [], count: 0, offset: 0, has_more: false };

/** One search for conversations, people and message history. */
@Component({
  selector: 'lib-message-search', standalone: true,
  imports: [CommonModule, FormsModule, A11yModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './message-search.component.html', styleUrls: ['./message-search.component.scss'],
})
export class MessageSearchComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @Input() userMap: Map<string, User> = new Map();
  @Input() channels: GridChannel[] = [];
  @Input() currentChannel: GridChannel | null = null;
  @Input() currentUserId: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() resultSelected = new EventEmitter<GridJumpTarget>();
  @Output() userSelected = new EventEmitter<User>();
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('resultsBody') resultsBody?: ElementRef<HTMLElement>;

  readonly pageSize = 15;
  readonly filters: { kind: SearchKind; label: string }[] = [
    { kind: 'all', label: 'Everything' }, { kind: 'channel', label: 'Conversations' },
    { kind: 'person', label: 'People' }, { kind: 'message', label: 'Messages' },
  ];
  private static readonly SNIPPET_CONTEXT = 90;
  query = '';
  scope: MessageSearchScope = 'all';
  kind: SearchKind = 'all';
  rows: MessageSearchRow[] = [];
  matchingChannels: GridChannel[] = [];
  matchingPeople: User[] = [];
  activeIndex = -1;
  isSearching = false;
  isPaging = false;
  hasSearched = false;
  hasMore = false;
  page = 0;
  searchError = '';
  private terms: string[] = [];
  private remoteChannels: GridChannel[] = [];
  private searchSubject = new Subject<void>();
  private sub?: Subscription;
  private requestSub?: Subscription;
  private pageSub?: Subscription;
  private revision = 0;
  private destroyed = false;

  constructor(private gridApi: GridApiService) {}
  ngOnInit(): void {
    this.sub = this.searchSubject.pipe(debounceTime(150)).subscribe(() => this.runSearch());
  }
  ngOnChanges(): void { this.refreshEntities(); }
  ngAfterViewInit(): void { this.searchInput?.nativeElement.focus(); }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.sub?.unsubscribe(); this.requestSub?.unsubscribe(); this.pageSub?.unsubscribe();
  }

  onQueryChange(value: string): void {
    this.query = value;
    this.terms = this.buildTerms(value);
    ++this.revision;
    // Cancel immediately, not after debounce: a cleared/changed query must
    // never be repopulated by the previous response (including pagination).
    this.requestSub?.unsubscribe(); this.pageSub?.unsubscribe();
    this.remoteChannels = [];
    this.searchError = '';
    this.page = 0; this.hasMore = false; this.isPaging = false;
    this.hasSearched = value.trim().length >= 2;
    this.isSearching = this.hasSearched;
    if (!this.hasSearched) this.rows = [];
    this.refreshEntities(); this.activeIndex = this.entries.length ? 0 : -1;
    this.searchSubject.next();
  }

  private runSearch(): void {
    if (!this.hasSearched) return;
    const revision = this.revision;
    this.requestSub = forkJoin({
      channels: this.gridApi.searchChannels(this.query.trim(), 100).pipe(catchError(() => {
        if (revision === this.revision) this.searchError = 'Some conversations could not be searched. Try again.';
        return of<GridChannel[]>([]);
      })),
      messages: this.gridApi.searchMessages(this.query.trim(), {
        limit: this.pageSize, offset: 0, channelId: this.scopeChannelId(this.scope),
      }).pipe(catchError(() => {
        if (revision === this.revision) this.searchError = 'Messages could not be searched. Try again.';
        return of(EMPTY_PAGE);
      })),
    }).subscribe(({ channels, messages }) => {
      if (revision !== this.revision) return;
      this.remoteChannels = channels || [];
      this.refreshEntities(); this.showPage(messages || EMPTY_PAGE);
    });
  }

  private refreshEntities(): void {
    const query = this.query.trim().toLowerCase();
    if (query.length < 2) { this.matchingChannels = []; this.matchingPeople = []; return; }
    const channels = new Map<string, GridChannel>();
    // Loaded records retain DM partner labels and membership metadata.
    for (const channel of [...this.remoteChannels, ...this.channels]) channels.set(channel.id, channel);
    this.matchingChannels = [...channels.values()].filter(c => !c.is_archived &&
      (this.conversationLabel(c).toLowerCase().includes(query) || (c.description || '').toLowerCase().includes(query)))
      .sort((a, b) => this.conversationLabel(a).localeCompare(this.conversationLabel(b)));
    this.matchingPeople = [...this.userMap.entries()].filter(([id, user]) =>
      id !== this.currentUserId && !(user.sRoles || [user.sRole]).includes('Customer') &&
      `${this.personLabel(user)} ${user.sEmail || ''}`.toLowerCase().includes(query))
      .map(([id, user]) => ({ ...user, id }))
      .sort((a, b) => this.personLabel(a).localeCompare(this.personLabel(b)));
  }

  get entries(): GridSearchEntry[] {
    const entries: GridSearchEntry[] = [];
    const limit = this.kind === 'all' ? 5 : Number.MAX_SAFE_INTEGER;
    if (this.scope === 'all' && (this.kind === 'all' || this.kind === 'channel')) {
      entries.push(...this.matchingChannels.slice(0, limit).map(channel => ({
        kind: 'channel' as const, id: `channel-${channel.id}`, label: this.conversationLabel(channel),
        detail: this.isDmChannel(channel) ? 'Direct message' : channel.channel_type === 'group' ? 'Group chat' : 'Channel', channel,
      })));
    }
    if (this.scope === 'all' && (this.kind === 'all' || this.kind === 'person')) {
      entries.push(...this.matchingPeople.slice(0, limit).map(user => ({
        kind: 'person' as const, id: `person-${user.id}`, label: this.personLabel(user), detail: user.sEmail || 'Open direct message', user,
      })));
    }
    if (this.kind === 'all' || this.kind === 'message') {
      entries.push(...this.rows.map(message => ({ kind: 'message' as const,
        id: `message-${message.message.id}`, label: message.sender, detail: message.channel, message })));
    }
    return entries;
  }
  groupLabel(kind: SearchKind): string {
    return this.filters.find(f => f.kind === kind)?.label || '';
  }
  personLabel(user: User): string { return user.sFullName || `${user.sFirstName || ''} ${user.sLastName || ''}`.trim() || 'Unknown user'; }
  conversationLabel(channel: GridChannel): string {
    return this.isDmChannel(channel) ? channel.dm_user?.display_name || channel.name || 'Direct message' : channel.name || 'Group chat';
  }
  setKind(kind: SearchKind): void {
    this.kind = kind;
    if (kind !== 'message') this.setScope('all');
    this.activeIndex = this.entries.length ? 0 : -1;
    this.resultsBody?.nativeElement.scrollTo({ top: 0 });
    this.searchInput?.nativeElement.focus();
  }
  setScope(scope: MessageSearchScope): void {
    if (scope === this.scope) return;
    this.scope = scope;
    if (scope === 'channel') this.kind = 'message';
    this.onQueryChange(this.query);
    this.searchInput?.nativeElement.focus();
  }
  private scopeChannelId(scope: MessageSearchScope): string | null { return scope === 'channel' ? this.currentChannel?.id || null : null; }
  currentChannelLabel(): string { return this.currentChannel ? this.conversationLabel(this.currentChannel) : ''; }
  isDmChannel(channel: GridChannel | null): boolean { return !!channel && ['dm', 'direct'].includes(channel.channel_type); }
  clear(): void { this.onQueryChange(''); this.searchInput?.nativeElement.focus(); }
  close(): void { this.closed.emit(); }
  onBackdropClick(event: MouseEvent): void { if (event.target === event.currentTarget) this.close(); }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if ((event.target as HTMLElement)?.closest?.('button')) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const entries = this.entries;
      if (!entries.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex = (this.activeIndex + delta + entries.length) % entries.length;
      setTimeout(() => {
        if (!this.destroyed) this.resultsBody?.nativeElement.querySelector<HTMLElement>('.search-result.active')?.scrollIntoView({ block: 'nearest' });
      });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = this.entries[this.activeIndex];
      if (entry) this.selectEntry(entry);
    } else if ((event.metaKey || event.ctrlKey || event.altKey) && event.key === 'ArrowRight') {
      event.preventDefault(); this.nextPage();
    } else if ((event.metaKey || event.ctrlKey || event.altKey) && event.key === 'ArrowLeft') {
      event.preventDefault(); this.prevPage();
    }
  }
  selectEntry(entry: GridSearchEntry): void {
    if (entry.channel) this.resultSelected.emit({ channelId: entry.channel.id, messageId: '' });
    if (entry.user) this.userSelected.emit(entry.user);
    if (entry.message && !this.isSearching && !this.isPaging) {
      const message = entry.message.message;
      if (message.channel) this.resultSelected.emit({ channelId: message.channel, messageId: message.id, parentId: message.parent || null });
    }
  }
  trackByEntry(_index: number, entry: GridSearchEntry): string { return entry.id; }
  get pageStart(): number { return this.page * this.pageSize + 1; }
  get pageEnd(): number { return this.page * this.pageSize + this.rows.length; }
  get canGoPrev(): boolean { return this.page > 0 && !this.isPaging && !this.isSearching; }
  get canGoNext(): boolean { return this.hasMore && !this.isPaging && !this.isSearching; }
  nextPage(): void { if (this.canGoNext) this.goToPage(this.page + 1); }
  prevPage(): void { if (this.canGoPrev) this.goToPage(this.page - 1); }
  private goToPage(page: number): void {
    this.isPaging = true; this.searchError = '';
    const revision = this.revision;
    this.pageSub?.unsubscribe();
    this.pageSub = this.gridApi.searchMessages(this.query.trim(), {
      limit: this.pageSize, offset: page * this.pageSize, channelId: this.scopeChannelId(this.scope),
    }).subscribe({ next: result => {
      if (revision !== this.revision) return;
      this.page = page; this.showPage(result || EMPTY_PAGE);
    }, error: () => {
      if (revision !== this.revision) return;
      this.isPaging = false; this.searchError = 'This message page could not be loaded. Try again.';
    }});
  }
  private showPage(result: GridMessageSearchResponse): void {
    this.rows = result.results.map(m => this.toRow(m));
    this.hasMore = result.has_more; this.isSearching = false; this.isPaging = false;
    this.activeIndex = this.entries.length ? 0 : -1;
    if (this.resultsBody) this.resultsBody.nativeElement.scrollTop = 0;
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
