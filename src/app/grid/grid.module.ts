import { NgModule, ModuleWithProviders } from '@angular/core';
import { HttpClientModule } from '@angular/common/http';
import { GRID_CONFIG, GRID_AUTH_PROVIDER, GRID_USER_DATA_PROVIDER, GridConfig, GridAuthProvider, GridUserDataProvider } from './tokens/grid-tokens';
import { GridApiService } from './services/grid-api.service';
import { GridWebsocketService } from './services/grid-websocket.service';
import { GridThemeService } from './services/grid-theme.service';
import { GridNotificationService } from './services/grid-notification.service';
import { IdleConnectionService } from './services/idle-connection.service';
import { UserPresenceService } from './services/user-presence.service';
import { GridFileUploadService } from './services/grid-file-upload.service';
import { GridDraftService } from './services/grid-draft.service';
import { GridMentionService } from './services/grid-mention.service';
import { GridGifService } from './services/grid-gif.service';

@NgModule({
  imports: [HttpClientModule],
})
export class GridModule {
  /**
   * Use forRoot() in your app module to provide all Grid services and configuration.
   *
   * @param config Grid configuration (API URLs, keys)
   * @param authProvider Class that implements GridAuthProvider
   * @param userDataProvider Class that implements GridUserDataProvider
   */
  static forRoot(options: {
    config: GridConfig;
    authProvider: new (...args: any[]) => GridAuthProvider;
    userDataProvider: new (...args: any[]) => GridUserDataProvider;
  }): ModuleWithProviders<GridModule> {
    return {
      ngModule: GridModule,
      providers: [
        { provide: GRID_CONFIG, useValue: options.config },
        { provide: GRID_AUTH_PROVIDER, useClass: options.authProvider },
        { provide: GRID_USER_DATA_PROVIDER, useClass: options.userDataProvider },
        GridApiService,
        GridWebsocketService,
        GridThemeService,
        GridNotificationService,
        IdleConnectionService,
        UserPresenceService,
        GridFileUploadService,
        GridDraftService,
        GridMentionService,
        GridGifService,
      ],
    };
  }
}
