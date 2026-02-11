import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GridComponent } from '../../grid/components/grid/grid.component';

@Component({
  selector: 'app-grid-shell',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule, GridComponent],
  template: `
    <div class="grid-shell">
      <lib-grid></lib-grid>
      <div class="profile-btn-container">
        <button mat-icon-button [matMenuTriggerFor]="userMenu" class="profile-btn" matTooltip="Account" matTooltipPosition="right">
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
  `,
  styles: [`
    .grid-shell {
      position: relative;
      height: 100vh;
      overflow: hidden;
    }

    .profile-btn-container {
      position: absolute;
      bottom: 8px;
      left: 8px;
      z-index: 100;
    }

    .profile-btn {
      color: rgba(255, 255, 255, 0.7);
      width: 36px;
      height: 36px;
      line-height: 36px;
      transition: color 0.15s;

      &:hover {
        color: rgba(255, 255, 255, 1);
      }

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
      }
    }
  `],
})
export class GridShellComponent {
  constructor(
    private afAuth: AngularFireAuth,
    private router: Router
  ) {}

  async logout(): Promise<void> {
    localStorage.removeItem('userDocId');
    await this.afAuth.signOut();
    this.router.navigate(['/login']);
  }
}
