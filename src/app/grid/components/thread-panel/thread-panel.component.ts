import {
  AfterViewChecked,
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GridMessage, GridChannel, GridMessageAttachment, GridHighlightRequest } from '../../interfaces/grid.interface';
import { User } from '../../interfaces/user';
import { GridMentionService, MentionSuggestion, TEAM_MENTION_LABEL, isTeamMention } from '../../services/grid-mention.service';
import { GridFileUploadService } from '../../services/grid-file-upload.service';

@Component({
  selector: 'lib-thread-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './thread-panel.component.html',
  styleUrls: ['./thread-panel.component.scss'],
})
export class ThreadPanelComponent implements OnChanges, AfterViewChecked, OnDestroy {
  @Input() parentMessage: GridMessage | null = null;
  @Input() replies: GridMessage[] = [];
  @Input() channelName = '';
  @Input() userMap: Map<string, User> = new Map();
  @Input() channelId = '';
  @Input() channel: GridChannel | null = null;
  @Input() readOnly = false;
  @Input() followed = false;
  // Jump-to-message: scroll this reply into view and flash it once rendered
  @Input() highlightRequest: GridHighlightRequest | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() replySent = new EventEmitter<string>();
  @Output() imagePreview = new EventEmitter<GridMessageAttachment>();
  @Output() followToggled = new EventEmitter<void>();

  @ViewChild('replyInput') replyInput!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('repliesList') repliesList?: ElementRef<HTMLElement>;

  replyContent = '';

  // Pending jump target (replies load asynchronously after the panel opens)
  private pendingHighlightId: string | null = null;
  private highlightDeadline = 0;
  private static readonly HIGHLIGHT_WAIT_MS = 10000; // replies may take a moment to load
  private static readonly HIGHLIGHT_MS = 2500;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  // Mention autocomplete state
  showMentionDropdown = false;
  mentionSuggestions: MentionSuggestion[] = [];
  selectedMentionIndex = 0;
  mentionStartIndex = 0;
  mentionQuery = '';
  mentionMap = new Map<string, string>();

  /**
   * Rendered HTML per message body. [innerHTML] compares the bound value by
   * identity, and bypassSecurityTrustHtml() minted a fresh wrapper on every
   * change-detection pass, so Angular rewrote the text nodes on every pass —
   * including the click that follows a drag-select, which is why a selection
   * vanished the instant the mouse was released. Returning the same wrapper for
   * the same body leaves the DOM (and the selection) alone.
   */
  private formattedContentCache = new Map<string, SafeHtml>();

  constructor(
    private sanitizer: DomSanitizer,
    private mentionService: GridMentionService,
    public fileUploadService: GridFileUploadService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['userMap']) {
      this.formattedContentCache.clear();
    }
    if (changes['highlightRequest'] && this.highlightRequest) {
      this.pendingHighlightId = this.highlightRequest.messageId;
      this.highlightDeadline = Date.now() + ThreadPanelComponent.HIGHLIGHT_WAIT_MS;
    }
    if ((changes['userMap'] || changes['channelId'] || changes['channel']) && this.channelId && this.userMap.size > 0) {
      this.mentionService.loadChannelMembers(this.channelId, this.userMap, this.channel);
    }
    if (changes['channelId'] && !changes['channelId'].firstChange) {
      this.closeMentionDropdown();
      this.mentionMap.clear();
    }
    // When the user opens a different thread (or closes & reopens on a
    // different parent), clear any in-flight draft so it can't be sent to
    // the wrong parent message. firstChange skips the initial bind, which
    // already starts with empty state.
    if (changes['parentMessage'] && !changes['parentMessage'].firstChange) {
      this.replyContent = '';
      this.mentionMap.clear();
      this.closeMentionDropdown();
      if (this.replyInput) {
        this.replyInput.nativeElement.style.height = 'auto';
      }
    }
  }

  ngAfterViewChecked(): void {
    if (this.pendingHighlightId) {
      this.tryApplyHighlight();
    }
  }

  ngOnDestroy(): void {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
  }

  /**
   * Scroll the pending jump target into view and flash it. Retried from
   * ngAfterViewChecked until the reply row exists; time-bounded so a reply
   * that never loads can't leave a dangling request.
   */
  private tryApplyHighlight(): void {
    const id = this.pendingHighlightId;
    const list = this.repliesList?.nativeElement;
    if (!id || !list) return;

    const row = list.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    if (!row) {
      if (Date.now() > this.highlightDeadline) {
        this.pendingHighlightId = null;
      }
      return;
    }

    this.pendingHighlightId = null;
    row.scrollIntoView({ block: 'center' });
    row.classList.remove('highlighted');
    void row.offsetWidth; // restart the animation when re-jumping to the same row
    row.classList.add('highlighted');
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => {
      row.classList.remove('highlighted');
      this.highlightTimer = null;
    }, ThreadPanelComponent.HIGHLIGHT_MS);
  }

  onClose(): void {
    this.close.emit();
  }

  onKeyDown(event: KeyboardEvent): void {
    // Handle mention dropdown navigation
    if (this.showMentionDropdown && this.mentionSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.selectedMentionIndex = (this.selectedMentionIndex + 1) % this.mentionSuggestions.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.selectedMentionIndex = this.selectedMentionIndex === 0
          ? this.mentionSuggestions.length - 1
          : this.selectedMentionIndex - 1;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.selectMention(this.mentionSuggestions[this.selectedMentionIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeMentionDropdown();
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendReply();
    }
  }

  sendReply(): void {
    if (this.readOnly) return;
    const content = this.replyContent.trim();
    if (!content) return;

    // Convert display-format mentions (@[Name]) to backend format (<@userId>)
    const contentWithMentions = this.mentionService.convertMentionsForSend(content, this.mentionMap);

    this.replySent.emit(contentWithMentions);
    this.replyContent = '';
    this.mentionMap.clear();
    this.closeMentionDropdown();

    // Reset textarea height
    if (this.replyInput) {
      this.replyInput.nativeElement.style.height = 'auto';
    }
  }

  onToggleFollow(): void {
    this.followToggled.emit();
  }

  onInput(): void {
    this.adjustTextareaHeight();
    this.detectMentionTrigger();
  }

  // Mention autocomplete methods
  detectMentionTrigger(): void {
    const textarea = this.replyInput?.nativeElement;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const result = this.mentionService.extractMentionQuery(this.replyContent, cursorPos);

    if (result) {
      this.mentionStartIndex = result.startIndex;
      this.mentionQuery = result.query;
      this.mentionSuggestions = this.mentionService.search(result.query, this.channelId);
      this.showMentionDropdown = this.mentionSuggestions.length > 0;
      this.selectedMentionIndex = 0;
    } else {
      this.closeMentionDropdown();
    }
  }

  selectMention(user: MentionSuggestion): void {
    const textarea = this.replyInput?.nativeElement;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const result = this.mentionService.insertMention(
      this.replyContent,
      cursorPos,
      this.mentionStartIndex,
      user
    );

    this.replyContent = result.content;
    this.mentionMap.set(result.mentionMapping.displayName, result.mentionMapping.userId);
    this.closeMentionDropdown();

    // Set cursor position after the mention
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(result.cursorPos, result.cursorPos);
    });
  }

  closeMentionDropdown(): void {
    this.showMentionDropdown = false;
    this.mentionSuggestions = [];
    this.selectedMentionIndex = 0;
    this.mentionQuery = '';
  }

  getUserInitials(user: MentionSuggestion): string {
    return user.display_name
      .split(' ')
      .map((n) => n.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  private adjustTextareaHeight(): void {
    const textarea = this.replyInput?.nativeElement;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 150);
    textarea.style.height = `${newHeight}px`;
  }

  formatTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (this.isSameDay(date, today)) {
      return 'Today at ' + this.formatTime(dateString);
    } else if (this.isSameDay(date, yesterday)) {
      return 'Yesterday at ' + this.formatTime(dateString);
    } else {
      return date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
      }) + ' at ' + this.formatTime(dateString);
    }
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  getInitials(name: string): string {
    if (!name) return '?';
    return name
      .split(' ')
      .map((n) => n.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  /**
   * Get display name for a message - uses userMap
   */
  getDisplayName(message: GridMessage): string {
    // Try to get from userMap (Firebase users)
    if (message.user_id && this.userMap.has(message.user_id)) {
      const user = this.userMap.get(message.user_id)!;
      return user.sFullName || `${user.sFirstName || ''} ${user.sLastName || ''}`.trim() || 'Unknown User';
    }
    // Fall back to any display_name or username on the message
    return message.display_name || message.username || 'Unknown User';
  }

  trackByReplyId(index: number, reply: GridMessage): string {
    return reply.id;
  }

  // ---- Attachment helpers (mirror message-list.component) ----

  isImageAttachment(attachment: GridMessageAttachment): boolean {
    return this.fileUploadService.isImageAttachment(attachment);
  }

  getAttachmentIcon(attachment: GridMessageAttachment): string {
    return this.fileUploadService.getFileIcon(attachment.file_type);
  }

  formatFileSize(bytes: number): string {
    return this.fileUploadService.formatFileSize(bytes);
  }

  getImageMaxWidth(attachment: GridMessageAttachment): number {
    return this.fileUploadService.getImageMaxWidth(attachment, 400);
  }

  trackByAttachmentId(index: number, attachment: GridMessageAttachment): string {
    return attachment.id;
  }

  onDownloadClick(event: Event, attachment: GridMessageAttachment): void {
    event.preventDefault();
    event.stopPropagation();
    this.fileUploadService.downloadAttachment(attachment.id, attachment.original_filename);
  }

  onImageClick(event: Event, attachment: GridMessageAttachment): void {
    event.preventDefault();
    this.imagePreview.emit(attachment);
  }

  /**
   * Get display name for a user ID from the userMap
   */
  private getUserDisplayName(userId: string): string {
    if (isTeamMention(userId)) {
      return TEAM_MENTION_LABEL;
    }
    if (this.userMap.has(userId)) {
      const user = this.userMap.get(userId)!;
      return user.sFullName || `${user.sFirstName || ''} ${user.sLastName || ''}`.trim() || userId;
    }
    return userId;
  }

  /**
   * Get avatar URL for a message's user from userMap
   */
  getAvatarUrl(message: GridMessage): string | undefined {
    if (message.user_id && this.userMap.has(message.user_id)) {
      const user = this.userMap.get(message.user_id)!;
      return user.profileImage || undefined;
    }
    return message.avatar_url;
  }

  /**
   * Get avatar color for a message's user from userMap
   */
  getAvatarColor(message: GridMessage): string | undefined {
    if (message.user_id && this.userMap.has(message.user_id)) {
      const user = this.userMap.get(message.user_id)!;
      return user.avatarColor;
    }
    return undefined;
  }

  /**
   * Format message content - replaces <@userId> mentions with display names
   */
  formatMessageContent(content: string): SafeHtml {
    if (!content) return this.sanitizer.bypassSecurityTrustHtml('');
    const cached = this.formattedContentCache.get(content);
    if (cached) return cached;

    const escaped = this.escapeHtml(content);
    // Match escaped HTML entities: &lt;@userId&gt;
    const mentionPattern = /&lt;@([A-Za-z0-9_-]+)&gt;/g;
    let formatted = escaped.replace(mentionPattern, (match, userId) => {
      const displayName = this.getUserDisplayName(userId);
      const cls = isTeamMention(userId) ? 'mention mention-team' : 'mention';
      return `<span class="${cls}">@${this.escapeHtml(displayName)}</span>`;
    });

    // Linkify URLs
    // Negative lookbehind prevents matching URLs inside src="..." attributes
    const urlPattern = /(?<!")https?:\/\/[^\s<>"]+/gi;
    formatted = formatted.replace(urlPattern, (url) => {
      // Strip trailing punctuation unlikely to be part of the URL
      let cleanUrl = url;
      let suffix = '';
      const trailingMatch = url.match(/[.,;:!?)\]]+$/);
      if (trailingMatch) {
        cleanUrl = url.slice(0, -trailingMatch[0].length);
        suffix = trailingMatch[0];
      }
      const href = cleanUrl.replace(/&amp;/g, '&');
      return `<a href="${href}" class="message-link" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${suffix}`;
    });

    const safe = this.sanitizer.bypassSecurityTrustHtml(formatted);
    this.formattedContentCache.set(content, safe);
    return safe;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
