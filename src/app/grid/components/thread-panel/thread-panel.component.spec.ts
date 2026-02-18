import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ThreadPanelComponent } from './thread-panel.component';
import { GridMentionService } from '../../services/grid-mention.service';
import { User } from '../../interfaces/user';

describe('ThreadPanelComponent', () => {
  let component: ThreadPanelComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ThreadPanelComponent],
      providers: [GridMentionService],
    });

    const sanitizer = TestBed.inject(DomSanitizer);
    const mentionService = TestBed.inject(GridMentionService);
    component = new ThreadPanelComponent(sanitizer, mentionService);
  });

  // Helper to unwrap SafeHtml to a plain string
  function html(content: string): string {
    const safe = component.formatMessageContent(content);
    return (safe as any)?.changingThisBreaksApplicationSecurity ?? String(safe);
  }

  // ---------- HTML escaping ----------

  describe('HTML escaping', () => {
    it('should escape <script> tags', () => {
      const result = html('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
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

    it('should leave unknown user IDs as the raw ID', () => {
      const result = html('Hey <@unknownUser>');
      expect(result).toContain('@unknownUser');
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

    it('should strip trailing punctuation', () => {
      const result = html('Check https://example.com!');
      expect(result).toContain('href="https://example.com"');
      expect(result).toMatch(/<\/a>!/);
    });

    it('should handle URLs with query parameters', () => {
      const result = html('Go to https://example.com/path?a=1&b=2');
      expect(result).toContain('href="https://example.com/path?a=1&b=2"');
    });
  });

  // ---------- Edge cases ----------

  describe('edge cases', () => {
    it('should return empty SafeHtml for empty string', () => {
      const result = html('');
      expect(result).toBe('');
    });

    it('should handle mentions + URLs in the same message', () => {
      const userMap = new Map<string, User>();
      userMap.set('u1', {
        sFirstName: 'Bob',
        sLastName: '',
        sFullName: 'Bob',
        sRole: 'Admin',
        sEmail: 'bob@oc.com',
        sPhone: '',
        sUID: 'u1',
        dtCreated: new Date(),
        sCreatedBy: '',
      });
      component.userMap = userMap;

      const result = html('Hey <@u1> see https://example.com');
      expect(result).toContain('<span class="mention">@Bob</span>');
      expect(result).toContain('<a href="https://example.com"');
    });
  });
});
