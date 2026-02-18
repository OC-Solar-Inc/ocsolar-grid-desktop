import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { MessageListComponent } from './message-list.component';
import { GridFileUploadService } from '../../services/grid-file-upload.service';
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
});
