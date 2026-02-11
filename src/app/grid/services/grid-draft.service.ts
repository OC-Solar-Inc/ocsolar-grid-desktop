import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { GridMessageAttachment } from '../interfaces/grid.interface';


/**
 * Interface for a channel draft stored in localStorage
 */
export interface ChannelDraft {
  channelId: string;
  messageContent: string;
  attachments: GridMessageAttachment[];
  updatedAt: number; // timestamp for expiration
}

/**
 * Storage wrapper for all drafts
 */
interface DraftStorage {
  drafts: { [channelId: string]: ChannelDraft };
  version: number;
}

// Storage key for localStorage
const STORAGE_KEY = 'grid_channel_drafts';

// Draft expiration time: 7 days in milliseconds
const DRAFT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

// Current storage version (for future migrations)
const STORAGE_VERSION = 1;

@Injectable()
export class GridDraftService {
  constructor() {
    // Clean up old drafts on service initialization
    this.cleanupOldDrafts();
  }

  /**
   * Get all drafts from localStorage
   */
  private getStorage(): DraftStorage {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { drafts: {}, version: STORAGE_VERSION };
      }
      const storage = JSON.parse(raw) as DraftStorage;
      // Handle version migrations here if needed in the future
      return storage;
    } catch {
      return { drafts: {}, version: STORAGE_VERSION };
    }
  }

  /**
   * Save drafts to localStorage
   */
  private setStorage(storage: DraftStorage): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
    } catch (e) {
      console.error('Failed to save drafts to localStorage:', e);
    }
  }

  /**
   * Save a draft for a channel
   */
  saveDraft(
    channelId: string,
    messageContent: string,
    attachments: GridMessageAttachment[]
  ): void {
    if (!channelId) return;

    const storage = this.getStorage();

    // Only save if there's content or attachments
    if (!messageContent.trim() && attachments.length === 0) {
      // Clear the draft if empty
      delete storage.drafts[channelId];
    } else {
      storage.drafts[channelId] = {
        channelId,
        messageContent,
        attachments,
        updatedAt: Date.now(),
      };
    }

    this.setStorage(storage);
  }

  /**
   * Get a draft for a channel (without validation)
   */
  getDraft(channelId: string): ChannelDraft | null {
    if (!channelId) return null;

    const storage = this.getStorage();
    const draft = storage.drafts[channelId];

    if (!draft) return null;

    // Check if draft has expired
    if (Date.now() - draft.updatedAt > DRAFT_EXPIRATION_MS) {
      this.clearDraft(channelId);
      return null;
    }

    return draft;
  }

  /**
   * Get a draft and return it as an Observable
   * Attachments are trusted without server validation - if invalid, UI handles gracefully
   */
  getDraftWithValidation(
    channelId: string
  ): Observable<ChannelDraft | null> {
    // Simply return the draft without server validation
    // This avoids HEAD request issues and is faster
    // If attachments are expired/deleted, the UI will handle it gracefully
    return of(this.getDraft(channelId));
  }

  /**
   * Clear a draft for a channel
   */
  clearDraft(channelId: string): void {
    if (!channelId) return;

    const storage = this.getStorage();
    delete storage.drafts[channelId];
    this.setStorage(storage);
  }

  /**
   * Check if a channel has a draft
   */
  hasDraft(channelId: string): boolean {
    const draft = this.getDraft(channelId);
    return draft !== null;
  }

  /**
   * Clean up drafts older than the expiration time
   */
  cleanupOldDrafts(): void {
    const storage = this.getStorage();
    const now = Date.now();
    let changed = false;

    for (const channelId of Object.keys(storage.drafts)) {
      const draft = storage.drafts[channelId];
      if (now - draft.updatedAt > DRAFT_EXPIRATION_MS) {
        delete storage.drafts[channelId];
        changed = true;
      }
    }

    if (changed) {
      this.setStorage(storage);
    }
  }

  /**
   * Get all channel IDs that have drafts
   */
  getChannelsWithDrafts(): string[] {
    const storage = this.getStorage();
    return Object.keys(storage.drafts);
  }
}
