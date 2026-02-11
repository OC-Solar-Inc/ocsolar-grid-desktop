import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type GridTheme = 'theGrid' | 'ocSolar2' | 'solar' | 'solarPanel' | 'noir' | 'midnight' | 'totallyOriginal' | 'tesla' | 'aidansTheme' | 'lucasTheme';

export interface ThemeConfig {
  name: GridTheme;
  label: string;
  colors: {
    primary: string;
    secondary: string;
  };
}

export const GRID_THEMES: Record<GridTheme, ThemeConfig> = {
  theGrid: { name: 'theGrid', label: 'The Grid (OC Solar 1)', colors: { primary: '#0A2240', secondary: '#C10230' } },
  ocSolar2: { name: 'ocSolar2', label: 'OC Solar 2', colors: { primary: '#00698f', secondary: '#FFB71B' } },
  solar: { name: 'solar', label: 'California Sun', colors: { primary: '#E65100', secondary: '#FFF8E1' } },
  solarPanel: { name: 'solarPanel', label: 'Solar Energy', colors: { primary: '#0D47A1', secondary: '#4CAF50' } },
  noir: { name: 'noir', label: 'Noir', colors: { primary: '#0a0a0a', secondary: '#fafafa' } },
  midnight: { name: 'midnight', label: 'Midnight', colors: { primary: '#121212', secondary: '#2d2d2d' } },
  totallyOriginal: { name: 'totallyOriginal', label: 'Definitely Not Slack\u2122', colors: { primary: '#4A154B', secondary: '#ffffff' } },
  tesla: { name: 'tesla', label: 'Tesla', colors: { primary: '#171a20', secondary: '#E82127' } },
  aidansTheme: { name: 'aidansTheme', label: "Aidan's Theme", colors: { primary: '#15202b', secondary: '#00897b' } },
  lucasTheme: { name: 'lucasTheme', label: "Lucas' Theme", colors: { primary: '#1E1E1E', secondary: '#FC6A5D' } },
};

const STORAGE_KEY = 'gridTheme';

@Injectable()
export class GridThemeService {
  private themeSubject = new BehaviorSubject<GridTheme>('theGrid');
  public theme$: Observable<GridTheme> = this.themeSubject.asObservable();

  constructor() {
    this.loadThemeFromStorage();
  }

  private loadThemeFromStorage(): void {
    const savedTheme = localStorage.getItem(STORAGE_KEY) as GridTheme | null;
    if (savedTheme && savedTheme in GRID_THEMES) {
      this.themeSubject.next(savedTheme);
    }
  }

  public getTheme(): GridTheme { return this.themeSubject.value; }

  public setTheme(theme: GridTheme): void {
    this.themeSubject.next(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }

  public getThemeConfig(theme?: GridTheme): ThemeConfig {
    return GRID_THEMES[theme || this.themeSubject.value];
  }

  public getAllThemes(): ThemeConfig[] {
    return Object.values(GRID_THEMES);
  }
}
