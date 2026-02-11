/**
 * Grid - Internal Chat System Interfaces
 * Slack-like messaging for OCSolar
 * Updated to align with Site Frame API specification
 */

// Channel types - 'dm' is the API type, 'direct' kept for backward compatibility
export type GridChannelType = 'public' | 'private' | 'group' | 'direct' | 'dm';

// User status
export type GridUserStatus = 'online' | 'away' | 'dnd' | 'offline';

// Channel member roles
export type GridMemberRole = 'owner' | 'admin' | 'member';

/**
 * Represents a chat channel (public, private, or DM)
 */
export interface GridChannel {
  id: string;
  name: string;
  channel_type: GridChannelType;
  description?: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  is_archived: boolean;
  unread_count?: number;
  has_mention?: boolean; // True if user was @mentioned in unread messages
  last_message_at?: string;
  last_message_preview?: string;
  member_count?: number;
  // For DMs, the other user's info
  dm_user?: GridProfile;
  // For Groups, member user IDs
  member_ids?: string[];
}

/**
 * Represents a file attachment on a message
 */
export interface GridMessageAttachment {
  id: string;
  filename: string;
  original_filename: string;
  file_type: string;
  file_size: number;
  url: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
}

/**
 * Represents a message in a channel
 */
export interface GridMessage {
  id: string;
  channel: string;
  user_id: string | null;
  username?: string;  // Optional - may not be returned by API
  display_name?: string;
  avatar_url?: string;
  content: string;
  parent?: string | null;
  reply_count: number;
  created_at: string;
  updated_at?: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  is_edited: boolean;
  is_deleted: boolean;
  // Slack user info for unmapped users
  slack_user_name?: string;
  slack_user_id?: string;
  // Optimistic UI flag
  pending?: boolean;
  // Error flag for failed sends
  error?: boolean;
  // Temp ID for matching optimistic messages with server responses
  temp_id?: string;
  // File attachments
  attachments?: GridMessageAttachment[];
}

/**
 * Channel membership information
 */
export interface GridChannelMember {
  channel: string;
  user_id: string;
  role: GridMemberRole;
  joined_at: string;
  last_read_at: string;
  last_read_message_id: string | null;
  notifications_enabled: boolean;
  unread_count: number;
  is_muted: boolean;
  username?: string;
  display_name?: string;
  avatar_url?: string;
}

/**
 * User profile for chat
 */
export interface GridProfile {
  id?: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  status_text?: string;
  is_online: boolean;
  last_seen?: string;
}

/**
 * Typing indicator user
 */
export interface GridTypingUser {
  user_id: string;
  username: string;
  display_name?: string;
  is_typing: boolean;
  channel_id: string;
}

/**
 * Paginated response wrapper (page-based)
 */
export interface GridPaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * Cursor-based paginated response for channels
 * Used by public channels and search endpoints
 */
export interface GridCursorPaginatedResponse<T> {
  results: T[];
  next_cursor: string | null;
  count: number;
}

/**
 * Create channel request
 */
export interface GridCreateChannelRequest {
  name: string;
  channel_type: GridChannelType;
  description?: string;
  member_ids?: string[];
}

/**
 * Create group chat request
 */
export interface GridCreateGroupRequest {
  user_id: string;      // Creator's user ID
  user_ids: string[];   // All member user IDs (including creator)
  name?: string;        // Optional group name
}

/**
 * Create message request
 */
export interface GridCreateMessageRequest {
  channel: string;
  content: string;
  parent?: string;
  user_id?: string;
  attachment_ids?: string[];
}

/**
 * Update profile request
 */
export interface GridUpdateProfileRequest {
  display_name?: string;
  avatar_url?: string;
  status_text?: string;
}

// =====================
// WebSocket Message Types
// =====================

/**
 * Base WebSocket message structure
 */
export interface GridWsMessage {
  type: GridWsMessageType;
  [key: string]: any;
}

/**
 * All possible WebSocket message types
 */
export type GridWsMessageType =
  // Server → Client
  | 'connection_established'
  | 'channel_joined'
  | 'channel_left'
  | 'new_message'
  | 'message_edited'
  | 'message_deleted'
  | 'typing_indicator'
  | 'presence_update'
  | 'channel_created'
  | 'channel_updated'
  | 'member_joined'
  | 'member_left'
  | 'unread_update'
  | 'read_receipt'
  | 'dm_notification'
  | 'channel_notification'
  | 'mention_notification'
  | 'error'
  | 'pong'
  // Client → Server
  | 'join_channel'
  | 'leave_channel'
  | 'send_message'
  | 'edit_message'
  | 'delete_message'
  | 'typing_start'
  | 'typing_stop'
  | 'mark_read'
  | 'ping';

/**
 * New message event from server
 */
export interface GridWsNewMessage extends GridWsMessage {
  type: 'new_message';
  message: GridMessage;
  channel_id: string;
}

/**
 * Message edited event from server
 */
export interface GridWsMessageEdited extends GridWsMessage {
  type: 'message_edited';
  message: GridMessage;
  channel_id: string;
}

/**
 * Message deleted event from server
 */
export interface GridWsMessageDeleted extends GridWsMessage {
  type: 'message_deleted';
  message_id: string;
  channel_id: string;
}

/**
 * Typing indicator event
 */
export interface GridWsTypingIndicator extends GridWsMessage {
  type: 'typing_indicator';
  user_id: string;
  username: string;
  display_name?: string;
  channel_id: string;
  is_typing: boolean;
}

/**
 * Presence update event
 */
export interface GridWsPresenceUpdate extends GridWsMessage {
  type: 'presence_update';
  user_id: string;
  is_online: boolean;
  last_seen?: string;
}

/**
 * Unread count update event
 */
export interface GridWsUnreadUpdate extends GridWsMessage {
  type: 'unread_update';
  channel_id: string;
  unread_count: number;
}

/**
 * Error event from server
 */
export interface GridWsError extends GridWsMessage {
  type: 'error';
  error: string;
  code?: string;
}

/**
 * DM notification event - sent to DM recipient when they receive a new message
 */
export interface GridWsDmNotification extends GridWsMessage {
  type: 'dm_notification';
  channel_id: string;
  message: GridMessage;
  sender_id: string;
}

/**
 * Channel notification event - sent to channel members when a new message is posted
 */
export interface GridWsChannelNotification extends GridWsMessage {
  type: 'channel_notification';
  channel_id: string;
  message: GridMessage;
  sender_id: string;
}

/**
 * Join channel action (Client → Server)
 */
export interface GridWsJoinChannel {
  type: 'join_channel';
  channel_id: string;
}

/**
 * Leave channel action (Client → Server)
 */
export interface GridWsLeaveChannel {
  type: 'leave_channel';
  channel_id: string;
}

/**
 * Send message action (Client → Server)
 */
export interface GridWsSendMessage {
  type: 'send_message';
  channel_id: string;
  content: string;
  parent_id?: string;
  temp_id?: string; // For optimistic UI matching
  attachment_ids?: string[]; // IDs of uploaded attachments to include
}

/**
 * Edit message action (Client → Server)
 */
export interface GridWsEditMessage {
  type: 'edit_message';
  message_id: string;
  content: string;
}

/**
 * Delete message action (Client → Server)
 */
export interface GridWsDeleteMessage {
  type: 'delete_message';
  message_id: string;
}

/**
 * Typing start/stop action (Client → Server)
 */
export interface GridWsTypingAction {
  type: 'typing_start' | 'typing_stop';
  channel_id: string;
}

/**
 * Mark messages as read action (Client → Server)
 */
export interface GridWsMarkRead {
  type: 'mark_read';
  channel_id: string;
  last_read_message_id?: string;
}

/**
 * Ping/Pong for connection health
 */
export interface GridWsPing {
  type: 'ping';
}

export interface GridWsPong extends GridWsMessage {
  type: 'pong';
}

/**
 * WebSocket connection state
 */
export type GridWsConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * Chat state for UI
 */
export interface GridChatState {
  channels: GridChannel[];
  currentChannel: GridChannel | null;
  messages: GridMessage[];
  typingUsers: GridTypingUser[];
  connectionState: GridWsConnectionState;
  isLoadingChannels: boolean;
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  error: string | null;
}

/**
 * File upload progress tracking
 */
export type GridFileUploadStatus = 'pending' | 'uploading' | 'complete' | 'error';

export interface GridFileUploadProgress {
  file: File;
  progress: number;
  status: GridFileUploadStatus;
  attachment?: GridMessageAttachment;
  error?: string;
}

/**
 * Mention suggestion for autocomplete
 */
export interface GridMentionSuggestion {
  user_id: string;
  display_name: string;
  username: string;
  avatar_url?: string;
}

/**
 * Mention notification from WebSocket
 */
export interface GridWsMentionNotification extends GridWsMessage {
  type: 'mention_notification';
  channel_id: string;
  message: GridMessage;
  mentioner_id: string;
}

/**
 * Activity item from the activity feed API
 */
export interface GridActivityItem {
  id: string;
  mentioner_user_id: string;
  message_content: string;
  created_at: string;
  is_read: boolean;
  channel_id: string;
  channel_type: string;
  channel_name: string;
  message_id: string;
}

/**
 * Channel file from S3 listing
 */
export interface GridChannelFile {
  s3_key: string;
  filename: string;
  file_size: number;
  last_modified: string;
  content_type: string;
  url: string;
}

/**
 * Paginated response for channel files
 */
export interface GridChannelFilesResponse {
  files: GridChannelFile[];
  next_token: string | null;
  has_more: boolean;
}
