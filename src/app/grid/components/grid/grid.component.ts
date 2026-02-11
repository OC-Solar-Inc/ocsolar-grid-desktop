import { Component, OnInit, OnDestroy, HostListener, HostBinding, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, Inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GridApiService } from '../../services/grid-api.service';
import { GridWebsocketService } from '../../services/grid-websocket.service';
import { IdleConnectionService, IdleState } from '../../services/idle-connection.service';
import { GridThemeService, GridTheme } from '../../services/grid-theme.service';
import { GridNotificationService } from '../../services/grid-notification.service';
import { UserPresenceService } from '../../services/user-presence.service';
import { GRID_AUTH_PROVIDER, GRID_USER_DATA_PROVIDER, GridAuthProvider, GridUserDataProvider } from '../../tokens/grid-tokens';
import {
  GridChannel,
  GridMessage,
  GridTypingUser,
  GridWsConnectionState,
} from '../../interfaces/grid.interface';
import { User } from '../../interfaces/user';
import { ChannelListComponent } from '../channel-list/channel-list.component';
import { MessageListComponent } from '../message-list/message-list.component';
import { MessageInputComponent, MessageSendEvent } from '../message-input/message-input.component';
import { ThreadPanelComponent } from '../thread-panel/thread-panel.component';
import { ChannelFilesPanelComponent } from '../channel-files-panel/channel-files-panel.component';
import { GroupMembersPopupComponent } from '../group-members-popup/group-members-popup.component';

@Component({
  selector: 'lib-grid',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    ChannelListComponent,
    MessageListComponent,
    MessageInputComponent,
    ThreadPanelComponent,
    ChannelFilesPanelComponent,
    GroupMembersPopupComponent,
  ],
  templateUrl: './grid.component.html',
  styleUrls: ['./grid.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridComponent implements OnInit, OnDestroy {
  // Reference to channel-list for accessing filteredUsers
  @ViewChild(ChannelListComponent) channelListRef!: ChannelListComponent;

  // Theme - single dynamic class binding for performance
  @HostBinding('class') get themeClass(): string {
    return `theme-${this.currentTheme}`;
  }
  currentTheme: GridTheme = 'theGrid';

  // Channels
  channels: GridChannel[] = [];
  currentChannel: GridChannel | null = null;

  // Messages
  messages: GridMessage[] = [];
  private messageBuffer: GridMessage[] = []; // Buffer for WebSocket messages during load
  isLoadingMessages = false;
  hasMoreMessages = false;
  nextCursor: string | null = null;
  unreadCountOnEntry = 0; // Unread count when entering a channel (for "New" divider)

  // Typing indicators
  typingUsers: GridTypingUser[] = [];

  // Thread panel
  threadParentMessage: GridMessage | null = null;
  threadReplies: GridMessage[] = [];
  isThreadPanelOpen = false;

  // Files panel
  isFilesPanelOpen = false;

  // Members popup
  isMembersPopupOpen = false;

  // Connection state
  connectionState: GridWsConnectionState = 'disconnected';
  idleState: IdleState = 'active';
  private previousIdleState: IdleState = 'active';

  // UI state
  isMobileView = false;
  isSidebarOpen = true;
  isLoadingChannels = true;

  // Notifications
  notificationBannerVisible = false;
  notificationsEnabled = false;

  // User lookup map for display names
  userMap = new Map<string, User>();
  // Users array for DM selection
  users: User[] = [];
  // Current user ID for message alignment
  currentUserId: string | null = null;

  // Emitted when the channel list requests a sidenav toggle (for host apps that wrap in a sidenav)
  @Output() sidenavToggle = new EventEmitter<void>();

  private destroy$ = new Subject<void>();

  // Track recently sent message hashes to detect duplicates from WebSocket echo
  private recentMessageHashes = new Set<string>();

  constructor(
    private gridApi: GridApiService,
    private gridWs: GridWebsocketService,
    private idleConnection: IdleConnectionService,
    @Inject(GRID_USER_DATA_PROVIDER) private userDataProvider: GridUserDataProvider,
    @Inject(GRID_AUTH_PROVIDER) private authProvider: GridAuthProvider,
    private gridThemeService: GridThemeService,
    private gridNotification: GridNotificationService,
    private userPresence: UserPresenceService,
    private cdr: ChangeDetectorRef
  ) {
    // Initialize theme
    this.currentTheme = this.gridThemeService.getTheme();
  }

  async ngOnInit(): Promise<void> {
    this.checkScreenSize();
    await this.loadUsers();
    // Set currentUserId AFTER loadUsers so we can get the document ID
    this.currentUserId = this.getCurrentUserDocId();
    this.setupWebSocketSubscriptions();
    this.loadChannels();

    // Initialize idle monitoring and connect WebSocket
    // IdleConnectionService manages connection lifecycle based on user activity
    this.idleConnection.initialize(this.gridWs);
    this.gridWs.connect();

    // Start user presence tracking (writes to Firestore for Grid status dots)
    if (this.currentUserId) {
      this.userPresence.initialize(this.currentUserId, this.gridWs);
    }

    // Subscribe to theme changes
    this.gridThemeService.theme$
      .pipe(takeUntil(this.destroy$))
      .subscribe((theme) => {
        this.currentTheme = theme;
        this.cdr.markForCheck();
      });

    // Subscribe to notification state
    this.gridNotification.bannerVisible$
      .pipe(takeUntil(this.destroy$))
      .subscribe((visible) => {
        this.notificationBannerVisible = visible;
        this.cdr.markForCheck();
      });

    this.gridNotification.enabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe((enabled) => {
        this.notificationsEnabled = enabled;
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    // Signal all subscriptions to complete
    this.destroy$.next();
    this.destroy$.complete();

    // Cleanup idle monitoring and user presence
    this.idleConnection.destroy();
    this.userPresence.destroy();

    // Leave current channel but DON'T disconnect WebSocket
    // WebSocket stays connected for global notifications (Slack-like bold channels)
    if (this.currentChannel) {
      this.gridWs.leaveChannel(this.currentChannel.id);
    }

    // Clear component state to free memory
    this.channels = [];
    this.messages = [];
    this.messageBuffer = [];
    this.typingUsers = [];
    this.threadReplies = [];
    this.userMap.clear();
    this.users = [];
    this.currentChannel = null;
    this.threadParentMessage = null;
  }

  @HostListener('window:resize')
  onResize(): void {
    this.checkScreenSize();
  }

  /**
   * Load users from Firestore for display name lookup
   * Keys users by document ID only (used for mentions and message authors)
   */
  private async loadUsers(): Promise<void> {
    try {
      const users = await this.userDataProvider.getUsers();
      this.users = users; // Store array for DM selection
      users.forEach((user: User) => {
        // Key by document ID only
        if (user.id) {
          this.userMap.set(user.id, user);
        }
      });
      console.log('Grid: Loaded', this.userMap.size, 'user mappings,', this.users.length, 'employees');
      this.cdr.markForCheck();
    } catch (error) {
      console.error('Error loading users for Grid:', error);
      this.cdr.markForCheck();
    }
  }

  /**
   * Get display name for a message with fallback to slack_user_name
   */
  getDisplayName(message: GridMessage): string {
    if (message.user_id && this.userMap.has(message.user_id)) {
      const user = this.userMap.get(message.user_id)!;
      return user.sFullName || `${user.sFirstName} ${user.sLastName}`;
    }
    if (message.slack_user_name) {
      return message.slack_user_name;
    }
    return message.display_name || message.username || 'Unknown User';
  }

  /**
   * Get user from the user map by ID
   */
  getUserById(userId: string | null): User | undefined {
    if (!userId) return undefined;
    return this.userMap.get(userId);
  }

  /**
   * Get current user's Firestore document ID (stored during login)
   */
  private getCurrentUserDocId(): string | null {
    return this.authProvider.getCurrentUserDocId();
  }

  private checkScreenSize(): void {
    this.isMobileView = window.innerWidth <= 768;
    if (this.isMobileView) {
      this.isSidebarOpen = !this.currentChannel;
    } else {
      this.isSidebarOpen = true;
    }
  }

  private setupWebSocketSubscriptions(): void {
    // Connection state
    this.gridWs.connectionState$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        this.connectionState = state;
        this.cdr.markForCheck();
      });

    // Idle state (for potential UI indicators like "Reconnecting...")
    // Also refreshes channel data when tab becomes visible again
    this.idleConnection.idleState$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        const wasHidden = this.previousIdleState === 'hidden';
        const isNowActive = state === 'active';

        this.previousIdleState = this.idleState;
        this.idleState = state;

        // When coming back from hidden tab, refresh channels to get latest unread counts
        if (wasHidden && isNowActive) {
          console.log('Grid: Tab became visible, refreshing channel data...');
          this.refreshChannelData();
        }

        this.cdr.markForCheck();
      });

    // New messages
    this.gridWs.newMessage$
      .pipe(takeUntil(this.destroy$))
      .subscribe((message) => {
        // Check if this is our own message coming back from the server
        const isOwnMessage = message.user_id === this.currentUserId;
        if (isOwnMessage && this.recentMessageHashes.has(this.getMessageHash(message))) {
          // This is our own message broadcast back - replace optimistic message with real one
          // Find and replace the pending message with matching content
          const pendingIndex = this.messages.findIndex(
            (m) => m.pending && m.content === message.content && m.user_id === message.user_id
          );
          if (pendingIndex !== -1) {
            this.messages = this.messages.map((m, i) =>
              i === pendingIndex ? { ...message, pending: false } : m
            );
          }
          // Update channel info and return (don't add as new message)
          this.updateChannelLastMessage(message);
          this.cdr.markForCheck();
          return;
        }

        if (this.currentChannel && message.channel === this.currentChannel.id) {
          if (this.isLoadingMessages) {
            // Buffer messages during load to prevent race condition
            // where WebSocket messages arrive before HTTP load completes
            if (!this.isMessageDuplicate(message, this.messageBuffer)) {
              this.messageBuffer.push(message);
              // Increment unread count to keep "New" divider in same position
              if (this.unreadCountOnEntry > 0) {
                this.unreadCountOnEntry++;
              }
            }
          } else {
            // Normal path - add if not duplicate
            if (!this.isMessageDuplicate(message)) {
              this.messages = [...this.messages, message];
              // Increment unread count to keep "New" divider in same position
              if (this.unreadCountOnEntry > 0) {
                this.unreadCountOnEntry++;
              }
            }
          }
          // Mark as read
          this.gridWs.markRead(this.currentChannel.id, message.id);
        }
        // Update channel list (last message preview, unread count)
        this.updateChannelLastMessage(message);
        this.cdr.markForCheck();
      });

    // Message edited
    this.gridWs.messageEdited$
      .pipe(takeUntil(this.destroy$))
      .subscribe((message) => {
        this.messages = this.messages.map((m) =>
          m.id === message.id ? message : m
        );
        // Also update thread replies if applicable
        if (this.threadParentMessage) {
          this.threadReplies = this.threadReplies.map((m) =>
            m.id === message.id ? message : m
          );
        }
        this.cdr.markForCheck();
      });

    // Message deleted
    this.gridWs.messageDeleted$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ messageId, channelId }) => {
        if (this.currentChannel?.id === channelId) {
          this.messages = this.messages.filter((m) => m.id !== messageId);
        }
        // Also remove from thread replies
        if (this.threadParentMessage) {
          this.threadReplies = this.threadReplies.filter((m) => m.id !== messageId);
        }
        this.cdr.markForCheck();
      });

    // Typing indicators
    this.gridWs.typingIndicator$
      .pipe(takeUntil(this.destroy$))
      .subscribe((typing) => {
        if (this.currentChannel?.id !== typing.channel_id) return;

        if (typing.is_typing) {
          // Add to typing users if not already there
          if (!this.typingUsers.find((u) => u.user_id === typing.user_id)) {
            // Look up proper display name from userMap
            const user = this.userMap.get(typing.user_id);
            const displayName = user
              ? (user.sFullName || `${user.sFirstName} ${user.sLastName}`.trim() || typing.display_name)
              : typing.display_name;

            this.typingUsers = [...this.typingUsers, {
              ...typing,
              display_name: displayName,
            }];
          }
        } else {
          // Remove from typing users
          this.typingUsers = this.typingUsers.filter(
            (u) => u.user_id !== typing.user_id
          );
        }
        this.cdr.markForCheck();
      });

    // Unread updates
    this.gridWs.unreadUpdate$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ channelId, unreadCount }) => {
        this.channels = this.channels.map((c) =>
          c.id === channelId ? { ...c, unread_count: unreadCount } : c
        );
        this.cdr.markForCheck();
      });

    // Errors
    this.gridWs.error$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ error }) => {
        console.error('Grid error:', error);
        this.cdr.markForCheck();
      });

    // DM notifications - when user receives a DM in a channel they're not viewing
    this.gridWs.dmNotification$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ channelId, message, senderId }) => {
        // Try to get channelId from message if not provided
        const resolvedChannelId = channelId || message?.channel;
        console.log('Grid: DM notification received', {
          channelId,
          'message.channel': message?.channel,
          resolvedChannelId,
          senderId,
          currentUserId: this.currentUserId,
          isSelf: senderId === this.currentUserId,
        });

        // IMPORTANT: Ignore notifications for our own messages
        // The backend should NOT send these, but defend against it anyway
        if (senderId === this.currentUserId) {
          console.log('Grid: Ignoring DM notification for own message');
          return;
        }

        if (resolvedChannelId) {
          this.handleDmNotification(resolvedChannelId, message, senderId);
          // Forward to activity feed for real-time updates
          this.channelListRef?.addActivityFromMention(resolvedChannelId, message, senderId);
          // Desktop notification
          const senderUser = this.userMap.get(senderId);
          const senderName = senderUser
            ? (senderUser.sFullName || `${senderUser.sFirstName} ${senderUser.sLastName}`.trim())
            : 'New Message';
          this.gridNotification.showNotification(senderName, message?.content || '', 'dm', resolvedChannelId);
        } else {
          console.error('Grid: DM notification has no channel ID, skipping');
        }
      });

    // Channel notifications - when user receives a message in a channel they're not viewing
    this.gridWs.channelNotification$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ channelId, message, senderId }) => {
        const resolvedChannelId = channelId || message?.channel;
        console.log('Grid: Channel notification received', {
          channelId,
          'message.channel': message?.channel,
          resolvedChannelId,
          senderId,
          currentUserId: this.currentUserId,
          isSelf: senderId === this.currentUserId,
        });

        // IMPORTANT: Ignore notifications for our own messages
        // The backend should NOT send these, but defend against it anyway
        if (senderId === this.currentUserId) {
          console.log('Grid: Ignoring channel notification for own message');
          return;
        }

        if (resolvedChannelId) {
          this.handleChannelNotification(resolvedChannelId, message, senderId);
          // Desktop notification
          const channel = this.channels.find(c => c.id === resolvedChannelId);
          const channelName = channel?.name ? `#${channel.name}` : 'New Message';
          const senderUser = this.userMap.get(senderId);
          const senderName = senderUser
            ? (senderUser.sFullName || `${senderUser.sFirstName} ${senderUser.sLastName}`.trim())
            : 'Someone';
          this.gridNotification.showNotification(channelName, `${senderName}: ${message?.content || ''}`, 'channel', resolvedChannelId);
        } else {
          console.error('Grid: Channel notification has no channel ID, skipping');
        }
      });

    // Mention notifications - when user is @mentioned
    this.gridWs.mentionNotification$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ channelId, message, mentionerId }) => {
        console.log('Grid: Mention notification received', { channelId, mentionerId });
        if (channelId) {
          this.handleMentionNotification(channelId, message);
          // Forward to activity feed for real-time updates
          this.channelListRef?.addActivityFromMention(channelId, message, mentionerId);
          // Desktop notification
          const channel = this.channels.find(c => c.id === channelId);
          const channelName = channel?.name ? `#${channel.name}` : 'a channel';
          this.gridNotification.showNotification(`Mentioned in ${channelName}`, message?.content || '', 'mention', channelId);
        }
      });

    // REST API fallback for mark_read when WebSocket send fails
    this.gridWs.markReadFallback$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ channelId, lastReadMessageId }) => {
        console.log('Grid: mark_read WebSocket failed, falling back to REST API', { channelId, lastReadMessageId });
        this.gridApi.markAsRead(channelId, lastReadMessageId).subscribe({
          error: (err) => console.error('Grid: mark_read REST fallback failed:', err),
        });
      });
  }

  /**
   * Handle mention notification - set has_mention flag on channel
   */
  private handleMentionNotification(channelId: string, message: GridMessage): void {
    // Don't set has_mention if we're currently viewing this channel
    const isCurrentChannel = this.currentChannel?.id === channelId;
    if (isCurrentChannel) {
      return;
    }

    // Update the channel's has_mention flag
    this.channels = this.channels.map((c) => {
      if (c.id === channelId) {
        return { ...c, has_mention: true };
      }
      return c;
    });

    this.cdr.markForCheck();
  }

  /**
   * Handle DM notification - add channel to sidebar if not present, increment unread
   */
  private handleDmNotification(channelId: string, message: GridMessage, senderId: string): void {
    // Guard against undefined channelId
    if (!channelId) {
      console.error('Grid: handleDmNotification called with undefined channelId');
      return;
    }

    // Check if channel already exists in our list
    const existingChannel = this.channels.find((c) => c.id === channelId);

    if (existingChannel) {
      // Channel exists - update last message and increment unread
      const isCurrentChannel = this.currentChannel?.id === channelId;

      this.channels = this.channels.map((c) => {
        if (c.id === channelId) {
          return {
            ...c,
            last_message_at: message.created_at,
            last_message_preview: message.content.substring(0, 50),
            // Only increment unread if not viewing this channel
            unread_count: isCurrentChannel ? (c.unread_count || 0) : (c.unread_count || 0) + 1,
          };
        }
        return c;
      });

      // Re-sort to bring this DM to top
      this.channels.sort((a, b) => {
        const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return timeB - timeA;
      });

      this.cdr.markForCheck();
    } else {
      // Channel doesn't exist - fetch from API and add to list
      console.log('Grid: Fetching new DM channel:', channelId);
      this.gridApi.getChannel(channelId).subscribe({
        next: (channel) => {
          // Add channel to list with unread count of 1 and last message info
          const newChannel: GridChannel = {
            ...channel,
            last_message_at: message.created_at,
            last_message_preview: message.content.substring(0, 50),
            unread_count: 1,
          };

          // Add to beginning of list (most recent)
          this.channels = [newChannel, ...this.channels];

          // Populate dm_user for the new DM channel
          this.populateDmUsers();

          this.cdr.markForCheck();
          console.log('Grid: Added new DM channel to sidebar:', channel.id);
        },
        error: (error) => {
          console.error('Error fetching DM channel:', channelId, error);
        },
      });
    }
  }

  /**
   * Handle channel notification - update channel in sidebar, increment unread
   */
  private handleChannelNotification(channelId: string, message: GridMessage, senderId: string): void {
    if (!channelId) {
      console.error('Grid: handleChannelNotification called with undefined channelId');
      return;
    }

    // Check if channel exists in our list
    const existingChannel = this.channels.find((c) => c.id === channelId);

    console.log('Grid: handleChannelNotification', {
      channelId,
      existingChannel: existingChannel ? { id: existingChannel.id, name: existingChannel.name, type: existingChannel.channel_type, unread: existingChannel.unread_count } : 'NOT FOUND',
      totalChannels: this.channels.length,
      channelIds: this.channels.slice(0, 5).map(c => ({ id: c.id, name: c.name })),
    });

    if (existingChannel) {
      const isCurrentChannel = this.currentChannel?.id === channelId;

      // If viewing this channel, add the message directly instead of incrementing unread
      if (isCurrentChannel) {
        // Add message if not duplicate
        if (!this.isMessageDuplicate(message)) {
          this.messages = [...this.messages, message];
        }
        this.gridWs.markRead(channelId, message.id);
      }

      // Update channel list
      this.channels = this.channels.map((c) => {
        if (c.id === channelId) {
          return {
            ...c,
            last_message_at: message.created_at,
            last_message_preview: message.content.substring(0, 50),
            // Only increment unread if not viewing this channel
            unread_count: isCurrentChannel ? (c.unread_count || 0) : (c.unread_count || 0) + 1,
          };
        }
        return c;
      });

      // Re-sort to bring this channel to top
      this.channels = [...this.channels].sort((a, b) => {
        const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return timeB - timeA;
      });

      console.log('Grid: Channel updated with unread_count', {
        channelId,
        newUnreadCount: this.channels.find(c => c.id === channelId)?.unread_count,
      });

      this.cdr.markForCheck();
    } else {
      // Channel not in our list - fetch it and add it
      // This can happen if the channel wasn't in the initial paginated load
      console.log('Grid: Channel not found, fetching:', channelId);
      this.gridApi.getChannel(channelId).subscribe({
        next: (channel) => {
          const newChannel: GridChannel = {
            ...channel,
            last_message_at: message.created_at,
            last_message_preview: message.content.substring(0, 50),
            unread_count: 1,
          };

          // Add to list and sort
          this.channels = [newChannel, ...this.channels].sort((a, b) => {
            const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return timeB - timeA;
          });

          this.cdr.markForCheck();
          console.log('Grid: Added missing channel to sidebar:', channel.id, channel.name);
        },
        error: (error) => {
          console.error('Error fetching channel:', channelId, error);
        },
      });
    }
  }

  /**
   * Refresh channel data when tab becomes visible
   * This updates unread counts and last message info without disrupting current state
   */
  private refreshChannelData(): void {
    const userDocId = this.getCurrentUserDocId();
    console.log('Grid: Refreshing channel data for user:', userDocId);

    // Reload channels - this will update unread counts, has_mention, etc.
    forkJoin({
      myChannels: this.gridApi.getMyChannels(),
      myGroups: this.gridApi.getMyGroups(),
      publicChannelsResponse: this.gridApi.getPublicChannels(),
    }).subscribe({
      next: ({ myChannels, myGroups, publicChannelsResponse }) => {
        const publicChannels = publicChannelsResponse.results;

        // Create lookup maps for the fresh data
        const freshChannelMap = new Map<string, GridChannel>();
        [...myChannels, ...myGroups, ...publicChannels].forEach(c => {
          freshChannelMap.set(c.id, c);
        });

        // Update existing channels with fresh data, preserving local state like dm_user
        this.channels = this.channels.map(existingChannel => {
          const freshChannel = freshChannelMap.get(existingChannel.id);
          if (freshChannel) {
            return {
              ...existingChannel,
              // Update notification-related fields from fresh data
              unread_count: freshChannel.unread_count,
              has_mention: freshChannel.has_mention,
              last_message_at: freshChannel.last_message_at,
              last_message_preview: freshChannel.last_message_preview,
            };
          }
          return existingChannel;
        });

        // Add any new channels that weren't in our list
        const existingIds = new Set(this.channels.map(c => c.id));
        const newChannels = [...myChannels, ...myGroups].filter(c => !existingIds.has(c.id));
        if (newChannels.length > 0) {
          this.channels = [...newChannels, ...this.channels];
          this.populateDmUsers();
        }

        // Sort by last_message_at
        this.channels = [...this.channels].sort((a, b) => {
          const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return timeB - timeA;
        });

        this.cdr.markForCheck();
        console.log('Grid: Channel data refreshed, updated', freshChannelMap.size, 'channels');
      },
      error: (error) => {
        console.error('Error refreshing channel data:', error);
      },
    });
  }

  /**
   * Load user's channels, groups, and public channels they can browse
   */
  loadChannels(): void {
    this.isLoadingChannels = true;
    const userDocId = this.getCurrentUserDocId();
    console.log('Grid: Loading channels for user:', userDocId);

    // Load my channels (DMs), my groups, and public channels
    // Note: getPublicChannels now returns paginated response with 'results' wrapper
    forkJoin({
      myChannels: this.gridApi.getMyChannels(),
      myGroups: this.gridApi.getMyGroups(),
      publicChannelsResponse: this.gridApi.getPublicChannels(),
    }).subscribe({
      next: ({ myChannels, myGroups, publicChannelsResponse }) => {
        // Extract channels from paginated response
        const publicChannels = publicChannelsResponse.results;

        console.log('Grid: My channels (DMs):', myChannels.length);
        console.log('Grid: My groups:', myGroups.length);
        console.log('Grid: Public channels:', publicChannels.length);

        // Create a set of channel IDs the user is already a member of
        const myChannelIds = new Set(myChannels.map((c) => c.id));
        const myGroupIds = new Set(myGroups.map((g) => g.id));

        // Combine: my channels first, then groups, then public channels not already in my list
        const browsablePublic = publicChannels.filter((c) => !myChannelIds.has(c.id) && !myGroupIds.has(c.id));

        this.channels = [...myChannels, ...myGroups, ...browsablePublic];

        // Populate dm_user for DM channels
        this.populateDmUsers();

        this.isLoadingChannels = false;
        this.cdr.markForCheck();

        console.log('Grid: Total channels to display:', this.channels.length);
      },
      error: (error) => {
        console.error('Error loading channels:', error);
        this.isLoadingChannels = false;
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Populate dm_user for DM channels by fetching their members
   */
  private populateDmUsers(): void {
    const currentUserDocId = this.getCurrentUserDocId();
    // Filter for DM channels that don't have dm_user populated yet
    const dmChannels = this.channels.filter(
      (c) => (c.channel_type === 'dm' || c.channel_type === 'direct') && !c.dm_user
    );

    if (dmChannels.length === 0) return;

    console.log('Grid: Populating dm_user for', dmChannels.length, 'DM channels');

    // Fetch members for each DM channel
    dmChannels.forEach((channel) => {
      this.gridApi.getChannelMembers(channel.id).subscribe({
        next: (members) => {
          // Find the other user (not the current user) - using document ID
          const otherMember = members.find((m) => m.user_id !== currentUserDocId);
          if (otherMember) {
            // Look up user details from our userMap
            const user = this.userMap.get(otherMember.user_id);
            if (user) {
              channel.dm_user = {
                user_id: otherMember.user_id,
                username: user.sEmail || otherMember.user_id,
                display_name: user.sFullName || `${user.sFirstName} ${user.sLastName}`.trim() || 'Unknown User',
                avatar_url: user.profileImage || undefined,
                is_online: false,
              };
            } else {
              // User not in userMap, use member info
              channel.dm_user = {
                user_id: otherMember.user_id,
                username: otherMember.user_id,
                display_name: otherMember.display_name || 'Unknown User',
                is_online: false,
              };
            }
            // Trigger change detection by updating channels array
            this.channels = [...this.channels];
            this.cdr.markForCheck();
          }
        },
        error: (error) => {
          console.error('Error fetching members for DM channel:', channel.id, error);
        },
      });
    });
  }

  /**
   * Select a channel
   */
  selectChannel(channel: GridChannel): void {
    if (this.currentChannel?.id === channel.id) return;

    // Leave previous channel
    if (this.currentChannel) {
      this.gridWs.leaveChannel(this.currentChannel.id);
    }

    // Capture unread count BEFORE clearing (for "New" divider)
    this.unreadCountOnEntry = channel.unread_count || 0;

    this.currentChannel = channel;
    this.messages = [];
    this.messageBuffer = []; // Clear buffer when changing channels
    this.typingUsers = [];
    this.closeThreadPanel();
    this.isFilesPanelOpen = false; // Close files panel when changing channels
    this.isMembersPopupOpen = false; // Close members popup when changing channels

    // Clear unread count and has_mention immediately when channel is selected
    this.channels = this.channels.map((c) =>
      c.id === channel.id ? { ...c, unread_count: 0, has_mention: false } : c
    );

    // Join new channel via WebSocket
    this.gridWs.joinChannel(channel.id);

    // Load messages
    this.loadMessages();

    // On mobile, close sidebar when channel is selected
    if (this.isMobileView) {
      this.isSidebarOpen = false;
    }

    this.cdr.markForCheck();
  }

  /**
   * Load messages for current channel
   */
  loadMessages(cursor?: string): void {
    if (!this.currentChannel || this.isLoadingMessages) return;

    this.isLoadingMessages = true;
    const channelId = this.currentChannel.id;
    const userDocId = this.getCurrentUserDocId();
    console.log('Grid: Loading messages for channel:', channelId, 'user:', userDocId);

    this.gridApi.getMessages(channelId, cursor).subscribe({
      next: (messages) => {
        console.log('Grid: Received messages:', messages.length, messages);

        let loadedMessages: GridMessage[];
        if (cursor) {
          // Prepend older messages
          loadedMessages = [...messages.reverse(), ...this.messages];
        } else {
          // Initial load - messages come newest first, reverse for display
          loadedMessages = messages.reverse();
        }

        // Create a Set of loaded message IDs for O(1) lookup
        const loadedIds = new Set(loadedMessages.map(m => m.id));

        // Merge buffered messages that aren't duplicates
        const newBufferedMessages = this.messageBuffer.filter(
          m => !loadedIds.has(m.id) && !this.isMessageDuplicate(m, loadedMessages)
        );

        if (newBufferedMessages.length > 0) {
          console.log('Grid: Merging', newBufferedMessages.length, 'buffered messages');
        }

        // Combine and sort by created_at to ensure proper order
        this.messages = [...loadedMessages, ...newBufferedMessages].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        // Clear buffer after merging
        this.messageBuffer = [];

        // For now, no pagination support from API
        this.hasMoreMessages = false;
        this.nextCursor = null;
        this.isLoadingMessages = false;
        this.cdr.markForCheck();

        // Mark as read
        if (this.currentChannel && this.messages.length > 0) {
          const lastMessage = this.messages[this.messages.length - 1];
          this.gridWs.markRead(this.currentChannel.id, lastMessage.id);
        }
      },
      error: (error) => {
        console.error('Grid: Error loading messages:', error);
        // Clear buffer on error to prevent stale messages
        this.messageBuffer = [];
        this.isLoadingMessages = false;
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Load more (older) messages
   */
  loadMoreMessages(): void {
    if (this.nextCursor) {
      this.loadMessages(this.nextCursor);
    }
  }

  /**
   * Send a message (with optional attachments)
   */
  sendMessage(event: MessageSendEvent): void {
    const { content, attachmentIds } = event;
    if (!this.currentChannel || (!content.trim() && attachmentIds.length === 0)) return;

    this.sendMessageToChannel(this.currentChannel.id, content.trim(), undefined, attachmentIds);
  }

  /**
   * Send a message to an existing channel
   * Uses WebSocket for real-time broadcast + REST API for persistence
   */
  private sendMessageToChannel(channelId: string, content: string, existingTempId?: string, attachmentIds: string[] = []): void {
    const tempId = existingTempId || `temp_${Date.now()}`;
    const currentUserDocId = this.getCurrentUserDocId();

    if (!currentUserDocId) {
      console.error('Cannot send message: current user document ID not found');
      return;
    }

    // Only add optimistic message if we don't have one already
    if (!existingTempId) {
      const optimisticMessage: GridMessage = {
        id: tempId,
        temp_id: tempId,
        channel: channelId,
        user_id: currentUserDocId,
        username: 'You',
        content: content,
        parent: null,
        reply_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
        is_edited: false,
        is_deleted: false,
        pending: true,
        attachments: [], // Attachments will be populated when server responds
      };
      this.messages = [...this.messages, optimisticMessage];

      // Increment unread count to keep "New" divider in same position
      if (this.unreadCountOnEntry > 0) {
        this.unreadCountOnEntry++;
      }

      // Track message hash to prevent duplicate from WebSocket echo
      const hash = this.getMessageHash(optimisticMessage);
      this.recentMessageHashes.add(hash);
      // Clean up hash after 10 seconds (enough time for REST + WebSocket race)
      setTimeout(() => this.recentMessageHashes.delete(hash), 10000);

      this.cdr.markForCheck();
    }

    // Send via WebSocket - this saves to DB AND broadcasts to all users in the channel
    // The WebSocket consumer handles persistence, so we don't need REST API
    console.log('Grid: Sending message via WebSocket', { channelId, content, tempId });
    const sent = this.gridWs.sendMessage(channelId, content, undefined, tempId, attachmentIds);
    console.log('Grid: WebSocket sendMessage returned:', sent);

    if (!sent) {
      // WebSocket not connected - fall back to REST API
      console.warn('WebSocket not connected, falling back to REST API');
      this.gridApi
        .createMessage({
          channel: channelId,
          content: content,
          attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
        }, currentUserDocId)
        .subscribe({
          next: (message) => {
            // Replace optimistic message with real one
            this.messages = this.messages.map((m) => {
              if (m.id === tempId || m.temp_id === tempId) {
                return {
                  ...message,
                  user_id: message.user_id || m.user_id || currentUserDocId,
                  created_at: message.created_at || m.created_at,
                  pending: false,
                };
              }
              return m;
            });
            this.cdr.markForCheck();
          },
          error: (error) => {
            console.error('Error sending message:', error);
            // Mark message as failed
            this.messages = this.messages.map((m) =>
              m.id === tempId ? { ...m, pending: false, error: true } : m
            );
            this.cdr.markForCheck();
          },
        });
    }
  }

  /**
   * Open thread panel for a message
   */
  openThreadPanel(message: GridMessage): void {
    this.threadParentMessage = message;
    this.threadReplies = [];
    this.isThreadPanelOpen = true;
    this.loadThreadReplies();
  }

  /**
   * Close thread panel
   */
  closeThreadPanel(): void {
    this.isThreadPanelOpen = false;
    this.threadParentMessage = null;
    this.threadReplies = [];
  }

  /**
   * Toggle files panel
   */
  toggleFilesPanel(): void {
    this.isFilesPanelOpen = !this.isFilesPanelOpen;
    // Close thread panel if opening files panel
    if (this.isFilesPanelOpen && this.isThreadPanelOpen) {
      this.closeThreadPanel();
    }
    this.cdr.markForCheck();
  }

  /**
   * Close files panel
   */
  closeFilesPanel(): void {
    this.isFilesPanelOpen = false;
    this.cdr.markForCheck();
  }

  /**
   * Toggle members popup
   */
  toggleMembersPopup(event: Event): void {
    event.stopPropagation();
    this.isMembersPopupOpen = !this.isMembersPopupOpen;
    this.cdr.markForCheck();
  }

  /**
   * Close members popup
   */
  closeMembersPopup(): void {
    this.isMembersPopupOpen = false;
    this.cdr.markForCheck();
  }

  /**
   * Handle members changed event from popup
   */
  onMembersChanged(): void {
    // Refresh the current channel's member data if needed
    // The popup handles its own member list refresh
    this.cdr.markForCheck();
  }

  /**
   * Load thread replies
   */
  loadThreadReplies(): void {
    if (!this.threadParentMessage) return;

    this.gridApi.getThreadReplies(this.threadParentMessage.id).subscribe({
      next: (replies) => {
        this.threadReplies = replies.reverse();
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Error loading thread replies:', error);
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Send a thread reply via WebSocket (enables mention processing on backend)
   */
  sendThreadReply(content: string): void {
    if (!this.currentChannel || !this.threadParentMessage || !content.trim()) return;

    const currentUserDocId = this.getCurrentUserDocId();
    if (!currentUserDocId) {
      console.error('Cannot send reply: current user document ID not found');
      return;
    }

    const channelId = this.currentChannel.id;
    const parentId = this.threadParentMessage.id;
    const trimmedContent = content.trim();
    const tempId = `temp_${Date.now()}`;

    // Optimistic UI: add reply immediately
    const optimisticReply: GridMessage = {
      id: tempId,
      temp_id: tempId,
      channel: channelId,
      user_id: currentUserDocId,
      username: 'You',
      content: trimmedContent,
      parent: parentId,
      reply_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      is_edited: false,
      is_deleted: false,
      pending: true,
      attachments: [],
    };
    this.threadReplies = [...this.threadReplies, optimisticReply];

    // Update parent reply count
    this.threadParentMessage = {
      ...this.threadParentMessage!,
      reply_count: this.threadParentMessage!.reply_count + 1,
    };
    this.messages = this.messages.map((m) =>
      m.id === this.threadParentMessage?.id
        ? { ...m, reply_count: m.reply_count + 1 }
        : m
    );

    // Track hash to deduplicate WebSocket echo
    const hash = this.getMessageHash(optimisticReply);
    this.recentMessageHashes.add(hash);
    setTimeout(() => this.recentMessageHashes.delete(hash), 10000);

    this.cdr.markForCheck();

    // Send via WebSocket (parentId enables mention processing on backend)
    const sent = this.gridWs.sendMessage(channelId, trimmedContent, parentId, tempId);

    if (!sent) {
      // WebSocket not connected - fall back to REST API
      console.warn('WebSocket not connected for thread reply, falling back to REST API');
      this.gridApi
        .createMessage({
          channel: channelId,
          content: trimmedContent,
          parent: parentId,
        }, currentUserDocId)
        .subscribe({
          next: (message) => {
            // Replace optimistic reply with real one
            this.threadReplies = this.threadReplies.map((m) =>
              m.id === tempId ? { ...message, pending: false } : m
            );
            this.cdr.markForCheck();
          },
          error: (error) => {
            console.error('Error sending thread reply:', error);
            // Mark as failed
            this.threadReplies = this.threadReplies.map((m) =>
              m.id === tempId ? { ...m, pending: false, error: true } : m
            );
            this.cdr.markForCheck();
          },
        });
    }
  }

  /**
   * Toggle sidebar on mobile
   */
  toggleSidebar(): void {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  /**
   * Handle channel created event
   */
  onChannelCreated(channel: GridChannel): void {
    this.channels = [channel, ...this.channels];
    this.selectChannel(channel);
  }

  /**
   * Handle DM selected/created event
   * Channel is already created via API - just add to list and select it
   */
  onDmSelected(channel: GridChannel): void {
    // Check if channel already exists in list (by ID)
    const existingIndex = this.channels.findIndex((c) => c.id === channel.id);

    if (existingIndex !== -1) {
      // Channel exists - update it with any new info (e.g., dm_user) and move to top
      const updatedChannels = [...this.channels];
      updatedChannels[existingIndex] = { ...updatedChannels[existingIndex], ...channel };
      // Move to top of list
      const [updatedChannel] = updatedChannels.splice(existingIndex, 1);
      this.channels = [updatedChannel, ...updatedChannels];
    } else {
      // New channel - add to top of list
      this.channels = [channel, ...this.channels];
    }

    // Select the channel (this will join WebSocket and load messages)
    this.selectChannel(channel);
  }

  /**
   * Handle group created/selected event
   * Group is already created via API - add to list if new and select it
   */
  onGroupCreated(channel: GridChannel): void {
    // Check if group already exists in list (by ID) - handles duplicate detection on backend
    const existingIndex = this.channels.findIndex((c) => c.id === channel.id);

    if (existingIndex !== -1) {
      // Group exists (same members) - just select it
      this.selectChannel(this.channels[existingIndex]);
    } else {
      // New group - add to list and select
      this.channels = [channel, ...this.channels];
      this.selectChannel(channel);
    }
  }

  /**
   * Handle activity item selected - navigate to the channel
   */
  onActivityItemSelected(event: { channelId: string; messageId: string }): void {
    const channel = this.channels.find(c => c.id === event.channelId);
    if (channel) {
      this.selectChannel(channel);
    } else {
      // Channel not in list - fetch it first
      this.gridApi.getChannel(event.channelId).subscribe({
        next: (channel) => {
          this.channels = [channel, ...this.channels];
          this.populateDmUsers();
          this.selectChannel(channel);
          this.cdr.markForCheck();
        },
        error: (error) => {
          console.error('Error fetching channel for activity item:', error);
        },
      });
    }
  }

  /**
   * Update channel with latest message info
   * If the channel doesn't exist in our list (new DM), fetch and add it
   */
  private updateChannelLastMessage(message: GridMessage): void {
    // Guard: message.channel must be defined
    if (!message.channel) {
      console.error('Grid: updateChannelLastMessage called with undefined channel', message);
      return;
    }

    const currentUserDocId = this.getCurrentUserDocId();
    const isOwnMessage = message.user_id === currentUserDocId;

    // Check if channel exists in our list
    const channelExists = this.channels.some((c) => c.id === message.channel);

    if (!channelExists && !isOwnMessage) {
      // New channel (likely a new DM) - fetch it and add to list
      console.log('Grid: Received message for new channel, fetching:', message.channel);
      this.gridApi.getChannel(message.channel).subscribe({
        next: (channel) => {
          // Add channel to list with unread count of 1
          const newChannel = {
            ...channel,
            last_message_at: message.created_at,
            last_message_preview: message.content.substring(0, 50),
            unread_count: 1,
          };
          this.channels = [newChannel, ...this.channels];

          // Populate dm_user if it's a DM
          if (channel.channel_type === 'dm' || channel.channel_type === 'direct') {
            this.populateDmUsers();
          }

          this.cdr.markForCheck();
          console.log('Grid: Added new channel to list:', channel.name || channel.id);
        },
        error: (error) => {
          console.error('Error fetching new channel:', error);
        },
      });
      return;
    }

    // Update existing channel
    this.channels = this.channels.map((c) => {
      if (c.id === message.channel) {
        const isCurrentChannel = this.currentChannel?.id === c.id;

        // Don't increment unread count for:
        // 1. Current channel (user is viewing it)
        // 2. Own messages (sender shouldn't see unread for their own messages)
        const shouldIncrementUnread = !isCurrentChannel && !isOwnMessage;

        return {
          ...c,
          last_message_at: message.created_at,
          last_message_preview: message.content.substring(0, 50),
          unread_count: shouldIncrementUnread ? (c.unread_count || 0) + 1 : (c.unread_count || 0),
        };
      }
      return c;
    });

    // Re-sort channels by last message time
    this.channels.sort((a, b) => {
      const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return timeB - timeA;
    });
  }

  /**
   * Generate a content hash for a message to detect duplicates
   * Uses channel + user + content + approximate time window
   */
  private getMessageHash(message: GridMessage): string {
    // 5-second window to catch race conditions between WebSocket and REST
    const timeWindow = Math.floor(new Date(message.created_at).getTime() / 5000);
    return `${message.channel}_${message.user_id}_${message.content}_${timeWindow}`;
  }

  /**
   * Check if a message already exists in the messages array
   * Handles both real IDs, temp_id matching, and content hash matching
   */
  private isMessageDuplicate(message: GridMessage, messageList: GridMessage[] = this.messages): boolean {
    // Check by ID/temp_id
    const idMatch = messageList.some((m) =>
      m.id === message.id ||
      (message.temp_id && m.id === message.temp_id) ||
      (message.temp_id && m.temp_id === message.temp_id) ||
      (m.temp_id && m.temp_id === message.id)
    );
    if (idMatch) return true;

    // Check by content hash (catches race conditions where WebSocket arrives before REST)
    const hash = this.getMessageHash(message);
    if (this.recentMessageHashes.has(hash)) {
      return true;
    }

    return false;
  }

  /**
   * Handle mark all as read request from channel list
   * Clears unread_count but preserves has_mention
   */
  onMarkAllAsRead(): void {
    // Get channels with unread messages
    const channelsWithUnread = this.channels.filter(
      (c) => c.unread_count && c.unread_count > 0
    );

    if (channelsWithUnread.length === 0) return;

    // Clear unread_count for all channels (preserve has_mention)
    this.channels = this.channels.map((c) => ({
      ...c,
      unread_count: 0,
      // Keep has_mention as-is
    }));

    // Mark each channel as read via WebSocket
    channelsWithUnread.forEach((channel) => {
      this.gridWs.markRead(channel.id);
    });

    this.cdr.markForCheck();
    console.log('Grid: Marked', channelsWithUnread.length, 'channels as read');
  }

  /**
   * Handle typing started in input
   */
  onTypingStarted(): void {
    if (this.currentChannel) {
      this.gridWs.startTyping(this.currentChannel.id);
    }
  }

  /**
   * Handle typing stopped in input
   */
  onTypingStopped(): void {
    if (this.currentChannel) {
      this.gridWs.stopTyping(this.currentChannel.id);
    }
  }

  /**
   * Enable desktop notifications (called from banner)
   */
  enableNotifications(): void {
    this.gridNotification.requestPermission();
  }

  /**
   * Dismiss the notification permission banner
   */
  dismissNotificationBanner(): void {
    this.gridNotification.dismissBanner();
  }
}
