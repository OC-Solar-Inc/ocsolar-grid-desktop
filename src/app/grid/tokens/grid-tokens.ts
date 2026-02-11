import { InjectionToken } from '@angular/core';
import { User } from '../interfaces/user';

/**
 * Configuration for Grid library — API URLs and keys
 */
export interface GridConfig {
  siteFrameApiUrl: string;
  wsUrl: string;
  giphyApiKey: string;
  /** Whether to show the Nexus/sidenav toggle button. Defaults to true. */
  showNexusToggle?: boolean;
}

/**
 * Authentication provider — consuming apps implement this to provide auth
 */
export interface GridAuthProvider {
  getIdToken(): Promise<string | null>;
  getCurrentUserDocId(): string | null;
}

/**
 * User data provider — consuming apps implement this to provide user data
 */
export interface GridUserDataProvider {
  getUsers(): Promise<User[]>;
}

export const GRID_CONFIG = new InjectionToken<GridConfig>('GRID_CONFIG');
export const GRID_AUTH_PROVIDER = new InjectionToken<GridAuthProvider>('GRID_AUTH_PROVIDER');
export const GRID_USER_DATA_PROVIDER = new InjectionToken<GridUserDataProvider>('GRID_USER_DATA_PROVIDER');
