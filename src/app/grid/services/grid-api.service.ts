import { Injectable, Inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError, of, from } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { GRID_CONFIG, GRID_AUTH_PROVIDER, GridConfig, GridAuthProvider } from '../tokens/grid-tokens';
import {
  GridChannel,
  GridMessage,
  GridProfile,
  GridChannelMember,
  GridPaginatedResponse,
  GridCursorPaginatedResponse,
  GridCreateChannelRequest,
  GridCreateGroupRequest,
  GridCreateMessageRequest,
  GridUpdateProfileRequest,
  GridChannelFilesResponse,
  GridActivityItem,
} from '../interfaces/grid.interface';

/**
 * Lightweight search index entry (id + name only)
 * ~75 bytes per channel, ~140KB total for 1890 channels
 */
interface ChannelSearchIndexEntry {
  id: string;
  name: string;
}

@Injectable()
export class GridApiService {
  private baseUrl: string;

  /**
   * Client-side search index cache
   * Lazy-loaded on first search, enables instant (<5ms) channel search
   */
  private searchIndex: ChannelSearchIndexEntry[] | null = null;
  private searchIndexLoading: Promise<ChannelSearchIndexEntry[]> | null = null;

  constructor(
    private http: HttpClient,
    @Inject(GRID_CONFIG) private config: GridConfig,
    @Inject(GRID_AUTH_PROVIDER) private authProvider: GridAuthProvider
  ) {
    this.baseUrl = config.siteFrameApiUrl;
  }

  /**
   * Get the current user's Firestore document ID
   */
  private getCurrentUserId(): string | null {
    return this.authProvider.getCurrentUserDocId();
  }

  /**
   * Helper to handle API errors
   */
  private handleError<T>(operation: string) {
    return (error: any): Observable<T> => {
      console.error(`Grid API Error (${operation}):`, error);
      return throwError(() => error);
    };
  }

  // =====================
  // Channel Operations
  // =====================

  /**
   * Get channels the current user is a member of
   */
  getMyChannels(): Observable<GridChannel[]> {
    const userId = this.getCurrentUserId();
    return this.http
      .get<GridChannel[]>(`${this.baseUrl}/chat/channels/my_channels/?user_id=${userId}`)
      .pipe(catchError(this.handleError<GridChannel[]>('getMyChannels')));
  }

  /**
   * Get public channels with cursor-based pagination
   */
  getPublicChannels(
    limit: number = 15,
    cursor?: string
  ): Observable<GridCursorPaginatedResponse<GridChannel>> {
    const userId = this.getCurrentUserId();
    let params = new HttpParams()
      .set('limit', limit.toString());
    if (userId) {
      params = params.set('user_id', userId);
    }
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.http
      .get<GridCursorPaginatedResponse<GridChannel>>(
        `${this.baseUrl}/chat/channels/public/`,
        { params }
      )
      .pipe(catchError(this.handleError<GridCursorPaginatedResponse<GridChannel>>('getPublicChannels')));
  }

  /**
   * Load the lightweight search index (lazy, cached)
   */
  private async loadSearchIndex(): Promise<ChannelSearchIndexEntry[]> {
    if (this.searchIndex) {
      return this.searchIndex;
    }

    if (this.searchIndexLoading) {
      return this.searchIndexLoading;
    }

    this.searchIndexLoading = this.http
      .get<ChannelSearchIndexEntry[]>(`${this.baseUrl}/chat/channels/search-index/`)
      .pipe(
        tap(index => {
          this.searchIndex = index;
          this.searchIndexLoading = null;
          console.log(`Grid: Loaded search index with ${index.length} channels`);
        }),
        catchError(error => {
          this.searchIndexLoading = null;
          console.error('Grid: Failed to load search index:', error);
          return of([]);
        })
      )
      .toPromise() as Promise<ChannelSearchIndexEntry[]>;

    return this.searchIndexLoading;
  }

  clearSearchIndexCache(): void {
    this.searchIndex = null;
    this.searchIndexLoading = null;
  }

  searchChannels(query: string, limit: number = 15): Observable<GridChannel[]> {
    if (!query || query.length < 2) {
      return of([]);
    }

    return from(this.loadSearchIndex()).pipe(
      map(index => {
        const q = query.toLowerCase();
        const matches = index
          .filter(c => c.name.toLowerCase().includes(q))
          .slice(0, limit);

        return matches.map(m => ({
          id: m.id,
          name: m.name,
          channel_type: 'public' as const,
          is_archived: false,
          created_at: '',
          updated_at: '',
          description: '',
          created_by_id: '',
        })) as GridChannel[];
      }),
      catchError(this.handleError<GridChannel[]>('searchChannels'))
    );
  }

  searchChannelsServer(query: string, limit: number = 15): Observable<GridChannel[]> {
    if (!query || query.length < 2) {
      return of([]);
    }
    const userId = this.getCurrentUserId();
    let params = new HttpParams()
      .set('q', query)
      .set('limit', limit.toString());
    if (userId) {
      params = params.set('user_id', userId);
    }
    return this.http
      .get<GridChannel[]>(`${this.baseUrl}/chat/channels/search/`, { params })
      .pipe(catchError(this.handleError<GridChannel[]>('searchChannelsServer')));
  }

  getChannel(channelId: string): Observable<GridChannel> {
    const userId = this.getCurrentUserId();
    return this.http
      .get<GridChannel>(`${this.baseUrl}/chat/channels/${channelId}/?user_id=${userId}`)
      .pipe(catchError(this.handleError<GridChannel>('getChannel')));
  }

  createChannel(data: GridCreateChannelRequest): Observable<GridChannel> {
    const userId = this.getCurrentUserId();
    return this.http
      .post<GridChannel>(`${this.baseUrl}/chat/channels/`, {
        name: data.name,
        description: data.description,
        channel_type: data.channel_type,
        creator_id: userId,
      })
      .pipe(catchError(this.handleError<GridChannel>('createChannel')));
  }

  createDM(targetUserId: string, requesterDocId: string): Observable<GridChannel> {
    return this.http
      .post<GridChannel>(`${this.baseUrl}/chat/channels/create_dm/`, {
        user_id: targetUserId,
        requester_id: requesterDocId,
      })
      .pipe(catchError(this.handleError<GridChannel>('createDM')));
  }

  createGroup(data: GridCreateGroupRequest): Observable<GridChannel> {
    return this.http
      .post<GridChannel>(`${this.baseUrl}/chat/channels/create_group/`, {
        user_id: data.user_id,
        user_ids: data.user_ids,
        name: data.name || undefined,
      })
      .pipe(catchError(this.handleError<GridChannel>('createGroup')));
  }

  getMyGroups(): Observable<GridChannel[]> {
    const userId = this.getCurrentUserId();
    return this.http
      .get<GridChannel[]>(`${this.baseUrl}/chat/channels/my_groups/?user_id=${userId}`)
      .pipe(catchError(this.handleError<GridChannel[]>('getMyGroups')));
  }

  joinChannel(channelId: string): Observable<GridChannelMember> {
    const userId = this.getCurrentUserId();
    return this.http
      .post<GridChannelMember>(`${this.baseUrl}/chat/channels/${channelId}/join/`, {
        user_id: userId,
      })
      .pipe(catchError(this.handleError<GridChannelMember>('joinChannel')));
  }

  leaveChannel(channelId: string): Observable<void> {
    const userId = this.getCurrentUserId();
    return this.http
      .post<void>(`${this.baseUrl}/chat/channels/${channelId}/leave/`, {
        user_id: userId,
      })
      .pipe(catchError(this.handleError<void>('leaveChannel')));
  }

  getChannelMembers(channelId: string): Observable<GridChannelMember[]> {
    const userId = this.getCurrentUserId();
    return this.http
      .get<GridChannelMember[]>(
        `${this.baseUrl}/chat/channels/${channelId}/members/?user_id=${userId}`
      )
      .pipe(catchError(this.handleError<GridChannelMember[]>('getChannelMembers')));
  }

  addChannelMembers(channelId: string, userIds: string[]): Observable<void> {
    const userId = this.getCurrentUserId();
    return this.http
      .post<void>(`${this.baseUrl}/chat/channels/${channelId}/add_members/`, {
        user_id: userId,
        user_ids: userIds,
      })
      .pipe(catchError(this.handleError<void>('addChannelMembers')));
  }

  removeChannelMembers(channelId: string, userIds: string[]): Observable<{ removed: string[]; errors: any[] }> {
    const userId = this.getCurrentUserId();
    return this.http
      .post<{ removed: string[]; errors: any[] }>(`${this.baseUrl}/chat/channels/${channelId}/remove_members/`, {
        user_id: userId,
        user_ids: userIds,
      })
      .pipe(catchError(this.handleError<{ removed: string[]; errors: any[] }>('removeChannelMembers')));
  }

  // =====================
  // Message Operations
  // =====================

  getMessages(
    channelId: string,
    cursor?: string,
    limit: number = 50
  ): Observable<GridMessage[]> {
    const userId = this.getCurrentUserId();
    let params = new HttpParams().set('limit', limit.toString());
    if (userId) {
      params = params.set('user_id', userId);
    }
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    const url = `${this.baseUrl}/chat/channels/${channelId}/messages/`;
    console.log('Grid API: Fetching messages from:', url, 'params:', { user_id: userId, limit });
    return this.http
      .get<GridMessage[]>(url, { params })
      .pipe(catchError(this.handleError<GridMessage[]>('getMessages')));
  }

  getThreadReplies(
    messageId: string,
    cursor?: string,
    limit: number = 50
  ): Observable<GridMessage[]> {
    const userId = this.getCurrentUserId();
    let params = new HttpParams()
      .set('limit', limit.toString())
      .set('user_id', userId || '');
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.http
      .get<GridMessage[]>(
        `${this.baseUrl}/chat/messages/${messageId}/replies/`,
        { params }
      )
      .pipe(catchError(this.handleError<GridMessage[]>('getThreadReplies')));
  }

  createMessage(data: GridCreateMessageRequest, userDocId: string): Observable<GridMessage> {
    return this.http
      .post<GridMessage>(`${this.baseUrl}/chat/messages/create/`, {
        channel: data.channel,
        content: data.content,
        user_id: userDocId,
        ...(data.parent && { parent: data.parent }),
        ...(data.attachment_ids?.length && { attachment_ids: data.attachment_ids }),
      })
      .pipe(catchError(this.handleError<GridMessage>('createMessage')));
  }

  editMessage(messageId: string, content: string): Observable<GridMessage> {
    const userId = this.getCurrentUserId();
    return this.http
      .patch<GridMessage>(`${this.baseUrl}/chat/messages/${messageId}/`, {
        user_id: userId,
        content,
      })
      .pipe(catchError(this.handleError<GridMessage>('editMessage')));
  }

  deleteMessage(messageId: string): Observable<void> {
    const userId = this.getCurrentUserId();
    return this.http
      .request<void>('DELETE', `${this.baseUrl}/chat/messages/${messageId}/`, {
        body: { user_id: userId },
      })
      .pipe(catchError(this.handleError<void>('deleteMessage')));
  }

  markAsRead(channelId: string, lastReadMessageId?: string): Observable<void> {
    const userId = this.getCurrentUserId();
    return this.http
      .post<void>(`${this.baseUrl}/chat/channels/${channelId}/mark_read/`, {
        user_id: userId,
        ...(lastReadMessageId && { last_read_message_id: lastReadMessageId }),
      })
      .pipe(catchError(this.handleError<void>('markAsRead')));
  }

  // =====================
  // Profile Operations
  // =====================

  getMyProfile(): Observable<GridProfile> {
    const userId = this.getCurrentUserId();
    return this.http
      .get<GridProfile>(`${this.baseUrl}/chat/profiles/me/?user_id=${userId}`)
      .pipe(catchError(this.handleError<GridProfile>('getMyProfile')));
  }

  updateMyProfile(data: GridUpdateProfileRequest): Observable<GridProfile> {
    const userId = this.getCurrentUserId();
    return this.http
      .patch<GridProfile>(`${this.baseUrl}/chat/profiles/me/`, {
        user_id: userId,
        ...data,
      })
      .pipe(catchError(this.handleError<GridProfile>('updateMyProfile')));
  }

  getProfile(profileUserId: string): Observable<GridProfile> {
    const userId = this.getCurrentUserId();
    return this.http
      .get<GridProfile>(`${this.baseUrl}/chat/profiles/${profileUserId}/?user_id=${userId}`)
      .pipe(catchError(this.handleError<GridProfile>('getProfile')));
  }

  searchUsers(query: string): Observable<GridProfile[]> {
    const params = new HttpParams().set('q', query);
    return this.http
      .get<GridProfile[]>(`${this.baseUrl}/chat/profiles/search/`, { params })
      .pipe(catchError(this.handleError<GridProfile[]>('searchUsers')));
  }

  // =====================
  // Channel Files Operations
  // =====================

  getChannelFiles(
    channelId: string,
    pageSize: number = 10,
    continuationToken?: string
  ): Observable<GridChannelFilesResponse> {
    const userId = this.getCurrentUserId();
    let params = new HttpParams().set('page_size', pageSize.toString());

    if (userId) {
      params = params.set('user_id', userId);
    }
    if (continuationToken) {
      params = params.set('continuation_token', continuationToken);
    }

    return this.http
      .get<GridChannelFilesResponse>(
        `${this.baseUrl}/chat/channels/${channelId}/files/`,
        { params }
      )
      .pipe(catchError(this.handleError<GridChannelFilesResponse>('getChannelFiles')));
  }

  // =====================
  // Activity Operations
  // =====================

  getActivity(unreadOnly: boolean, limit: number): Observable<GridActivityItem[]> {
    const userId = this.getCurrentUserId();
    const params = new HttpParams()
      .set('user_id', userId || '')
      .set('unread_only', unreadOnly.toString())
      .set('limit', limit.toString());
    return this.http
      .get<GridActivityItem[]>(`${this.baseUrl}/chat/activity/`, { params })
      .pipe(catchError(this.handleError<GridActivityItem[]>('getActivity')));
  }

  markAllActivityRead(): Observable<any> {
    const userId = this.getCurrentUserId();
    return this.http
      .post<any>(`${this.baseUrl}/chat/activity/mark_all_read/`, { user_id: userId })
      .pipe(catchError(this.handleError<any>('markAllActivityRead')));
  }
}
