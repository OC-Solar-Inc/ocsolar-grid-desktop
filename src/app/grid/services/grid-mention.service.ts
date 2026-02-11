import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { User } from '../interfaces/user';
import { GridChannel } from '../interfaces/grid.interface';


export interface MentionSuggestion {
  user_id: string;
  display_name: string;
  username: string;
  avatar_url?: string;
}

@Injectable()
export class GridMentionService {
  private memberCache = new Map<string, MentionSuggestion[]>();
  private suggestionsSubject = new BehaviorSubject<MentionSuggestion[]>([]);
  public suggestions$ = this.suggestionsSubject.asObservable();

  /**
   * Load channel members for autocomplete suggestions.
   * For DMs, only includes the other person in the conversation.
   * For channels, includes all non-customer members.
   */
  loadChannelMembers(channelId: string, userMap: Map<string, User>, channel?: GridChannel | null): void {
    const suggestions: MentionSuggestion[] = [];

    // Check if this is a DM
    const isDm = channel && (channel.channel_type === 'dm' || channel.channel_type === 'direct');

    if (isDm && channel?.dm_user) {
      // For DMs, only show the other person
      const dmUser = channel.dm_user;
      suggestions.push({
        user_id: dmUser.user_id,
        display_name: dmUser.display_name || 'Unknown User',
        username: dmUser.username || dmUser.user_id,
        avatar_url: dmUser.avatar_url,
      });
    } else {
      // For channels, show all non-customer members
      userMap.forEach((user, userId) => {
        // Skip customers - only include internal users
        const roles = user.sRoles || (user.sRole ? [user.sRole] : []);
        if (roles.includes('Customer')) {
          return;
        }

        suggestions.push({
          user_id: userId,
          display_name: user.sFullName || `${user.sFirstName} ${user.sLastName}`.trim() || 'Unknown User',
          username: user.sEmail || userId,
          avatar_url: user.profileImage || undefined,
        });
      });

      // Sort by display name
      suggestions.sort((a, b) => a.display_name.localeCompare(b.display_name));
    }

    this.memberCache.set(channelId, suggestions);
  }

  /**
   * Search for users matching a query in the current channel.
   */
  search(query: string, channelId: string): MentionSuggestion[] {
    const members = this.memberCache.get(channelId) || [];

    if (!query) {
      // Return all members when no query (no limit)
      return members;
    }

    const lowerQuery = query.toLowerCase();

    const filtered = members.filter((member) =>
      member.display_name.toLowerCase().includes(lowerQuery) ||
      member.username.toLowerCase().includes(lowerQuery)
    );

    // Return all matching members (no limit)
    return filtered;
  }

  /**
   * Update suggestions based on query.
   */
  updateSuggestions(query: string, channelId: string): void {
    const suggestions = this.search(query, channelId);
    this.suggestionsSubject.next(suggestions);
  }

  /**
   * Clear suggestions (when closing dropdown).
   */
  clearSuggestions(): void {
    this.suggestionsSubject.next([]);
  }

  /**
   * Insert a mention into message content at the specified position.
   * Uses display name format for user-friendly viewing: @[DisplayName]
   *
   * @param content Current message content
   * @param cursorPos Current cursor position
   * @param startIndex Index where the @ symbol starts
   * @param user User to mention
   * @returns Object with new content, new cursor position, and mention mapping
   */
  insertMention(
    content: string,
    cursorPos: number,
    startIndex: number,
    user: MentionSuggestion
  ): { content: string; cursorPos: number; mentionMapping: { displayName: string; userId: string } } {
    // Build the mention text: @[DisplayName] for user-friendly display
    const mentionText = `@[${user.display_name}]`;

    // Replace from startIndex to cursorPos with the mention
    const before = content.substring(0, startIndex);
    const after = content.substring(cursorPos);

    const newContent = before + mentionText + ' ' + after;
    const newCursorPos = startIndex + mentionText.length + 1; // +1 for the space

    return {
      content: newContent,
      cursorPos: newCursorPos,
      mentionMapping: { displayName: user.display_name, userId: user.user_id }
    };
  }

  /**
   * Convert display-format mentions to backend format.
   * Converts @[DisplayName] to <@userId> using the provided mapping.
   */
  convertMentionsForSend(content: string, mentionMap: Map<string, string>): string {
    // Pattern matches @[DisplayName]
    const displayPattern = /@\[([^\]]+)\]/g;

    return content.replace(displayPattern, (match, displayName) => {
      const userId = mentionMap.get(displayName);
      if (userId) {
        return `<@${userId}>`;
      }
      // If no mapping found, keep original (shouldn't happen)
      return match;
    });
  }

  /**
   * Extract current mentions from display-format content.
   * Returns array of display names found in @[DisplayName] format.
   */
  extractDisplayMentions(content: string): string[] {
    const displayPattern = /@\[([^\]]+)\]/g;
    const mentions: string[] = [];
    let match;

    while ((match = displayPattern.exec(content)) !== null) {
      if (!mentions.includes(match[1])) {
        mentions.push(match[1]);
      }
    }

    return mentions;
  }

  /**
   * Extract the mention query from content at cursor position.
   * Returns null if not in a mention context.
   *
   * @param content Message content
   * @param cursorPos Current cursor position
   * @returns Object with startIndex and query, or null
   */
  extractMentionQuery(
    content: string,
    cursorPos: number
  ): { startIndex: number; query: string } | null {
    // Look backwards from cursor to find @
    const beforeCursor = content.substring(0, cursorPos);

    // Find the last @ that could be starting a mention
    const lastAtIndex = beforeCursor.lastIndexOf('@');

    if (lastAtIndex === -1) {
      return null;
    }

    // Check if @ is at start or preceded by whitespace (not part of email)
    const charBeforeAt = lastAtIndex > 0 ? beforeCursor[lastAtIndex - 1] : ' ';
    if (!/\s/.test(charBeforeAt) && lastAtIndex !== 0) {
      return null;
    }

    // Get the text between @ and cursor
    const query = beforeCursor.substring(lastAtIndex + 1);

    // If there's a space in the query, we're no longer in mention mode
    if (query.includes(' ')) {
      return null;
    }

    return {
      startIndex: lastAtIndex,
      query,
    };
  }

  /**
   * Format a mention for display in message preview.
   * Replaces <@userId> with @displayName.
   */
  formatMentionsForDisplay(content: string, userMap: Map<string, User>): string {
    const mentionPattern = /<@([A-Za-z0-9_-]+)>/g;

    return content.replace(mentionPattern, (match, userId) => {
      const user = userMap.get(userId);
      if (user) {
        const displayName = user.sFullName || `${user.sFirstName} ${user.sLastName}`.trim() || 'Unknown';
        return `@${displayName}`;
      }
      return match;
    });
  }
}
