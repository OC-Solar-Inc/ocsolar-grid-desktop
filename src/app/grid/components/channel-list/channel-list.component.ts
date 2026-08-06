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
  newGroupReplyOnly = false;
  isCreatingGroup = false;

  // Message filter
  showFilterPopup = false;
  messageFilter: 'all' | 'mentions' | 'unread' | 'needs_response' = 'all';

  // Settings/Theme
  showSettingsPopup = false;
  showThemeDropdown = false;
  currentTheme: GridTheme = 'theGrid';
  themeOptions: ThemeConfig[] = Object.values(GRID_THEMES);

  // Collapsible sections
  // Channels is the longest and least personal list, so it starts collapsed;
  // its header still carries the unread count.
  isChannelsCollapsed = true;
  isGroupsCollapsed = false;
  isDmsCollapsed = false;

  // Notifications
  notificationsEnabled = false;
  notificationPreferences: NotificationPreferences = { dm: true, channel: true, mention: true, needs_response: true };

  // Activity view
  showActivityView = false;
  activityItems: GridActivityItem[] = [];
  isLoadingActivity = false;
  activityFilter: 'all' | 'unread' | 'mentions' | 'replies' | 'needs_response' = 'all';
  unreadActivityCount = 0;

  private destroy$ = new Subject<void>();

  showNexusToggle = true;

  // Conversation preferences. Stored per browser profile for a quick rollout;
  // cross-device would need authenticated preference endpoints.
  private readonly FAVORITE_KEY = 'gridFavoriteConversationIds';
  private readonly MUTED_KEY = 'gridMutedConversationIds';
  private favoriteConversationIds = new Set<string>();
  private mutedConversationIds = new Set<string>();
  private readonly MAX_DISPLAY = 15;
  showAllChannels = false;
  showAllGroups = false;
  showAllDms = false;

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
    this.favoriteConversationIds = this.loadIdSet(this.FAVORITE_KEY);
    this.mutedConversationIds = this.loadIdSet(this.MUTED_KEY);
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
  // A search has to be able to reach a collapsed section, or results in it are
  // simply invisible — which matters most for Channels, now collapsed by
  // default. The chevron follows the same effective state.
  get channelsExpanded(): boolean { return !this.isChannelsCollapsed || !!this.searchQuery; }
  get groupsExpanded(): boolean { return !this.isGroupsCollapsed || !!this.searchQuery; }
  get dmsExpanded(): boolean { return !this.isDmsCollapsed || !!this.searchQuery; }

  onSearchChange(query: string): void {
    this.searchQuery = query;
    this.searchSubject.next(query);
  }


  private loadIdSet(key: string): Set<string> {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []);
    } catch {
      return new Set<string>();
    }
  }

  private saveIdSet(key: string, values: Set<string>): void {
    try {
      localStorage.setItem(key, JSON.stringify([...values]));
    } catch {
      // Storage unavailable (private mode); preferences stay in memory only.
    }
  }

  isFavorite(channel: GridChannel): boolean {
    return this.favoriteConversationIds.has(channel.id);
  }

  isMuted(channel: GridChannel): boolean {
    return this.mutedConversationIds.has(channel.id);
  }

  toggleFavorite(channel: GridChannel, event: Event): void {
    event.stopPropagation();
    if (this.isFavorite(channel)) this.favoriteConversationIds.delete(channel.id);
    else this.favoriteConversationIds.add(channel.id);
    this.saveIdSet(this.FAVORITE_KEY, this.favoriteConversationIds);
    this.cdr.markForCheck();
  }

  toggleMuted(channel: GridChannel, event: Event): void {
    event.stopPropagation();
    if (this.isMuted(channel)) this.mutedConversationIds.delete(channel.id);
    else this.mutedConversationIds.add(channel.id);
    this.saveIdSet(this.MUTED_KEY, this.mutedConversationIds);
    this.cdr.markForCheck();
  }

  /** Favourites first, then open response requests, muted last. */
  private sortConversations(channels: GridChannel[], mentionsFirst = false): GridChannel[] {
    return [...channels].sort((a, b) => {
      const favoriteDiff = Number(this.isFavorite(b)) - Number(this.isFavorite(a));
      if (favoriteDiff) return favoriteDiff;

      const responseDiff = Number((b.needs_response_count || 0) > 0) - Number((a.needs_response_count || 0) > 0);
      if (responseDiff) return responseDiff;

      const mutedDiff = Number(this.isMuted(a)) - Number(this.isMuted(b));
      if (mutedDiff) return mutedDiff;

      if (mentionsFirst) {
        const mentionDiff = Number(!!b.has_mention) - Number(!!a.has_mention);
        if (mentionDiff) return mentionDiff;
      }

      const unreadDiff = Number((b.unread_count || 0) > 0) - Number((a.unread_count || 0) > 0);
      if (unreadDiff) return unreadDiff;

      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });
  }

  private publicChannelCandidates(): GridChannel[] {
    // Searching hits the client-side index so all public channels are reachable,
    // not just the page already loaded — desktop-specific behaviour.
    const source = this.searchQuery && this.searchQuery.length >= 2
      ? this.searchResults
      : this.channels.filter((c) => c.channel_type === 'public' || c.channel_type === 'private');
    return this.filterChannels(source);
  }

  private dmCandidates(): GridChannel[] {
    return this.filterChannels(this.channels.filter((c) => c.channel_type === 'dm' || c.channel_type === 'direct'));
  }

  private groupCandidates(): GridChannel[] {
    return this.filterChannels(this.channels.filter((c) => c.channel_type === 'group'));
  }

  get publicChannels(): GridChannel[] {
    const sorted = this.sortConversations(this.publicChannelCandidates(), true);
    return this.searchQuery || this.showAllChannels ? sorted : sorted.slice(0, this.MAX_DISPLAY);
  }

  get directMessages(): GridChannel[] {
    const sorted = this.sortConversations(this.dmCandidates());
    return this.searchQuery || this.showAllDms ? sorted : sorted.slice(0, this.MAX_DISPLAY);
  }

  get groupChats(): GridChannel[] {
    const sorted = this.sortConversations(this.groupCandidates(), true);
    return this.searchQuery || this.showAllGroups ? sorted : sorted.slice(0, this.MAX_DISPLAY);
  }

  get publicChannelCount(): number { return this.publicChannelCandidates().length; }
  get groupCount(): number { return this.groupCandidates().length; }
  get dmCount(): number { return this.dmCandidates().length; }
  get unreadChannelCount(): number {
    return this.channels.filter(c => (c.channel_type === 'public' || c.channel_type === 'private') && (c.unread_count || 0) > 0).length;
  }
  get unreadGroupCount(): number {
    return this.channels.filter(c => c.channel_type === 'group' && (c.unread_count || 0) > 0).length;
  }
  get unreadDmCount(): number {
    return this.channels.filter(c => (c.channel_type === 'dm' || c.channel_type === 'direct') && (c.unread_count || 0) > 0).length;
  }
  get needsResponseCount(): number {
    return this.channels.reduce((total, channel) => total + (channel.needs_response_count || 0), 0);
  }

  toggleShowAll(section: 'channels' | 'groups' | 'dms'): void {
    if (section === 'channels') this.showAllChannels = !this.showAllChannels;
    if (section === 'groups') this.showAllGroups = !this.showAllGroups;
    if (section === 'dms') this.showAllDms = !this.showAllDms;
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
    } else if (this.messageFilter === 'needs_response') {
      filtered = filtered.filter((c) => (c.needs_response_count || 0) > 0);
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

  setMessageFilter(filter: 'all' | 'mentions' | 'unread' | 'needs_response'): void {
    this.messageFilter = filter;
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
  /**
   * Empty-state copy for a section. The list getters are already filtered, so
   * "No direct messages yet" would be a lie whenever a filter emptied them —
   * say what the filter did instead.
   */
  emptyStateLabel(kind: 'channels' | 'groups' | 'dms'): string {
    const noun = kind === 'dms' ? 'direct messages' : kind === 'groups' ? 'groups' : 'channels';
    switch (this.messageFilter) {
      case 'unread': return `No unread ${noun}`;
      case 'mentions': return `No ${noun} with mentions`;
      case 'needs_response': return `No ${noun} need a response`;
      default: return `No ${noun} yet`;
    }
  }

  /**
   * Preview text for a conversation row.
   *
   * Message bodies store mentions as the raw token <@userId>. Rendering that
   * verbatim leaks internal IDs into the sidebar, so resolve each one to a
   * display name and fall back to "@someone" for users outside the loaded
   * directory. The server truncates the preview, which can bisect a token —
   * drop the orphan rather than printing half of it.
   */
  formatPreview(preview?: string | null): string {
    if (!preview) return '';
    const resolved = preview.replace(/<@([A-Za-z0-9_-]+)>/g, (_match, userId: string) => {
      const user = this.users.find(u => u.id === userId);
      return user ? `@${this.getUserDisplayName(user)}` : '@someone';
    });
    return resolved.replace(/<@[A-Za-z0-9_-]*$/, '').trimEnd();
  }

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
    const needsResponseOnly = this.activityFilter === 'needs_response';
    this.gridApi.getActivity(unreadOnly, 50, needsResponseOnly).subscribe({
      next: (items) => {
        // Preserve real-time WebSocket items not already in API response (dedup by message_id)
        const apiMessageIds = new Set(items.map(i => i.message_id).filter(Boolean));
        const wsItems = this.activityItems.filter(i =>
          i.id.startsWith('ws_') && (!i.message_id || !apiMessageIds.has(i.message_id))
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

  setActivityFilter(filter: 'all' | 'unread' | 'mentions' | 'replies' | 'needs_response'): void {
    this.activityFilter = filter;
    this.loadActivity();
  }

  /** Mentions, replies and needs-response are narrowed client-side; unread and
   *  needs-response are also pushed to the API so the server can filter. */
  get displayedActivityItems(): GridActivityItem[] {
    if (this.activityFilter === 'unread') return this.activityItems.filter(item => !item.is_read);
    if (this.activityFilter === 'mentions') return this.activityItems.filter(item => !item.event_type || item.event_type === 'mention');
    if (this.activityFilter === 'replies') return this.activityItems.filter(item => item.event_type === 'reply');
    if (this.activityFilter === 'needs_response') return this.activityItems.filter(item => item.event_type === 'needs_response' && item.needs_response !== false);
    return this.activityItems;
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
    this.markActivityItemRead(item.id);

    // Emit selected event and switch back to channel view
    this.activityItemSelected.emit({ channelId: item.channel_id, messageId: item.message_id });
    this.showActivityView = false;
    this.cdr.markForCheck();
  }

  /** Only the opened item goes read; the rest of the conversation's history
   *  stays in the feed. Synthetic ws_ items exist client-side only. */
  private markActivityItemRead(itemId: string): void {
    this.activityItems = this.activityItems.map(item =>
      item.id === itemId ? { ...item, is_read: true } : item
    );
    this.unreadActivityCount = this.activityItems.filter(item => !item.is_read).length;
    if (!itemId.startsWith('ws_')) {
      this.gridApi.markActivityRead(itemId).subscribe({
        error: () => this.loadActivity(),
      });
    }
  }

  /** Reflects an open/closed response request in the feed without a reload. */
  addActivityFromNotification(
    channelId: string,
    message: any,
    senderId: string,
    eventType: 'mention' | 'dm' | 'channel' | 'reply' | 'needs_response'
  ): void {
    const messageId = message?.id || '';
    if (messageId && this.activityItems.some(item => item.message_id === messageId && item.event_type === eventType)) return;
    const newItem: GridActivityItem = {
      id: `ws_${eventType}_${messageId || Date.now()}`,
      mentioner_user_id: senderId,
      message_content: message?.content || '',
      created_at: new Date().toISOString(),
      is_read: false,
      channel_id: channelId,
      channel_type: '',
      channel_name: '',
      message_id: messageId,
      event_type: eventType,
      parent_message_id: message?.parent || null,
      needs_response: message?.needs_response,
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

  updateNeedsResponseActivityState(messageId: string, needsResponse: boolean): void {
    this.activityItems = this.activityItems.map(item =>
      item.message_id === messageId && item.event_type === 'needs_response'
        ? { ...item, needs_response: needsResponse, is_read: needsResponse ? item.is_read : true }
        : item
    );
    this.unreadActivityCount = this.activityItems.filter(item => !item.is_read).length;
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
    if (item.event_type === 'needs_response') return 'priority_high';
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
    // Deduplicate: skip if this message is already in the activity list
    if (message?.id && this.activityItems.some(item => item.message_id === message.id)) {
      return;
    }

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
    this.newGroupReplyOnly = false;
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
      is_reply_only: this.newGroupReplyOnly || undefined,
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
