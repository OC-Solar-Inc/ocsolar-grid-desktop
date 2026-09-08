import { SimpleChange, SimpleChanges } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { MessageListComponent } from './message-list.component';
import { GridFileUploadService } from '../../services/grid-file-upload.service';
import { GridMessage } from '../../interfaces/grid.interface';
import { User } from '../../interfaces/user';

describe('MessageListComponent', () => {
  let component: MessageListComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MessageListComponent],
      providers: [
        {
          provide: GridFileUploadService,
          useValue: {},
        },
      ],
    });

    // Create component instance directly — we only test the TS logic, not the template
    const sanitizer = TestBed.inject(DomSanitizer);
    const fileService = TestBed.inject(GridFileUploadService);
    component = new MessageListComponent(sanitizer, fileService);
  });

  // Helper to unwrap SafeHtml to a plain string for assertions
  function html(content: string): string {
    const safe = component.formatMessageContent(content);
    // SafeHtml wraps the value; coerce via toString workaround
    return (safe as any)?.changingThisBreaksApplicationSecurity ?? String(safe);
  }

  // ---------- HTML escaping ----------

  describe('HTML escaping', () => {
    it('should escape <script> tags', () => {
      const result = html('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });

    it('should escape angle brackets in normal text', () => {
      const result = html('a < b > c');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });
  });

  // ---------- Mention replacement ----------

  describe('mention replacement', () => {
    beforeEach(() => {
      const userMap = new Map<string, User>();
      userMap.set('u1', {
        sFirstName: 'Alice',
        sLastName: 'Smith',
        sFullName: 'Alice Smith',
        sRole: 'Admin',
        sEmail: 'alice@oc.com',
        sPhone: '',
        sUID: 'u1',
        dtCreated: new Date(),
        sCreatedBy: '',
      });
      component.userMap = userMap;
    });

    it('should replace <@userId> with a styled mention span', () => {
      const result = html('Hello <@u1>');
      expect(result).toContain('<span class="mention">@Alice Smith</span>');
    });

    it('should leave unknown user IDs as-is', () => {
      const result = html('Hey <@unknown123>');
      expect(result).toContain('@unknown123');
    });
  });

  // ---------- GIPHY URL embedding ----------

  describe('GIPHY embedding', () => {
    it('should embed media.giphy.com GIF as <img>', () => {
      const url = 'https://media.giphy.com/media/abc123/giphy.gif';
      const result = html(url);
      expect(result).toContain('<img src="');
      expect(result).toContain('class="inline-gif"');
    });

    it('should embed media1.giphy.com GIF as <img>', () => {
      const url = 'https://media1.giphy.com/media/abc123/giphy.gif';
      const result = html(url);
      expect(result).toContain('<img src="');
    });

    it('should embed i.giphy.com GIF as <img>', () => {
      const url = 'https://i.giphy.com/abc123.gif';
      const result = html(url);
      expect(result).toContain('<img src="');
    });
  });

  // ---------- URL linkification ----------

  describe('URL linkification', () => {
    it('should convert plain URLs to <a> tags', () => {
      const result = html('Visit https://example.com today');
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain('target="_blank"');
    });

    it('should strip trailing period from URL', () => {
      const result = html('See https://example.com.');
      expect(result).toContain('href="https://example.com"');
      expect(result).toMatch(/https:\/\/example\.com<\/a>\./);
    });

    it('should strip trailing punctuation like ), !, ?', () => {
      const result = html('(https://example.com)');
      expect(result).toContain('href="https://example.com"');
      expect(result).toMatch(/<\/a>\)/);
    });

    it('should not double-linkify GIPHY URLs that became <img> tags', () => {
      const url = 'https://media.giphy.com/media/abc/giphy.gif';
      const result = html(url);
      // Should NOT have an <a> wrapping the <img>
      expect(result).not.toContain('<a href="https://media.giphy.com');
    });
  });

  // ---------- Combined content ----------

  describe('combined content', () => {
    beforeEach(() => {
      const userMap = new Map<string, User>();
      userMap.set('u1', {
        sFirstName: 'Alice',
        sLastName: 'Smith',
        sFullName: 'Alice Smith',
        sRole: 'Admin',
        sEmail: 'alice@oc.com',
        sPhone: '',
        sUID: 'u1',
        dtCreated: new Date(),
        sCreatedBy: '',
      });
      component.userMap = userMap;
    });

    it('should handle mentions + URLs in the same message', () => {
      const result = html('Hey <@u1> check https://example.com');
      expect(result).toContain('<span class="mention">@Alice Smith</span>');
      expect(result).toContain('<a href="https://example.com"');
    });
  });

  // ---------- Empty / falsy content ----------

  describe('edge cases', () => {
    it('should return empty SafeHtml for empty string', () => {
      const result = html('');
      expect(result).toBe('');
    });
  });

  // ---------- Jump-to-message / history mode scroll rules ----------

  describe('jump-to-message and history mode', () => {
    const msg = (id: string, i: number): GridMessage => ({
      id,
      channel: 'c1',
      user_id: 'u1',
      content: `m ${id}`,
      parent: null,
      reply_count: 0,
      created_at: new Date(2026, 0, 1, 0, i).toISOString(),
      is_edited: false,
      is_deleted: false,
    });
    const change = (key: string, previousValue: any, currentValue: any, firstChange = false): SimpleChanges => ({
      [key]: new SimpleChange(previousValue, currentValue, firstChange),
    });
    const priv = () => component as any;

    it('a highlight request on an initial load does not scroll to the bottom', () => {
      component.highlightRequest = { messageId: 'b', token: 1 };
      component.messages = [msg('a', 1), msg('b', 2), msg('c', 3)];
      component.ngOnChanges({
        ...change('highlightRequest', null, component.highlightRequest),
        ...change('messages', [], component.messages),
      });
      expect(priv().pendingHighlightId).toBe('b');
      expect(priv().shouldScrollToBottom).toBeFalse();
      expect(component.userHasScrolledUp).toBeTrue();
    });

    it('a normal initial load still scrolls to the bottom', () => {
      component.messages = [msg('a', 1), msg('b', 2)];
      component.ngOnChanges(change('messages', [], component.messages));
      expect(priv().shouldScrollToBottom).toBeTrue();
      expect(component.userHasScrolledUp).toBeFalse();
    });

    it('messages appended while viewing history never pull the viewport down', () => {
      component.messages = [msg('a', 1), msg('b', 2)];
      component.ngOnChanges(change('messages', [], component.messages));
      priv().shouldScrollToBottom = false;
      component.hasNewer = true;
      component.userHasScrolledUp = false;

      const before = component.messages;
      component.messages = [...before, msg('c', 3), msg('d', 4)];
      component.ngOnChanges(change('messages', before, component.messages));
      expect(priv().shouldScrollToBottom).toBeFalse();
      expect(component.newMessagesWhileScrolledUp).toBe(0);
    });

    it('a channel switch (empty list) drops a pending jump target', () => {
      component.highlightRequest = { messageId: 'zzz', token: 2 };
      component.ngOnChanges(change('highlightRequest', null, component.highlightRequest));
      expect(priv().pendingHighlightId).toBe('zzz');
      const before = [msg('a', 1)];
      component.messages = [];
      component.ngOnChanges(change('messages', before, []));
      expect(priv().pendingHighlightId).toBeNull();
    });

    it('jumpToLatest asks the shell for the live tail while in history mode', () => {
      const emitted = jasmine.createSpy('jumpToLatestRequested');
      component.jumpToLatestRequested.subscribe(emitted);
      component.hasNewer = true;
      component.userHasScrolledUp = true;
      component.jumpToLatest();
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(component.userHasScrolledUp).toBeFalse();
    });

    it('jumpToLatest just scrolls when the tail is already loaded', () => {
      const emitted = jasmine.createSpy('jumpToLatestRequested');
      component.jumpToLatestRequested.subscribe(emitted);
      component.hasNewer = false;
      component.jumpToLatest();
      expect(emitted).not.toHaveBeenCalled();
    });

    it('scrolling near the bottom pages forward only in history mode', () => {
      const emitted = jasmine.createSpy('loadNewer');
      component.loadNewer.subscribe(emitted);
      const target = { scrollTop: 900, scrollHeight: 1500, clientHeight: 550 } as unknown as HTMLDivElement;
      const event = { target } as unknown as Event;

      component.hasNewer = false;
      component.onScroll(event);
      expect(emitted).not.toHaveBeenCalled();

      component.hasNewer = true;
      component.onScroll(event);
      expect(emitted).toHaveBeenCalledTimes(1);

      component.isLoadingNewer = true;
      component.onScroll(event);
      expect(emitted).toHaveBeenCalledTimes(1);
    });
  });
});
