import { SimpleChange } from '@angular/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { GridComponent } from './grid.component';
import { MessageListComponent } from '../message-list/message-list.component';

// Exercise the actual subscriptions and component state without Firebase or a
// live server. Each delivery stream may independently duplicate the same event.
describe('Grid conversation delivery recovery', () => {
  let component: GridComponent;
  let state: any;
  let ws: any;
  let api: any;
  let idle: any;
  const channel = { id: 'dm', channel_type: 'dm', unread_count: 0 };
  const message = (id: string, second = 0, parent: string | null = null): any => ({
    id, channel: 'dm', user_id: 'sara', content: 'A link', parent,
    created_at: new Date(Date.UTC(2026, 9, 15, 17, 0, second)).toISOString(), reply_count: 0,
  });
  const page = (messages: any[], more = false): any => ({
    results: [...messages].reverse(), has_newer: more,
    prev_cursor: messages[messages.length - 1]?.id || null, next_cursor: null,
  });

  beforeEach(() => {
    ws = {};
    ['channelDeleted$', 'channelJoined$', 'channelNotification$', 'channelUpdated$', 'connectionState$', 'dmNotification$', 'error$', 'markReadFallback$', 'mentionNotification$', 'messageDeleted$', 'messageEdited$', 'messageNeedsResponseUpdated$', 'messageResolved$', 'needsResponseNotification$', 'newMessage$', 'presenceUpdate$', 'reactionUpdated$', 'typingIndicator$', 'unreadUpdate$'].forEach(name => ws[name] = new Subject());
    ws.connectionState$ = new BehaviorSubject('disconnected');
    ['joinChannel', 'leaveChannel', 'forceReconnect', 'markRead'].forEach(name => ws[name] = jasmine.createSpy(name));
    ws.isConnected = () => true;
    ws.getConnectionState = () => 'connected';
    idle = { idleState$: new BehaviorSubject('active'), destroy: () => {} };
    api = {
      getMessagesAfter: jasmine.createSpy().and.returnValue(of(page([]))),
      getMessages: jasmine.createSpy().and.returnValue(of(page([]))),
      getThreadReplies: jasmine.createSpy().and.returnValue(of([])),
    };
    const theme = { getTheme: () => 'theGrid' };
    const notifications = { showNotification: jasmine.createSpy(), setCurrentChannel: () => {} };
    const presence = { destroy: () => {} };
    const cdr = { markForCheck: () => {} };
    component = new GridComponent(api, ws, idle, {} as any, {} as any, theme as any, notifications as any, presence as any, cdr as any, { run: (fn: () => void) => fn() } as any);
    state = component as any;
    spyOn(state, 'getCurrentUserDocId').and.returnValue('brent');
    component.currentUserId = 'brent';
    component.currentChannel = { ...channel } as any;
    component.channels = [{ ...channel }] as any;
    component.messages = [message('old')];
    state.recoveryCursor = 'old';
    component.messageListRef = { isMessageVisible: () => true } as any;
    spyOn(document, 'hasFocus').and.returnValue(true);
    spyOnProperty(document, 'hidden', 'get').and.returnValue(false);
    spyOn(state, 'refreshChannelData');
    state.setupWebSocketSubscriptions();
  });

  afterEach(() => component.ngOnDestroy());
  const dm = (ws: any, item: any) => ws.dmNotification$.next({ channelId: 'dm', message: item, senderId: 'sara' });

  it('renders a personal DM without its channel broadcast, once across both streams', fakeAsync(() => {
    const item = message('new', 1);
    dm(ws, item); ws.newMessage$.next(item); dm(ws, item);
    expect(component.messages.map(m => m.id)).toEqual(['old', 'new']);
    tick();
    expect(ws.markRead).toHaveBeenCalledTimes(1);
  }));

  it('routes a DM reply to the matching thread and counts duplicate events once', fakeAsync(() => {
    component.threadParentMessage = component.messages[0];
    component.isThreadPanelOpen = true;
    const reply = message('reply', 1, 'old');
    dm(ws, reply); ws.newMessage$.next(reply); ws.channelNotification$.next({ channelId: 'dm', message: reply, senderId: 'sara' });
    expect(component.messages.map(m => m.id)).toEqual(['old']);
    expect(component.messages[0].reply_count).toBe(1);
    expect(component.threadReplies.map(m => m.id)).toEqual(['reply']);
    tick();
    expect(ws.markRead).not.toHaveBeenCalled();
  }));

  it('keeps replies for unopened threads out of the root feed', () => {
    dm(ws, message('reply', 1, 'old'));
    expect(component.messages.length).toBe(1);
    expect(component.threadReplies.length).toBe(0);
  });

  it('confirms an optimistic own reply without duplicating its parent count', () => {
    const pending = { ...message('temp', 1, 'old'), pending: true, user_id: 'brent' };
    component.threadParentMessage = component.messages[0];
    component.threadReplies = [pending];
    component.messages[0].reply_count = 1;
    ws.newMessage$.next({ ...pending, id: 'confirmed', pending: false });
    expect(component.threadReplies.map(m => m.id)).toEqual(['confirmed']);
    expect(component.messages[0].reply_count).toBe(1);
  });

  it('buffers personal DMs while loading or viewing history, preserving cursors', fakeAsync(() => {
    component.hasNewerMessages = true;
    component.newerCursor = 'history-next'; component.nextCursor = 'older';
    dm(ws, message('new', 1)); ws.newMessage$.next(message('new', 1));
    expect(component.messages.map(m => m.id)).toEqual(['old']);
    expect(component.bufferedNewerCount).toBe(1);
    expect(component.newerCursor).toBe('history-next'); expect(component.nextCursor).toBe('older');
    tick(); expect(ws.markRead).not.toHaveBeenCalled();
  }));

  it('catches up all pages from the history-confirmed cursor even after a newer live event', () => {
    ws.newMessage$.next(message('live', 4));
    api.getMessagesAfter.and.callFake((_channel: string, cursor: string) =>
      of(cursor === 'old' ? page([message('missed', 1)], true) : page([message('later', 2)])));
    state.recoverSelectedConversation();
    expect(api.getMessagesAfter.calls.allArgs()).toEqual([['dm', 'old', 100], ['dm', 'missed', 100]]);
    expect(component.messages.map(m => m.id)).toEqual(['old', 'missed', 'later', 'live']);
    expect(ws.joinChannel).toHaveBeenCalledWith('dm');
    expect(state.recoveryCursor).toBe('later');
  });

  it('merges live events arriving during HTTP catch-up without losing or duplicating them', () => {
    const response = new Subject<any>(); api.getMessagesAfter.and.returnValue(response);
    state.recoverSelectedConversation();
    dm(ws, message('live', 3));
    response.next(page([message('missed', 1), message('live', 3)])); response.complete();
    expect(component.messages.map(m => m.id)).toEqual(['old', 'missed', 'live']);
  });

  it('does not replace loaded older pages or pagination during catch-up', () => {
    component.messages = [message('older', -2), message('old')];
    component.nextCursor = 'older-cursor'; component.hasMoreMessages = true;
    api.getMessagesAfter.and.returnValue(of(page([message('missed', 1)])));
    state.recoverSelectedConversation();
    expect(component.messages.map(m => m.id)).toEqual(['older', 'old', 'missed']);
    expect(component.nextCursor).toBe('older-cursor'); expect(component.hasMoreMessages).toBeTrue();
  });

  it('catches up into the buffer while a history window remains in place', () => {
    component.hasNewerMessages = true; component.newerCursor = 'forward'; component.nextCursor = 'back';
    api.getMessagesAfter.and.returnValue(of(page([message('missed', 1)])));
    state.recoverSelectedConversation();
    expect(component.messages.map(m => m.id)).toEqual(['old']);
    expect(component.bufferedNewerCount).toBe(1);
    expect(component.hasNewerMessages).toBeTrue(); expect(component.newerCursor).toBe('forward'); expect(component.nextCursor).toBe('back');
    expect(ws.markRead).not.toHaveBeenCalled();
  });

  it('reasserts and catches up when the same conversation is selected again', () => {
    component.selectChannel(component.currentChannel!);
    expect(ws.joinChannel).toHaveBeenCalledWith('dm');
    expect(api.getMessagesAfter).toHaveBeenCalledWith('dm', 'old', 100);
  });

  it('recovers after reconnect, server subscription acknowledgement, and the first visibility return', () => {
    ws.connectionState$.next('connected');
    ws.channelJoined$.next('dm');
    idle.idleState$.next('hidden'); idle.idleState$.next('active');
    expect(api.getMessagesAfter).toHaveBeenCalledTimes(3);
    expect(ws.joinChannel).toHaveBeenCalledTimes(2);
  });

  it('recovers on visibility return even if presence returns idle', () => {
    idle.idleState$.next('hidden'); idle.idleState$.next('idle');
    expect(api.getMessagesAfter).toHaveBeenCalled();
  });

  it('coalesces recovery triggers and retries after a transient HTTP failure', () => {
    spyOn(console, 'error');
    api.getMessagesAfter.and.returnValue(throwError(() => new Error('offline')));
    state.recoverSelectedConversation();
    expect(state.recoveryRequested).toBeTrue();
    expect(state.recoveryCursor).toBe('old');
    api.getMessagesAfter.and.returnValue(of(page([message('missed', 1)])));
    component.selectChannel(component.currentChannel!);
    expect(component.messages.map(m => m.id)).toEqual(['old', 'missed']);
    expect(state.recoveryRequested).toBeFalse();
  });

  it('defers recovery until the selected history load finishes', () => {
    const response = new Subject<any>(); api.getMessages.and.returnValue(response);
    component.loadMessages(); state.recoverSelectedConversation();
    expect(api.getMessagesAfter).not.toHaveBeenCalled();
    response.next(page([message('base', 1)])); response.complete();
    expect(api.getMessagesAfter).toHaveBeenCalledWith('dm', 'base', 100);
  });

  it('cancels an old channel catch-up when navigating away and back', () => {
    const stale = new Subject<any>(); api.getMessagesAfter.and.returnValue(stale);
    state.recoverSelectedConversation();
    component.selectChannel({ id: 'other', channel_type: 'dm' } as any);
    component.selectChannel({ ...channel } as any);
    stale.next(page([message('stale', 10)])); stale.complete();
    expect(component.messages.some(m => m.id === 'stale')).toBeFalse();
  });

  it('refreshes an open thread after recovery without dropping a pending reply', () => {
    component.threadParentMessage = component.messages[0];
    component.threadReplies = [{ ...message('pending', 3, 'old'), pending: true }];
    api.getThreadReplies.and.returnValue(of([message('reply', 1, 'old')]));
    state.recoverSelectedConversation();
    expect(component.threadReplies.map(m => m.id)).toEqual(['reply', 'pending']);
  });

  it('does not acknowledge hidden, unfocused, scrolled-up or historical messages', fakeAsync(() => {
    (Object.getOwnPropertyDescriptor(document, 'hidden')?.get as jasmine.Spy).and.returnValue(true);
    dm(ws, message('hidden', 1)); tick(); expect(ws.markRead).not.toHaveBeenCalled();
    (Object.getOwnPropertyDescriptor(document, 'hidden')?.get as jasmine.Spy).and.returnValue(false);
    (document.hasFocus as jasmine.Spy).and.returnValue(false);
    component.markLastMessageRead(); tick(); expect(ws.markRead).not.toHaveBeenCalled();
    (document.hasFocus as jasmine.Spy).and.returnValue(true);
    component.messageListRef = { isMessageVisible: () => false } as any;
    component.markLastMessageRead(); tick(); expect(ws.markRead).not.toHaveBeenCalled();
    component.messageListRef = { isMessageVisible: () => true } as any;
    component.hasNewerMessages = true;
    component.markLastMessageRead(); tick(); expect(ws.markRead).not.toHaveBeenCalled();
  }));

  it('never stores the server unread invalidation sentinel as a negative count', () => {
    ws.unreadUpdate$.next({ channelId: 'dm', unreadCount: -1 });
    expect(component.channels[0].unread_count).toBe(0);
  });
  it('reconciles a persisted own message after a lost acknowledgement and preserves other pending rows', () => {
    component.messages.push({ ...message('temp', 1), user_id: 'brent', pending: true });
    component.messages.push({ ...message('unsent', 2), user_id: 'brent', content: 'Still sending', pending: true });
    api.getMessagesAfter.and.returnValue(of(page([{ ...message('saved', 1), user_id: 'brent' }])));
    state.recoverSelectedConversation();
    expect(component.messages.map(m => m.id)).toEqual(['old', 'saved', 'unsent']);
  });

  it('does not count a reply already present in the open thread again', () => {
    const reply = message('reply', 1, 'old');
    component.threadParentMessage = component.messages[0]; component.threadReplies = [reply];
    component.messages[0].reply_count = 1;
    dm(ws, reply);
    expect(component.messages[0].reply_count).toBe(1);
    expect(component.threadReplies.length).toBe(1);
  });

  it('does not clear unread state just because a conversation was selected', () => {
    component.channels[0].unread_count = 3;
    const response = new Subject<any>(); api.getMessages.and.returnValue(response);
    component.currentChannel = null; component.selectChannel(component.channels[0]);
    expect(component.channels[0].unread_count).toBe(3);
  });

  it('does not launch deferred recovery while the component is being destroyed', () => {
    const response = new Subject<any>(); api.getMessagesAfter.and.returnValue(response);
    state.recoverSelectedConversation(); state.recoverSelectedConversation();
    component.ngOnDestroy();
    expect(api.getMessagesAfter).toHaveBeenCalledTimes(1);
  });

});


describe('Grid recovered-message viewport', () => {
  let list: MessageListComponent;
  beforeEach(() => { list = new MessageListComponent({} as any, {} as any); });
  afterEach(() => list.ngOnDestroy());

  it('does not scroll a reader up in the loaded feed when catch-up appends messages', () => {
    list.messages = [{ id: 'old' }] as any;
    list.ngOnChanges({ messages: new SimpleChange([], list.messages, true) });
    (list as any).shouldScrollToBottom = false; // initial render has settled
    list.userHasScrolledUp = true;
    const scroll = spyOn<any>(list, 'scrollToBottomWithRetry');
    const previous = list.messages;
    list.messages = [...previous, { id: 'recovered' } as any];
    list.ngOnChanges({ messages: new SimpleChange(previous, list.messages, false) });
    list.ngAfterViewChecked();
    expect(scroll).not.toHaveBeenCalled();
    expect(list.userHasScrolledUp).toBeTrue();
    expect(list.newMessagesWhileScrolledUp).toBe(1);
  });

  it('requires the last row to be rendered inside the viewport before acknowledging it', () => {
    const element = document.createElement('div');
    const row = document.createElement('div'); row.dataset['messageId'] = 'last'; element.appendChild(row);
    list.scrollContainer = { nativeElement: element } as any;
    spyOn(element, 'getBoundingClientRect').and.returnValue({ top: 0, bottom: 100 } as DOMRect);
    const bounds = spyOn(row, 'getBoundingClientRect').and.returnValue({ bottom: 150 } as DOMRect);
    expect(list.isMessageVisible('missing')).toBeFalse();
    expect(list.isMessageVisible('last')).toBeFalse();
    bounds.and.returnValue({ bottom: 90 } as DOMRect);
    expect(list.isMessageVisible('last')).toBeTrue();
    list.userHasScrolledUp = true; expect(list.isMessageVisible('last')).toBeFalse();
    list.userHasScrolledUp = false; list.hasNewer = true; expect(list.isMessageVisible('last')).toBeFalse();
  });
});
