import { fakeAsync, tick, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject } from 'rxjs';
import { MessageSearchComponent } from './message-search.component';
import { GridApiService } from '../../services/grid-api.service';
import { GridChannel, GridMessage, GridMessageSearchResponse } from '../../interfaces/grid.interface';
import { User } from '../../interfaces/user';

const channel = (id: string, name: string) => ({ id, name, channel_type: 'public', is_archived: false } as GridChannel);
const person = (id: string, name: string) => ({ id, sFullName: name, sEmail: `${id}@example.com`, sRole: 'Employee' } as User);
const message = { id: 'message', channel: 'project', parent: 'parent', content: 'Solar install confirmed', user_id: 'alex', created_at: '2026-09-08T12:00:00Z' } as GridMessage;
const page = { results: [message], count: 1, offset: 0, has_more: true } as GridMessageSearchResponse;

describe('Unified Grid search', () => {
  let component: MessageSearchComponent;
  let api: jasmine.SpyObj<GridApiService>;
  beforeEach(() => {
    api = jasmine.createSpyObj('GridApiService', ['searchChannels', 'searchMessages']);
    api.searchChannels.and.returnValue(of([channel('project', 'Solar project')]));
    api.searchMessages.and.returnValue(of(page));
    component = new MessageSearchComponent(api);
    component.channels = [channel('project', 'Solar project')];
    component.userMap = new Map([['alex', person('alex', 'Solar Alex')]]);
    component.ngOnInit();
  });
  afterEach(() => component.ngOnDestroy());

  it('combines and deduplicates conversations, people and message results', fakeAsync(() => {
    component.onQueryChange('solar'); tick(151);
    expect(component.entries.map(e => e.kind)).toEqual(['channel', 'person', 'message']);
    expect(component.matchingChannels.length).toBe(1);
  }));
  it('matches email and excludes self and customers from DM targets', fakeAsync(() => {
    component.currentUserId = 'self';
    component.userMap.set('self', person('self', 'Solar self'));
    component.userMap.set('customer', { ...person('customer', 'Solar customer'), sRole: 'Customer' });
    component.onQueryChange('solar'); tick(151);
    expect(component.matchingPeople.map(p => p.id)).toEqual(['alex']);
    component.onQueryChange('alex@example'); tick(151);
    expect(component.matchingPeople.length).toBe(1);
  }));
  it('cancels old requests immediately and allows the same query after clear', fakeAsync(() => {
    const pending = new Subject<GridMessageSearchResponse>();
    api.searchMessages.and.returnValue(pending);
    component.onQueryChange('solar'); tick(151);
    component.clear();
    pending.next(page); pending.complete(); tick(151);
    expect(component.entries.length).toBe(0);
    expect(component.isSearching).toBeFalse();
    api.searchMessages.and.returnValue(of(page));
    component.onQueryChange('solar'); tick(151);
    expect(component.rows.length).toBe(1);
  }));
  it('routes conversation, person and reply selections to their own actions', fakeAsync(() => {
    spyOn(component.resultSelected, 'emit'); spyOn(component.userSelected, 'emit');
    component.onQueryChange('solar'); tick(151);
    component.entries.forEach(e => component.selectEntry(e));
    expect(component.resultSelected.emit).toHaveBeenCalledWith({ channelId: 'project', messageId: '' });
    expect(component.userSelected.emit).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'alex' }));
    expect(component.resultSelected.emit).toHaveBeenCalledWith({ channelId: 'project', messageId: 'message', parentId: 'parent' });
  }));
  it('keeps channel scope for message pages and resets it for Everything', fakeAsync(() => {
    component.currentChannel = channel('project', 'Solar project');
    component.onQueryChange('solar'); tick(151);
    component.setScope('channel'); tick(151);
    expect(component.entries.every(e => e.kind === 'message')).toBeTrue();
    component.nextPage();
    expect(api.searchMessages).toHaveBeenCalledWith('solar', { limit: 15, offset: 15, channelId: 'project' });
    component.setKind('all'); tick(151);
    expect(component.scope).toBe('all');
    expect(component.entries.some(e => e.kind === 'person')).toBeTrue();
  }));
  it('moves across result types with arrows and Enter', fakeAsync(() => {
    spyOn(component.userSelected, 'emit');
    component.onQueryChange('solar'); tick(151);
    component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' })); tick();
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(component.userSelected.emit).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'alex' }));
  }));
  it('renders a single combobox with all result categories and traps focus', fakeAsync(() => {
    TestBed.configureTestingModule({ imports: [MessageSearchComponent, NoopAnimationsModule], providers: [{ provide: GridApiService, useValue: api }] });
    const fixture = TestBed.createComponent(MessageSearchComponent);
    fixture.componentInstance.channels = component.channels;
    fixture.componentInstance.userMap = component.userMap;
    fixture.detectChanges();
    fixture.componentInstance.onQueryChange('solar'); tick(151); fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('input[role="combobox"]').length).toBe(1);
    expect(element.querySelectorAll('[role="option"]').length).toBe(3);
    expect(element.querySelector('[aria-modal="true"]')).not.toBeNull();
    fixture.destroy();
  }));
});
