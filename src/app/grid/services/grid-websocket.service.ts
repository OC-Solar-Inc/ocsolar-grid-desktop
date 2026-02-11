import { Injectable, Inject, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { GRID_CONFIG, GRID_AUTH_PROVIDER, GridConfig, GridAuthProvider } from '../tokens/grid-tokens';
import {
  GridWsMessage,
  GridWsConnectionState,
  GridWsNewMessage,
  GridWsMessageEdited,
  GridWsMessageDeleted,
  GridWsTypingIndicator,
  GridWsPresenceUpdate,
  GridWsUnreadUpdate,
  GridWsError,
  GridWsDmNotification,
  GridWsJoinChannel,
  GridWsLeaveChannel,
  GridWsSendMessage,
  GridWsEditMessage,
  GridWsDeleteMessage,
  GridWsTypingAction,
  GridWsMarkRead,
  GridMessage,
  GridTypingUser,
} from '../interfaces/grid.interface';

@Injectable()
export class GridWebsocketService implements OnDestroy {
  private socket: WebSocket | null = null;
  private wsUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pingTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Connection state
  private connectionStateSubject = new BehaviorSubject<GridWsConnectionState>('disconnected');
  public connectionState$ = this.connectionStateSubject.asObservable();

  // Message streams
  private newMessageSubject = new Subject<GridMessage>();
  public newMessage$ = this.newMessageSubject.asObservable();

  private messageEditedSubject = new Subject<GridMessage>();
  public messageEdited$ = this.messageEditedSubject.asObservable();

  private messageDeletedSubject = new Subject<{ messageId: string; channelId: string }>();
  public messageDeleted$ = this.messageDeletedSubject.asObservable();

  private typingIndicatorSubject = new Subject<GridTypingUser>();
  public typingIndicator$ = this.typingIndicatorSubject.asObservable();

  private presenceUpdateSubject = new Subject<{ userId: string; isOnline: boolean; lastSeen?: string }>();
  public presenceUpdate$ = this.presenceUpdateSubject.asObservable();

  private unreadUpdateSubject = new Subject<{ channelId: string; unreadCount: number }>();
  public unreadUpdate$ = this.unreadUpdateSubject.asObservable();

  private errorSubject = new Subject<{ error: string; code?: string }>();
  public error$ = this.errorSubject.asObservable();

  private dmNotificationSubject = new Subject<{ channelId: string; message: GridMessage; senderId: string }>();
  public dmNotification$ = this.dmNotificationSubject.asObservable();

  private channelNotificationSubject = new Subject<{ channelId: string; message: GridMessage; senderId: string }>();
  public channelNotification$ = this.channelNotificationSubject.asObservable();

  private mentionNotificationSubject = new Subject<{ channelId: string; message: GridMessage; mentionerId: string }>();
  public mentionNotification$ = this.mentionNotificationSubject.asObservable();

  private memberJoinedSubject = new Subject<{ channelId: string; member: { user_id: string; role: string; joined_at: string | null } }>();
  public memberJoined$ = this.memberJoinedSubject.asObservable();

  private memberLeftSubject = new Subject<{ channelId: string; userId: string }>();
  public memberLeft$ = this.memberLeftSubject.asObservable();

  private activitySubject = new Subject<void>();
  public activity$ = this.activitySubject.asObservable();

  private markReadFallbackSubject = new Subject<{ channelId: string; lastReadMessageId?: string }>();
  public markReadFallback$ = this.markReadFallbackSubject.asObservable();

  // Track joined channels
  private joinedChannels = new Set<string>();

  // Track disconnect reason to prevent auto-reconnect on idle disconnect
  private disconnectReason: 'user' | 'idle' | 'server' | null = null;

  constructor(
    @Inject(GRID_CONFIG) private config: GridConfig,
    @Inject(GRID_AUTH_PROVIDER) private authProvider: GridAuthProvider
  ) {
    this.wsUrl = config.wsUrl;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      console.log('Grid WebSocket already connected');
      return;
    }

    this.connectionStateSubject.next('connecting');

    try {
      const token = await this.authProvider.getIdToken();
      const userDocId = this.authProvider.getCurrentUserDocId();
      const wsEndpoint = `${this.wsUrl}/ws/chat/?token=${token}&user_id=${userDocId}`;

      this.socket = new WebSocket(wsEndpoint);

      this.socket.onopen = () => {
        console.log('Grid WebSocket connected');
        this.connectionStateSubject.next('connected');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.startPingPong();

        this.joinedChannels.forEach((channelId) => {
          this.joinChannel(channelId);
        });
      };

      this.socket.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as GridWsMessage;
          this.handleMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.socket.onerror = (error) => {
        console.error('Grid WebSocket error:', error);
        this.errorSubject.next({ error: 'WebSocket connection error' });
      };

      this.socket.onclose = (event) => {
        console.log('Grid WebSocket closed:', event.code, event.reason, 'reason:', this.disconnectReason);
        this.stopPingPong();
        this.connectionStateSubject.next('disconnected');

        if (event.code !== 1000 && this.disconnectReason !== 'idle') {
          this.attemptReconnect();
        }

        this.disconnectReason = null;
      };
    } catch (error) {
      console.error('Error connecting to Grid WebSocket:', error);
      this.connectionStateSubject.next('disconnected');
      this.attemptReconnect();
    }
  }

  disconnect(): void {
    this.disconnectReason = 'user';
    this.stopPingPong();
    this.clearReconnectTimeout();

    if (this.socket) {
      this.socket.close(1000, 'Client disconnect');
      this.socket = null;
    }

    this.connectionStateSubject.next('disconnected');
    this.joinedChannels.clear();
  }

  disconnectForIdle(reason: string): void {
    this.disconnectReason = 'idle';
    this.stopPingPong();
    this.clearReconnectTimeout();

    if (this.socket) {
      this.socket.close(1000, reason);
      this.socket = null;
    }

    this.connectionStateSubject.next('disconnected');
    console.log('Grid WebSocket: Disconnected for idle, preserving', this.joinedChannels.size, 'channels');
  }

  private handleMessage(data: GridWsMessage): void {
    this.activitySubject.next();

    switch (data.type) {
      case 'connection_established':
        console.log('Grid WebSocket: Connection established');
        break;

      case 'channel_joined':
        console.log('Grid WebSocket: Joined channel', (data as any).channel_id);
        break;

      case 'channel_left':
        console.log('Grid WebSocket: Left channel', (data as any).channel_id);
        break;

      case 'read_receipt':
        break;

      case 'new_message':
        console.log('Grid WebSocket: new_message RAW:', JSON.stringify(data, null, 2));
        const newMsg = data as GridWsNewMessage;
        const messageWithChannel = {
          ...newMsg.message,
          channel: newMsg.message?.channel
            || (newMsg as any).channel_id
            || (newMsg as any).channel
            || (newMsg.message as any)?.channel_id,
          parent: newMsg.message?.parent
            || (newMsg.message as any)?.parent_id
            || (newMsg as any).parent_id
            || null,
        };
        console.log('Grid WebSocket: new_message resolved channel:', messageWithChannel.channel, 'parent:', messageWithChannel.parent);
        this.newMessageSubject.next(messageWithChannel);
        break;

      case 'message_edited':
        const editedMsg = data as GridWsMessageEdited;
        this.messageEditedSubject.next(editedMsg.message);
        break;

      case 'message_deleted':
        const deletedMsg = data as GridWsMessageDeleted;
        this.messageDeletedSubject.next({
          messageId: deletedMsg.message_id,
          channelId: deletedMsg.channel_id,
        });
        break;

      case 'typing_indicator':
        const typing = data as GridWsTypingIndicator;
        this.typingIndicatorSubject.next({
          user_id: typing.user_id,
          username: typing.username,
          display_name: typing.display_name,
          is_typing: typing.is_typing,
          channel_id: typing.channel_id,
        });
        break;

      case 'presence_update':
        const presence = data as GridWsPresenceUpdate;
        this.presenceUpdateSubject.next({
          userId: presence.user_id,
          isOnline: presence.is_online,
          lastSeen: presence.last_seen,
        });
        break;

      case 'unread_update':
        const unread = data as GridWsUnreadUpdate;
        this.unreadUpdateSubject.next({
          channelId: unread.channel_id,
          unreadCount: unread.unread_count,
        });
        break;

      case 'dm_notification':
        console.log('Grid WebSocket: DM notification RAW data:', JSON.stringify(data, null, 2));
        const dmNotif = data as GridWsDmNotification;
        const dmChannelId = dmNotif.channel_id
          || (dmNotif as any).channel
          || (dmNotif as any).channelId
          || dmNotif.message?.channel
          || (dmNotif.message as any)?.channel_id;
        console.log('Grid WebSocket: DM notification resolved channelId:', dmChannelId);
        this.dmNotificationSubject.next({
          channelId: dmChannelId,
          message: dmNotif.message,
          senderId: dmNotif.sender_id,
        });
        break;

      case 'channel_notification':
        console.log('Grid WebSocket: Channel notification RAW data:', JSON.stringify(data, null, 2));
        const channelNotif = data as any;
        const channelNotifId = channelNotif.channel_id
          || channelNotif.message?.channel
          || (channelNotif.message as any)?.channel_id;
        console.log('Grid WebSocket: Channel notification resolved channelId:', channelNotifId);
        this.channelNotificationSubject.next({
          channelId: channelNotifId,
          message: channelNotif.message,
          senderId: channelNotif.sender_id,
        });
        break;

      case 'mention_notification':
        console.log('Grid WebSocket: Mention notification received:', JSON.stringify(data, null, 2));
        const mentionData = data as any;
        const mentionChannelId = mentionData.channel_id
          || mentionData.message?.channel
          || (mentionData.message as any)?.channel_id;
        this.mentionNotificationSubject.next({
          channelId: mentionChannelId,
          message: mentionData.message,
          mentionerId: mentionData.mentioner_id,
        });
        break;

      case 'member_joined':
        console.log('Grid WebSocket: Member joined:', JSON.stringify(data, null, 2));
        const memberJoinedData = data as any;
        this.memberJoinedSubject.next({
          channelId: memberJoinedData.channel_id,
          member: memberJoinedData.member,
        });
        break;

      case 'member_left':
        console.log('Grid WebSocket: Member left:', JSON.stringify(data, null, 2));
        const memberLeftData = data as any;
        this.memberLeftSubject.next({
          channelId: memberLeftData.channel_id,
          userId: memberLeftData.user_id,
        });
        break;

      case 'error':
        const error = data as GridWsError;
        if (error.error) {
          console.error('Grid WebSocket error:', error.error);
          this.errorSubject.next({ error: error.error, code: error.code });
        }
        break;

      case 'pong':
        if (this.pingTimeout) {
          clearTimeout(this.pingTimeout);
          this.pingTimeout = null;
        }
        break;

      default:
        console.log('Unhandled WebSocket message type:', data.type, data);
    }
  }

  private send(data: object): boolean {
    console.log('Grid WebSocket: send() called', { type: (data as any).type, readyState: this.socket?.readyState, OPEN: WebSocket.OPEN });
    if (this.socket?.readyState === WebSocket.OPEN) {
      console.log('Grid WebSocket: Actually sending:', JSON.stringify(data));
      this.socket.send(JSON.stringify(data));
      return true;
    }
    console.warn('Cannot send message: WebSocket not connected');
    return false;
  }

  // =====================
  // Client Actions
  // =====================

  joinChannel(channelId: string): void {
    this.joinedChannels.add(channelId);
    const msg: GridWsJoinChannel = {
      type: 'join_channel',
      channel_id: channelId,
    };
    this.send(msg);
  }

  leaveChannel(channelId: string): void {
    this.joinedChannels.delete(channelId);
    const msg: GridWsLeaveChannel = {
      type: 'leave_channel',
      channel_id: channelId,
    };
    this.send(msg);
  }

  sendMessage(channelId: string, content: string, parentId?: string, tempId?: string, attachmentIds?: string[]): boolean {
    const msg: GridWsSendMessage = {
      type: 'send_message',
      channel_id: channelId,
      content,
      parent_id: parentId,
      temp_id: tempId,
      attachment_ids: attachmentIds && attachmentIds.length > 0 ? attachmentIds : undefined,
    };
    return this.send(msg);
  }

  editMessage(messageId: string, content: string): boolean {
    const msg: GridWsEditMessage = {
      type: 'edit_message',
      message_id: messageId,
      content,
    };
    return this.send(msg);
  }

  deleteMessage(messageId: string): boolean {
    const msg: GridWsDeleteMessage = {
      type: 'delete_message',
      message_id: messageId,
    };
    return this.send(msg);
  }

  startTyping(channelId: string): void {
    const msg: GridWsTypingAction = {
      type: 'typing_start',
      channel_id: channelId,
    };
    this.send(msg);
  }

  stopTyping(channelId: string): void {
    const msg: GridWsTypingAction = {
      type: 'typing_stop',
      channel_id: channelId,
    };
    this.send(msg);
  }

  markRead(channelId: string, lastReadMessageId?: string): void {
    const msg: GridWsMarkRead = {
      type: 'mark_read',
      channel_id: channelId,
      last_read_message_id: lastReadMessageId,
    };
    const sent = this.send(msg);
    if (!sent) {
      this.markReadFallbackSubject.next({ channelId, lastReadMessageId });
    }
  }

  // =====================
  // Connection Management
  // =====================

  private startPingPong(): void {
    this.stopPingPong();

    this.pingInterval = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });

        this.pingTimeout = setTimeout(() => {
          console.warn('Grid WebSocket ping timeout, reconnecting...');
          this.socket?.close(4000, 'Ping timeout');
        }, 10000);
      }
    }, 30000);
  }

  private stopPingPong(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached for Grid WebSocket');
      this.errorSubject.next({ error: 'Unable to reconnect to chat server' });
      return;
    }

    this.connectionStateSubject.next('reconnecting');
    this.reconnectAttempts++;

    const jitter = Math.random() * 1000;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1) + jitter,
      this.maxReconnectDelay
    );

    console.log(`Grid WebSocket reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  getConnectionState(): GridWsConnectionState {
    return this.connectionStateSubject.value;
  }
}
