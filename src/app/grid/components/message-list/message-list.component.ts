import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  ViewChild,
  AfterViewChecked,
  AfterViewInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GridMessage, GridTypingUser, GridMessageAttachment } from '../../interfaces/grid.interface';
import { User } from '../../interfaces/user';
import { GridFileUploadService } from '../../services/grid-file-upload.service';

@Component({
  selector: 'lib-message-list',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './message-list.component.html',
  styleUrls: ['./message-list.component.scss'],
})
export class MessageListComponent implements OnChanges, AfterViewInit, AfterViewChecked, OnDestroy {
  @Input() messages: GridMessage[] = [];
  @Input() isLoading = false;
  @Input() hasMore = false;
  @Input() typingUsers: GridTypingUser[] = [];
  @Input() userMap: Map<string, User> = new Map();
  @Input() currentUserId: string | null = null;
  @Input() unreadCountOnEntry = 0; // Number of unread messages when entering channel

  @Output() loadMore = new EventEmitter<void>();
  @Output() openThread = new EventEmitter<GridMessage>();

  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

  private shouldScrollToBottom = true;
  private previousMessageCount = 0;
  private previousTypingCount = 0;
  private previousLastMessageId: string | null = null;
  private userHasScrolledUp = false;
  private resizeObserver: ResizeObserver | null = null;
  private lastScrollHeight = 0;

  constructor(
    private sanitizer: DomSanitizer,
    public fileUploadService: GridFileUploadService
  ) {}

  ngAfterViewInit(): void {
    // Set up ResizeObserver to scroll when content height changes (e.g., images load)
    if (this.scrollContainer) {
      this.resizeObserver = new ResizeObserver(() => {
        const element = this.scrollContainer.nativeElement;
        const currentScrollHeight = element.scrollHeight;

        // If height increased and we should be at bottom, scroll down
        if (currentScrollHeight > this.lastScrollHeight && !this.userHasScrolledUp) {
          this.scrollToBottom();
        }
        this.lastScrollHeight = currentScrollHeight;
      });

      // Observe the scroll container's content
      this.resizeObserver.observe(this.scrollContainer.nativeElement);
      this.lastScrollHeight = this.scrollContainer.nativeElement.scrollHeight;
    }
  }

  ngOnDestroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['messages']) {
      const currentCount = this.messages.length;
      const previousCount = this.previousMessageCount;
      const currentLastMessageId = this.messages.length > 0
        ? this.messages[this.messages.length - 1].id
        : null;

      // Determine if we should scroll:
      // 1. New messages added (count increased)
      // 2. Last message changed (new message or optimistic replaced)
      // 3. Initial load (previousCount was 0)
      const hasNewMessages = currentCount > previousCount;
      const lastMessageChanged = currentLastMessageId !== this.previousLastMessageId;
      const isInitialLoad = previousCount === 0;

      // Scroll to bottom unless user has explicitly scrolled up to read history
      if ((hasNewMessages || lastMessageChanged) && !this.userHasScrolledUp) {
        this.shouldScrollToBottom = true;
      }

      // Reset scroll flag on initial load or channel change (count goes to 0 or from 0)
      if (isInitialLoad || currentCount === 0) {
        this.userHasScrolledUp = false;
        this.shouldScrollToBottom = true;
      }

      this.previousMessageCount = currentCount;
      this.previousLastMessageId = currentLastMessageId;
    }

    // Scroll to bottom when typing indicator appears (if user hasn't scrolled up)
    if (changes['typingUsers']) {
      const currentTypingCount = this.typingUsers.length;
      if (currentTypingCount > this.previousTypingCount && !this.userHasScrolledUp) {
        this.shouldScrollToBottom = true;
      }
      this.previousTypingCount = currentTypingCount;
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottomWithRetry();
      this.shouldScrollToBottom = false;
    }
  }

  private scrollToBottom(): void {
    if (this.scrollContainer) {
      const element = this.scrollContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  /**
   * Scroll to bottom immediately AND after delays to catch image loads
   */
  private scrollToBottomWithRetry(): void {
    // Scroll immediately
    this.scrollToBottom();
    // Scroll again after short delays to catch images loading
    setTimeout(() => this.scrollToBottom(), 50);
    setTimeout(() => this.scrollToBottom(), 150);
    setTimeout(() => this.scrollToBottom(), 300);
  }

  onScroll(event: Event): void {
    const element = event.target as HTMLDivElement;

    // Load more when scrolled to top
    if (element.scrollTop < 100 && this.hasMore && !this.isLoading) {
      this.loadMore.emit();
    }

    // Track if user has scrolled up from bottom
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceFromBottom > 150) {
      // User scrolled up - don't auto-scroll on new messages
      this.userHasScrolledUp = true;
    } else {
      // User is at bottom - resume auto-scroll
      this.userHasScrolledUp = false;
    }
  }

  onOpenThread(message: GridMessage): void {
    if (message.reply_count > 0 || !message.parent) {
      this.openThread.emit(message);
    }
  }

  /**
   * Get display name for a message - uses userMap, falls back to slack_user_name
   */
  getMessageDisplayName(message: GridMessage): string {
    // Try to get from userMap (Firebase users)
    if (message.user_id && this.userMap.has(message.user_id)) {
      const user = this.userMap.get(message.user_id)!;
      return user.sFullName || `${user.sFirstName || ''} ${user.sLastName || ''}`.trim() || 'Unknown User';
    }
    // Fall back to slack_user_name for unmapped Slack users
    if (message.slack_user_name) {
      return message.slack_user_name;
    }
    // Fall back to any display_name or username on the message
    return message.display_name || message.username || 'Unknown User';
  }

  /**
   * Get display name for a user ID from the userMap
   */
  private getUserDisplayName(userId: string): string {
    if (this.userMap.has(userId)) {
      const user = this.userMap.get(userId)!;
      return user.sFullName || `${user.sFirstName || ''} ${user.sLastName || ''}`.trim() || userId;
    }
    return userId; // Return the ID if user not found
  }

  /**
   * Get avatar URL for a user ID from the userMap
   */
  private getUserAvatarUrl(userId: string | null): string | undefined {
    if (userId && this.userMap.has(userId)) {
      const user = this.userMap.get(userId)!;
      return user.profileImage || undefined;
    }
    return undefined;
  }

  /**
   * Get avatar color for a user ID from the userMap (for fallback initials)
   */
  private getUserAvatarColor(userId: string | null): string | undefined {
    if (userId && this.userMap.has(userId)) {
      const user = this.userMap.get(userId)!;
      return user.avatarColor;
    }
    return undefined;
  }

  /**
   * Format message content - replaces <@userId> mentions with display names
   * and renders GIPHY URLs as embedded images
   * Returns SafeHtml for use with [innerHTML]
   */
  formatMessageContent(content: string): SafeHtml {
    if (!content) return this.sanitizer.bypassSecurityTrustHtml('');

    // Escape HTML to prevent XSS
    const escaped = this.escapeHtml(content);

    // Replace mentions with styled spans - use new regex each time to avoid lastIndex issues
    const mentionPattern = /&lt;@([A-Za-z0-9]+)&gt;/g;
    let formatted = escaped.replace(mentionPattern, (match, userId) => {
      const displayName = this.getUserDisplayName(userId);
      return `<span class="mention">@${this.escapeHtml(displayName)}</span>`;
    });

    // Replace GIPHY URLs with embedded images
    // Match various GIPHY URL formats (media.giphy.com, media0-4.giphy.com, i.giphy.com)
    const giphyPattern = /https?:\/\/(?:media\d*\.giphy\.com\/media\/[^\s<>"]+\.gif|i\.giphy\.com\/[^\s<>"]+\.gif)/gi;
    formatted = formatted.replace(giphyPattern, (url) => {
      // Decode any HTML entities in the URL
      const decodedUrl = url.replace(/&amp;/g, '&');
      return `<img src="${decodedUrl}" class="inline-gif" alt="GIF" loading="lazy" />`;
    });

    // Linkify URLs — runs after GIPHY so those URLs are already <img> tags
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

    return this.sanitizer.bypassSecurityTrustHtml(formatted);
  }

  /**
   * Escape HTML special characters to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Group messages by user and time proximity for display
   */
  get groupedMessages(): MessageGroup[] {
    const groups: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;
    let lastDate: string | null = null;
    let newDividerInserted = false;

    // Calculate the index where unread messages start
    // IMPORTANT: Skip the current user's own messages when counting backwards
    // This prevents the "New" divider from appearing above your own messages
    let firstUnreadIndex = -1;
    if (this.unreadCountOnEntry > 0) {
      let unreadCount = 0;
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const msg = this.messages[i];
        // Skip own messages when counting unread
        if (msg.user_id === this.currentUserId) {
          continue;
        }
        unreadCount++;
        if (unreadCount === this.unreadCountOnEntry) {
          firstUnreadIndex = i;
          break;
        }
      }
      // If we counted all non-own messages but didn't reach unreadCountOnEntry,
      // it means the backend count included our own messages - don't show divider
      if (firstUnreadIndex === -1 && unreadCount < this.unreadCountOnEntry) {
        firstUnreadIndex = -1; // No divider needed
      }
    }

    for (let i = 0; i < this.messages.length; i++) {
      const message = this.messages[i];
      const messageDate = this.formatDateDivider(message.created_at);

      // Insert "New" divider before first unread message (never before own message)
      if (!newDividerInserted && firstUnreadIndex >= 0 && i === firstUnreadIndex) {
        // Double-check: don't insert divider if the message at this index is our own
        if (message.user_id !== this.currentUserId) {
          if (currentGroup) {
            groups.push(currentGroup);
            currentGroup = null;
          }
          groups.push({ type: 'new-divider' });
          newDividerInserted = true;
        }
      }

      // Add date divider if new day
      if (messageDate !== lastDate) {
        if (currentGroup) {
          groups.push(currentGroup);
          currentGroup = null;
        }
        groups.push({ type: 'divider', date: messageDate });
        lastDate = messageDate;
      }

      // Check if message should be grouped with previous
      const shouldGroup =
        currentGroup &&
        currentGroup.type === 'messages' &&
        currentGroup.userId === message.user_id &&
        this.isWithinTimeWindow(currentGroup.lastTimestamp, message.created_at);

      if (shouldGroup && currentGroup?.type === 'messages') {
        currentGroup.messages.push(message);
        currentGroup.lastTimestamp = message.created_at;
      } else {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        const displayName = this.getMessageDisplayName(message);
        // Get avatar URL from userMap (Firebase) or fall back to message.avatar_url
        const avatarUrl = this.getUserAvatarUrl(message.user_id) || message.avatar_url;
        const avatarColor = this.getUserAvatarColor(message.user_id);
        currentGroup = {
          type: 'messages',
          userId: message.user_id,
          username: message.username || displayName,
          displayName: displayName,
          avatarUrl: avatarUrl,
          avatarColor: avatarColor,
          messages: [message],
          firstTimestamp: message.created_at,
          lastTimestamp: message.created_at,
        };
      }
    }

    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }

  private isWithinTimeWindow(timestamp1: string, timestamp2: string): boolean {
    const time1 = new Date(timestamp1).getTime();
    const time2 = new Date(timestamp2).getTime();
    // Group messages within 5 minutes
    return Math.abs(time2 - time1) < 5 * 60 * 1000;
  }

  formatDateDivider(dateString: string): string {
    if (!dateString) return 'Today';

    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Today'; // Invalid date fallback

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (this.isSameDay(date, today)) {
      return 'Today';
    } else if (this.isSameDay(date, yesterday)) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString([], {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    }
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  formatTime(dateString: string): string {
    if (!dateString) return '';

    const date = new Date(dateString);
    if (isNaN(date.getTime())) return ''; // Invalid date fallback

    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  getTypingText(): string {
    if (this.typingUsers.length === 0) return '';
    if (this.typingUsers.length === 1) {
      return `${this.typingUsers[0].display_name || this.typingUsers[0].username} is typing...`;
    }
    if (this.typingUsers.length === 2) {
      const names = this.typingUsers.map((u) => u.display_name || u.username);
      return `${names[0]} and ${names[1]} are typing...`;
    }
    return 'Several people are typing...';
  }

  isMessageGroup(group: MessageGroup): group is MessageGroupMessages {
    return group.type === 'messages';
  }

  isDivider(group: MessageGroup): group is MessageGroupDivider {
    return group.type === 'divider';
  }

  isNewDivider(group: MessageGroup): group is MessageGroupNewDivider {
    return group.type === 'new-divider';
  }

  isOwnMessage(group: MessageGroup): boolean {
    return group.type === 'messages' && !!this.currentUserId && group.userId === this.currentUserId;
  }

  trackByGroupIndex(index: number): number {
    return index;
  }

  trackByMessageId(index: number, message: GridMessage): string {
    return message.id;
  }

  // Attachment helper methods
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

  /**
   * Handle download button click - triggers browser download
   */
  onDownloadClick(event: Event, attachment: GridMessageAttachment): void {
    event.preventDefault();
    event.stopPropagation();
    this.fileUploadService.downloadAttachment(attachment.id, attachment.original_filename);
  }
}

// Type definitions for grouped messages
interface MessageGroupMessages {
  type: 'messages';
  userId: string | null;
  username?: string;
  displayName: string;
  avatarUrl?: string;
  avatarColor?: string;
  messages: GridMessage[];
  firstTimestamp: string;
  lastTimestamp: string;
}

interface MessageGroupDivider {
  type: 'divider';
  date: string;
}

interface MessageGroupNewDivider {
  type: 'new-divider';
}

type MessageGroup = MessageGroupMessages | MessageGroupDivider | MessageGroupNewDivider;
