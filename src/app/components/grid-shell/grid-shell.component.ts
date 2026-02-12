import { Component, ViewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, takeUntil } from 'rxjs';
import { GridComponent } from '../../grid/components/grid/grid.component';
import { GridThemeService, GridTheme } from '../../grid/services/grid-theme.service';

const SIDEBAR_BG: Record<GridTheme, string> = {
  theGrid: '#0A2240',
  ocSolar2: '#00698f',
  solar: '#E65100',
  solarPanel: '#0D47A1',
  totallyOriginal: '#4A154B',
  noir: '#0a0a0a',
  midnight: '#121212',
  tesla: '#171a20',
  aidansTheme: '#10171e',
  lucasTheme: '#1E1E1E',
};

function darken(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

@Component({
  selector: 'app-grid-shell',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule, GridComponent],
  template: `
    <div class="grid-shell">
      <div class="title-bar" [style.background]="titleBarBg">
        <div class="title-bar-spacer"></div>
        <div class="title-bar-search" (click)="focusSearch()">
          <mat-icon>search</mat-icon>
          <input
            #searchInput
            type="text"
            placeholder="Search channels"
            [ngModel]="searchQuery"
            (ngModelChange)="onSearchChange($event)"
          />
        </div>
        <div class="title-bar-actions">
          <button mat-icon-button [matMenuTriggerFor]="userMenu" class="profile-btn" matTooltip="Account">
            <mat-icon>account_circle</mat-icon>
          </button>
          <mat-menu #userMenu="matMenu">
            <button mat-menu-item (click)="logout()">
              <mat-icon>logout</mat-icon>
              <span>Sign Out</span>
            </button>
          </mat-menu>
        </div>
      </div>
      <lib-grid #grid></lib-grid>
    </div>
  `,
  styles: [`
    .grid-shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    .title-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 38px;
      min-height: 38px;
      -webkit-app-region: drag;
      padding: 0 8px;
      transition: background 0.2s ease;
    }

    .title-bar-spacer {
      width: 70px;
    }

    .title-bar-search {
      display: flex;
      align-items: center;
      flex: 1;
      max-width: 400px;
      height: 26px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      padding: 0 8px;
      gap: 6px;
      -webkit-app-region: no-drag;
      cursor: text;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: rgba(255, 255, 255, 0.4);
      }

      input {
        flex: 1;
        background: none;
        border: none;
        outline: none;
        color: rgba(255, 255, 255, 0.9);
        font-size: 13px;
        font-family: inherit;

        &::placeholder {
          color: rgba(255, 255, 255, 0.4);
        }
      }
    }

    .title-bar-actions {
      display: flex;
      align-items: center;
      height: 100%;
      -webkit-app-region: no-drag;
    }

    .profile-btn.mat-mdc-icon-button {
      color: rgba(255, 255, 255, 0.6);
      width: 32px;
      height: 32px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s;

      &:hover {
        color: rgba(255, 255, 255, 1);
      }

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    lib-grid {
      flex: 1;
      min-height: 0;
    }
  `],
})
export class GridShellComponent implements OnInit, OnDestroy {
  @ViewChild('grid') gridRef!: GridComponent;
  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  searchQuery = '';
  titleBarBg = SIDEBAR_BG['theGrid'];

  private destroy$ = new Subject<void>();

  constructor(
    private afAuth: AngularFireAuth,
    private router: Router,
    private gridThemeService: GridThemeService
  ) {
    this.titleBarBg = darken(SIDEBAR_BG[this.gridThemeService.getTheme()], 25);
  }

  ngOnInit(): void {
    this.gridThemeService.theme$
      .pipe(takeUntil(this.destroy$))
      .subscribe(theme => {
        this.titleBarBg = darken(SIDEBAR_BG[theme], 25);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange(query: string): void {
    this.searchQuery = query;
    this.gridRef?.channelListRef?.onSearchChange(query);
  }

  focusSearch(): void {
    this.searchInput?.nativeElement?.focus();
  }

  async logout(): Promise<void> {
    localStorage.removeItem('userDocId');
    await this.afAuth.signOut();
    this.router.navigate(['/login']);
  }
}
