import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ChangeDetectorRef, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, takeUntil } from 'rxjs/operators';
import { GridChannel, GridChannelType, GridCreateGroupRequest, GridActivityItem } from '../../interfaces/grid.interface';
import { GridApiService } from '../../services/grid-api.service';
import { GridThemeService, GridTheme, ThemeConfig, GRID_THEMES } from '../../services/grid-theme.service';
import { GridNotificationService, NotificationType, NotificationPreferences } from '../../services/grid-notification.service';
import { User } from '../../interfaces/user';
import { GRID_CONFIG, GRID_AUTH_PROVIDER, GridConfig, GridAuthProvider } from '../../tokens/grid-tokens';

@Component({
  selector: 'lib-channel-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './channel-list.component.html',
  styleUrls: ['./channel-list.component.scss'],
})
export class ChannelListComponent implements OnInit, OnDestroy {
  @Input() channels: GridChannel[] = [];
  @Input() currentChannel: GridChannel | null = null;
  @Input() isLoading = false;
  @Input() users: User[] = [];
  @Input() presenceMap: Map<string, boolean> = new Map();

  @Output() channelSelected = new EventEmitter<GridChannel>();
  @Output() channelCreated = new EventEmitter<GridChannel>();
  @Output() dmSelected = new EventEmitter<GridChannel>();
  @Output() groupCreated = new EventEmitter<GridChannel>();
  @Output() markAllReadRequested = new EventEmitter<void>();
  @Output() activityItemSelected = new EventEmitter<{ channelId: string; messageId: string }>();
  @Output() sidenavToggle = new EventEmitter<void>();

  searchQuery = '';
  isCreatingChannel = false;

  // Search state
  private searchSubject = new Subject<string>();
  private searchSubscription: Subscription;
  searchResults: GridChannel[] = [];
  isSearching = false;
  newChannelName = '';
  newChannelType: GridChannelType = 'public';
  newChannelDescription = '';
  showCreateForm = false;

  // DM creation
  showDmForm = false;
  dmSearchQuery = '';
  isCreatingDm = false;

  // Group creation
  showGroupForm = false;
  groupSearchQuery = '';
  selectedGroupMembers: User[] = [];
  newGroupName = '';
  isCreatingGroup = false;

  // Message filter
  showFilterPopup = false;
  messageFilter: 'all' | 'mentions' | 'unread' = 'all';

  // Settings/Theme
  showSettingsPopup = false;
  showThemeDropdown = false;
  currentTheme: GridTheme = 'theGrid';
  themeOptions: ThemeConfig[] = Object.values(GRID_THEMES);

  // Collapsible sections
  isChannelsCollapsed = false;
  isGroupsCollapsed = false;
  isDmsCollapsed = false;

  // Notifications
  notificationsEnabled = false;
  notificationPreferences: NotificationPreferences = { dm: true, channel: true, mention: true };

  // Activity view
  showActivityView = false;
  activityItems: GridActivityItem[] = [];
  isLoadingActivity = false;
  activityFilter: 'all' | 'unread' = 'all';
  unreadActivityCount = 0;

  private destroy$ = new Subject<void>();

  showNexusToggle = true;

  constructor(
    private gridApi: GridApiService,
    private gridThemeService: GridThemeService,
    private gridNotification: GridNotificationService,
    private cdr: ChangeDetectorRef,
    @Inject(GRID_AUTH_PROVIDER) private authProvider: GridAuthProvider,
    @Inject(GRID_CONFIG) private config: GridConfig
  ) {
    this.showNexusToggle = this.config.showNexusToggle !== false;
    this.currentTheme = this.gridThemeService.getTheme();

    // Set up debounced search (150ms delay for instant feel)
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      switchMap(query => {
        if (!query || query.length < 2) {
          this.searchResults = [];
          this.isSearching = false;
          this.cdr.markForCheck();
          return [];
        }
        this.isSearching = true;
        this.cdr.markForCheck();
        return this.gridApi.searchChannels(query);
      })
    ).subscribe({
      next: (results) => {
        this.searchResults = results;
        this.isSearching = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.searchResults = [];
        this.isSearching = false;
        this.cdr.markForCheck();
      }
    });
  }

  ngOnInit(): void {
    // Fetch initial unread activity count for badge on bell icon
    this.gridApi.getActivity(true, 50).subscribe({
      next: (items) => {
        this.unreadActivityCount = items.length;
        this.cdr.markForCheck();
      },
      error: () => {
        // Silently fail - badge just won't show
      },
    });

    // Subscribe to notification state for settings toggle
    this.gridNotification.enabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe((enabled) => {
        this.notificationsEnabled = enabled;
        this.cdr.markForCheck();
      });

    this.gridNotification.preferences$
      .pipe(takeUntil(this.destroy$))
      .subscribe((prefs) => {
        this.notificationPreferences = prefs;
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Called when search input changes
   */
  onSearchChange(query: string): void {
    this.searchQuery = query;
    this.searchSubject.next(query);
  }

  private readonly MAX_DISPLAY = 15;

  get publicChannels(): GridChannel[] {
    // When searching, return search results from the index (all 1890 channels)
    if (this.searchQuery && this.searchQuery.length >= 2) {
      return this.searchResults;
    }

    // Default: show loaded public channels with local filtering
    const filtered = this.filterChannels(
      this.channels.filter((c) => c.channel_type === 'public' || c.channel_type === 'private')
    );

    // Sort: channels with unread or mentions first, then the rest
    // Use spread to avoid mutating original array
    const sorted = [...filtered].sort((a, b) => {
      const aHasActivity = (a.unread_count && a.unread_count > 0) || a.has_mention;
      const bHasActivity = (b.unread_count && b.unread_count > 0) || b.has_mention;

      // Channels with activity come first
      if (aHasActivity && !bHasActivity) return -1;
      if (!aHasActivity && bHasActivity) return 1;

      // Within same group, sort by last_message_at (most recent first)
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });

    return sorted;
  }

  get directMessages(): GridChannel[] {
    const filtered = this.filterChannels(
      this.channels.filter((c) => c.channel_type === 'dm' || c.channel_type === 'direct')
    );

    // Sort: DMs with unread first, then by last message time
    // Use spread to avoid mutating original array
    const sorted = [...filtered].sort((a, b) => {
      const aHasUnread = a.unread_count && a.unread_count > 0;
      const bHasUnread = b.unread_count && b.unread_count > 0;

      // DMs with unread come first
      if (aHasUnread && !bHasUnread) return -1;
      if (!aHasUnread && bHasUnread) return 1;

      // Within same group, sort by last_message_at (most recent first)
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });

    return sorted;
  }

  get groupChats(): GridChannel[] {
    const filtered = this.filterChannels(
      this.channels.filter((c) => c.channel_type === 'group')
    );

    // Sort: Groups with mentions first, then unread, then by last message time
    const sorted = [...filtered].sort((a, b) => {
      const aHasMention = a.has_mention;
      const bHasMention = b.has_mention;

      // Mentions first
      if (aHasMention && !bHasMention) return -1;
      if (!aHasMention && bHasMention) return 1;

      const aHasUnread = a.unread_count && a.unread_count > 0;
      const bHasUnread = b.unread_count && b.unread_count > 0;

      // Then unread
      if (aHasUnread && !bHasUnread) return -1;
      if (!aHasUnread && bHasUnread) return 1;

      // Then by last_message_at (most recent first)
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });

    return sorted;
  }

  private filterChannels(channels: GridChannel[]): GridChannel[] {
    let filtered = channels;

    // Apply message filter
    if (this.messageFilter === 'unread') {
      filtered = filtered.filter((c) => c.unread_count && c.unread_count > 0);
    } else if (this.messageFilter === 'mentions') {
      // Filter channels where user was mentioned (has_mention flag from backend)
      // Strict check - only show channels with explicit has_mention flag
      filtered = filtered.filter((c) => c.has_mention === true);
    }

    // Apply search filter
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter((c) => {
        const name = c.channel_type === 'dm' || c.channel_type === 'direct'
          ? c.dm_user?.display_name?.toLowerCase() || ''
          : c.name.toLowerCase();
        return name.includes(query);
      });
    }

    return filtered;
  }

  selectChannel(channel: GridChannel): void {
    this.channelSelected.emit(channel);
    // Sync: mark all activity items for this channel as read
    this.markActivityReadForChannel(channel.id);
  }

  isSelected(channel: GridChannel): boolean {
    return this.currentChannel?.id === channel.id;
  }

  toggleCreateForm(): void {
    this.showCreateForm = !this.showCreateForm;
    if (!this.showCreateForm) {
      this.resetCreateForm();
    }
  }

  resetCreateForm(): void {
    this.newChannelName = '';
    this.newChannelType = 'public';
    this.newChannelDescription = '';
  }

  createChannel(): void {
    if (!this.newChannelName.trim() || this.isCreatingChannel) return;

    this.isCreatingChannel = true;

    this.gridApi
      .createChannel({
        name: this.newChannelName.trim(),
        channel_type: this.newChannelType,
        description: this.newChannelDescription.trim() || undefined,
      })
      .subscribe({
        next: (channel) => {
          this.channelCreated.emit(channel);
          this.showCreateForm = false;
          this.resetCreateForm();
          this.isCreatingChannel = false;
        },
        error: (error) => {
          console.error('Error creating channel:', error);
          this.isCreatingChannel = false;
        },
      });
  }

  getChannelDisplayName(channel: GridChannel): string {
    if (channel.channel_type === 'dm' || channel.channel_type === 'direct') {
      return channel.dm_user?.display_name || 'Direct Message';
    }
    if (channel.channel_type === 'group') {
      return channel.name || `Group (${channel.member_count || channel.member_ids?.length || 0} members)`;
    }
    return channel.name;
  }

  getChannelIcon(channel: GridChannel): string {
    if (channel.channel_type === 'dm' || channel.channel_type === 'direct') {
      return 'person';
    }
    if (channel.channel_type === 'group') {
      return 'group';
    }
    if (channel.channel_type === 'private') {
      return 'lock';
    }
    return 'tag';
  }

  formatLastMessageTime(dateString?: string): string {
    if (!dateString) return '';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  // =====================
  // Direct Message Methods
  // =====================

  toggleDmForm(): void {
    this.showDmForm = !this.showDmForm;
    this.showCreateForm = false;
    this.showFilterPopup = false;
    this.showSettingsPopup = false;
    this.showGroupForm = false;
    if (!this.showDmForm) {
      this.dmSearchQuery = '';
    }
  }

  // =====================
  // Filter Methods
  // =====================

  toggleFilterPopup(): void {
    this.showFilterPopup = !this.showFilterPopup;
    this.showDmForm = false;
    this.showCreateForm = false;
    this.showSettingsPopup = false;
  }

  // =====================
  // Settings/Theme Methods
  // =====================

  toggleSettingsPopup(): void {
    this.showSettingsPopup = !this.showSettingsPopup;
    this.showThemeDropdown = false;
    this.showDmForm = false;
    this.showCreateForm = false;
    this.showFilterPopup = false;
  }

  get currentThemeConfig(): ThemeConfig {
    return GRID_THEMES[this.currentTheme];
  }

  selectTheme(theme: GridTheme): void {
    this.currentTheme = theme;
    this.gridThemeService.setTheme(theme);
  }

  toggleNotifications(): void {
    if (this.notificationsEnabled) {
      this.gridNotification.disable();
    } else {
      this.gridNotification.requestPermission();
    }
  }

  toggleNotificationType(type: NotificationType): void {
    const current = this.notificationPreferences[type];
    this.gridNotification.setPreference(type, !current);
  }

  setMessageFilter(filter: 'all' | 'mentions' | 'unread'): void {
    this.messageFilter = filter;
    this.showFilterPopup = false;
  }

  markAllAsRead(): void {
    this.markAllReadRequested.emit();
    this.showFilterPopup = false;
  }

  getFilterLabel(): string {
    switch (this.messageFilter) {
      case 'mentions':
        return 'Mentions';
      case 'unread':
        return 'Unread';
      default:
        return 'All';
    }
  }

  getFilterIcon(): string {
    switch (this.messageFilter) {
      case 'mentions':
        return 'alternate_email';
      case 'unread':
        return 'mark_email_unread';
      default:
        return 'inbox';
    }
  }

  /**
   * Get filtered list of users for DM selection
   * Only shows internal users (excludes customers and current user)
   */
  get filteredUsers(): User[] {
    const currentUserId = this.authProvider.getCurrentUserDocId();

    let filtered = this.users.filter((user) => {
      // Exclude current user (compare document IDs only)
      if (user.id === currentUserId) {
        return false;
      }
      // Exclude customers - only show internal users
      const userRoles = this.getUserRoles(user);
      if (userRoles.includes('Customer')) {
        return false;
      }
      return true;
    });

    // Filter by search query
    if (this.dmSearchQuery.trim()) {
      const query = this.dmSearchQuery.toLowerCase();
      filtered = filtered.filter((user) => {
        const fullName = user.sFullName || `${user.sFirstName} ${user.sLastName}`;
        return (
          fullName.toLowerCase().includes(query) ||
          user.sEmail?.toLowerCase().includes(query)
        );
      });
    }

    // Sort by name
    return filtered.sort((a, b) => {
      const nameA = a.sFullName || `${a.sFirstName} ${a.sLastName}`;
      const nameB = b.sFullName || `${b.sFirstName} ${b.sLastName}`;
      return nameA.localeCompare(nameB);
    });
  }

  /**
   * Get display name for a user
   */
  getUserDisplayName(user: User): string {
    return user.sFullName || `${user.sFirstName} ${user.sLastName}`.trim() || 'Unknown User';
  }

  /**
   * Get user roles, preferring sRoles array, fallback to sRole
   */
  private getUserRoles(user: User): string[] {
    if (user.sRoles && user.sRoles.length > 0) {
      return user.sRoles;
    }
    return user.sRole ? [user.sRole] : [];
  }

  /**
   * Get initials for a user
   */
  getUserInitials(user: User): string {
    const name = this.getUserDisplayName(user);
    return name
      .split(' ')
      .map((n) => n.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  /**
   * Check if a DM channel's user is online via presenceMap, falling back to dm_user.is_online
   */
  isUserOnline(channel: GridChannel): boolean {
    const userId = channel.dm_user?.user_id;
    if (!userId) return false;
    return this.presenceMap.get(userId) ?? channel.dm_user?.is_online ?? false;
  }

  /**
   * Select a user to start a DM
   * Checks for existing DM first, then creates via API if needed (Slack-style)
   */
  selectUserForDm(user: User): void {
    if (this.isCreatingDm) return;

    // Use document id consistently for DM pairing (id <-> id, not sUID <-> id)
    const targetUserId = user.id;
    if (!targetUserId) {
      console.error('User has no document ID:', user);
      return;
    }

    // First, check if a DM already exists with this user
    const existingDm = this.channels.find(
      (c) =>
        (c.channel_type === 'dm' || c.channel_type === 'direct') &&
        c.dm_user?.user_id === targetUserId &&
        !c.id.startsWith('pending_dm_') // Ignore any stale pending entries
    );

    if (existingDm) {
      // DM already exists - select it directly (same as clicking in sidebar)
      console.log('Grid: Found existing DM with user, selecting:', existingDm.id);
      this.showDmForm = false;
      this.dmSearchQuery = '';
      this.channelSelected.emit(existingDm);
      return;
    }

    // No existing DM - create via API (the backend handles de-duplication via dm_hash)
    const currentUserDocId = this.authProvider.getCurrentUserDocId();
    if (!currentUserDocId) {
      console.error('Cannot create DM: current user document ID not found');
      return;
    }

    this.isCreatingDm = true;
    console.log('Grid: Creating new DM with user:', targetUserId);

    this.gridApi.createDM(targetUserId, currentUserDocId).subscribe({
      next: (channel) => {
        // Populate dm_user info for display
        channel.dm_user = {
          user_id: targetUserId,
          username: user.sEmail || targetUserId,
          display_name: this.getUserDisplayName(user),
          avatar_url: user.profileImage || undefined,
          is_online: false,
        };

        this.isCreatingDm = false;
        this.showDmForm = false;
        this.dmSearchQuery = '';

        // Emit the real channel - grid.component will add it to list and select it
        this.dmSelected.emit(channel);
        console.log('Grid: DM channel created/retrieved:', channel.id);
      },
      error: (error) => {
        console.error('Error creating DM channel:', error);
        this.isCreatingDm = false;
      },
    });
  }

  // =====================
  // Nexus Menu Toggle
  // =====================

  toggleNexusMenu(): void {
    this.sidenavToggle.emit();
  }

  get isNexusMenuOpen(): boolean {
    return false; // Managed externally by consuming app
  }

  // =====================
  // Activity View Methods
  // =====================

  toggleActivityView(): void {
    this.showActivityView = !this.showActivityView;
    // Close all popups
    this.showSettingsPopup = false;
    this.showFilterPopup = false;
    this.showDmForm = false;
    this.showCreateForm = false;
    this.showGroupForm = false;

    if (this.showActivityView) {
      this.loadActivity();
    }
  }

  loadActivity(): void {
    this.isLoadingActivity = true;
    const unreadOnly = this.activityFilter === 'unread';
    this.gridApi.getActivity(unreadOnly, 50).subscribe({
      next: (items) => {
        // Preserve real-time WebSocket items (DMs, etc.) not in API response
        const apiIds = new Set(items.map(i => i.id));
        const wsItems = this.activityItems.filter(i =>
          i.id.startsWith('ws_') && !apiIds.has(i.id)
        );

        // Filter WS items by current filter
        const filteredWsItems = unreadOnly
          ? wsItems.filter(i => !i.is_read)
          : wsItems;

        // Merge: API items + preserved WS items, sorted by created_at descending
        const merged = [...items, ...filteredWsItems].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        this.activityItems = merged;
        this.unreadActivityCount = merged.filter(i => !i.is_read).length;
        this.isLoadingActivity = false;
        this.cdr.markForCheck();
      },
      error: () => {
        // On error, keep existing WS items instead of wiping everything
        const wsItems = this.activityItems.filter(i => i.id.startsWith('ws_'));
        this.activityItems = wsItems;
        this.unreadActivityCount = wsItems.filter(i => !i.is_read).length;
        this.isLoadingActivity = false;
        this.cdr.markForCheck();
      },
    });
  }

  setActivityFilter(filter: 'all' | 'unread'): void {
    this.activityFilter = filter;
    this.loadActivity();
  }

  markAllActivityRead(): void {
    // Optimistic update
    this.activityItems = this.activityItems.map(item => ({ ...item, is_read: true }));
    this.unreadActivityCount = 0;
    this.cdr.markForCheck();

    this.gridApi.markAllActivityRead().subscribe({
      error: () => {
        // Reload on error to get accurate state
        this.loadActivity();
      },
    });
  }

  onActivityItemClick(item: GridActivityItem): void {
    // Mark all activity items for this channel as read (not just the clicked one)
    this.markActivityReadForChannel(item.channel_id);

    // Emit selected event and switch back to channel view
    this.activityItemSelected.emit({ channelId: item.channel_id, messageId: item.message_id });
    this.showActivityView = false;
    this.cdr.markForCheck();
  }

  markActivityReadForChannel(channelId: string): void {
    const hadUnread = this.activityItems.some(i => i.channel_id === channelId && !i.is_read);
    if (!hadUnread) return;

    this.activityItems = this.activityItems.map(i =>
      i.channel_id === channelId ? { ...i, is_read: true } : i
    );
    this.unreadActivityCount = this.activityItems.filter(i => !i.is_read).length;
    this.cdr.markForCheck();
  }

  getActivityChannelIcon(item: GridActivityItem): string {
    switch (item.channel_type) {
      case 'dm':
      case 'direct':
        return 'person';
      case 'group':
        return 'group';
      case 'private':
        return 'lock';
      default:
        return 'tag';
    }
  }

  getActivitySenderName(item: GridActivityItem): string {
    const user = this.users.find(u => u.id === item.mentioner_user_id);
    if (user) {
      return user.sFullName || `${user.sFirstName} ${user.sLastName}`.trim() || 'Unknown User';
    }
    return 'Unknown User';
  }

  getActivitySenderInitials(item: GridActivityItem): string {
    const name = this.getActivitySenderName(item);
    return name
      .split(' ')
      .map(n => n.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  getActivitySenderAvatar(item: GridActivityItem): string | undefined {
    const user = this.users.find(u => u.id === item.mentioner_user_id);
    return user?.profileImage || undefined;
  }

  formatActivityMessage(content: string): string {
    if (!content) return '';
    // Replace <@userId> with @DisplayName
    return content.replace(/<@([A-Za-z0-9_-]+)>/g, (match, userId) => {
      const user = this.users.find(u => u.id === userId);
      if (user) {
        const name = user.sFullName || `${user.sFirstName} ${user.sLastName}`.trim() || 'Unknown';
        return `@${name}`;
      }
      return match;
    });
  }

  addActivityFromMention(channelId: string, message: any, mentionerId: string): void {
    const newItem: GridActivityItem = {
      id: `ws_${Date.now()}`,
      mentioner_user_id: mentionerId,
      message_content: message?.content || '',
      created_at: new Date().toISOString(),
      is_read: false,
      channel_id: channelId,
      channel_type: '',
      channel_name: '',
      message_id: message?.id || '',
    };

    // Try to populate channel info from existing channels
    const channel = this.channels.find(c => c.id === channelId);
    if (channel) {
      newItem.channel_type = channel.channel_type;
      if (channel.channel_type === 'dm' || channel.channel_type === 'direct') {
        newItem.channel_name = channel.dm_user?.display_name || 'Direct Message';
      } else {
        newItem.channel_name = channel.name || '';
      }
    }

    this.activityItems = [newItem, ...this.activityItems];
    this.unreadActivityCount++;
    this.cdr.markForCheck();
  }

  // =====================
  // Group Chat Methods
  // =====================

  /**
   * Toggle group creation form visibility
   */
  toggleGroupForm(): void {
    this.showGroupForm = !this.showGroupForm;
    this.showCreateForm = false;
    this.showDmForm = false;
    this.showFilterPopup = false;
    this.showSettingsPopup = false;
    if (!this.showGroupForm) {
      this.resetGroupForm();
    }
  }

  /**
   * Reset group creation form
   */
  resetGroupForm(): void {
    this.selectedGroupMembers = [];
    this.newGroupName = '';
    this.groupSearchQuery = '';
  }

  /**
   * Get filtered list of users for group member selection
   * Only shows internal users (excludes customers and current user)
   */
  get filteredUsersForGroup(): User[] {
    const currentUserId = this.authProvider.getCurrentUserDocId();

    let filtered = this.users.filter((user) => {
      // Exclude current user
      if (user.id === currentUserId) {
        return false;
      }
      // Exclude customers - only show internal users
      const userRoles = this.getUserRoles(user);
      if (userRoles.includes('Customer')) {
        return false;
      }
      return true;
    });

    // Filter by search query
    if (this.groupSearchQuery.trim()) {
      const query = this.groupSearchQuery.toLowerCase();
      filtered = filtered.filter((user) => {
        const fullName = user.sFullName || `${user.sFirstName} ${user.sLastName}`;
        return (
          fullName.toLowerCase().includes(query) ||
          user.sEmail?.toLowerCase().includes(query)
        );
      });
    }

    // Sort by name
    return filtered.sort((a, b) => {
      const nameA = a.sFullName || `${a.sFirstName} ${a.sLastName}`;
      const nameB = b.sFullName || `${b.sFirstName} ${b.sLastName}`;
      return nameA.localeCompare(nameB);
    });
  }

  /**
   * Toggle user selection for group
   */
  toggleUserForGroup(user: User): void {
    const index = this.selectedGroupMembers.findIndex((u) => u.id === user.id);
    if (index >= 0) {
      this.selectedGroupMembers.splice(index, 1);
    } else {
      this.selectedGroupMembers.push(user);
    }
  }

  /**
   * Check if user is selected for group
   */
  isUserSelectedForGroup(user: User): boolean {
    return this.selectedGroupMembers.some((u) => u.id === user.id);
  }

  /**
   * Create a new group chat
   */
  createGroup(): void {
    if (this.selectedGroupMembers.length < 1 || this.isCreatingGroup) return;

    const currentUserId = this.authProvider.getCurrentUserDocId();
    if (!currentUserId) {
      console.error('Cannot create group: current user document ID not found');
      return;
    }

    this.isCreatingGroup = true;

    // Include current user and all selected members (filter out any undefined IDs)
    const userIds: string[] = [
      currentUserId,
      ...this.selectedGroupMembers.map((u) => u.id).filter((id): id is string => !!id),
    ];

    const request: GridCreateGroupRequest = {
      user_id: currentUserId,
      user_ids: userIds,
      name: this.newGroupName.trim() || undefined,
    };

    console.log('Grid: Creating group with members:', userIds);

    this.gridApi.createGroup(request).subscribe({
      next: (channel) => {
        this.isCreatingGroup = false;
        this.showGroupForm = false;
        this.resetGroupForm();
        this.groupCreated.emit(channel);
        console.log('Grid: Group created/retrieved:', channel.id);
      },
      error: (error) => {
        console.error('Error creating group:', error);
        this.isCreatingGroup = false;
      },
    });
  }

}
