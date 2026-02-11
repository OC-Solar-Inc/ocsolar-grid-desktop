import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  template: '<router-outlet></router-outlet>',
  styles: [`:host { display: block; height: 100vh; overflow: hidden; }`],
})
export class AppComponent {}
