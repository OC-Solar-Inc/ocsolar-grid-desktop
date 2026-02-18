import { GridMentionService, MentionSuggestion } from './grid-mention.service';
import { User } from '../interfaces/user';
import { GridChannel } from '../interfaces/grid.interface';

describe('GridMentionService', () => {
  let service: GridMentionService;

  beforeEach(() => {
    service = new GridMentionService();
  });

  // ---------- search() ----------

  describe('search()', () => {
    const channelId = 'ch1';

    beforeEach(() => {
      const userMap = new Map<string, User>();
      userMap.set('u1', makeUser('Alice Smith', 'alice@oc.com'));
      userMap.set('u2', makeUser('Bob Jones', 'bob@oc.com'));
      userMap.set('u3', makeUser('Charlie Brown', 'charlie@oc.com'));
      service.loadChannelMembers(channelId, userMap);
    });

    it('should return all members when query is empty', () => {
      const results = service.search('', channelId);
      expect(results.length).toBe(3);
    });

    it('should filter by display_name', () => {
      const results = service.search('alice', channelId);
      expect(results.length).toBe(1);
      expect(results[0].display_name).toBe('Alice Smith');
    });

    it('should filter by username (email)', () => {
      const results = service.search('bob@', channelId);
      expect(results.length).toBe(1);
      expect(results[0].username).toBe('bob@oc.com');
    });

    it('should be case-insensitive', () => {
      const results = service.search('CHARLIE', channelId);
      expect(results.length).toBe(1);
    });

    it('should return empty for unmatched query', () => {
      const results = service.search('xyz', channelId);
      expect(results.length).toBe(0);
    });

    it('should return empty for unknown channel', () => {
      const results = service.search('', 'no-such-channel');
      expect(results.length).toBe(0);
    });
  });

  // ---------- insertMention() ----------

  describe('insertMention()', () => {
    const user: MentionSuggestion = {
      user_id: 'u1',
      display_name: 'Alice Smith',
      username: 'alice@oc.com',
    };

    it('should splice mention at the @ position', () => {
      // Content: "Hello @al" with cursor at 9
      const result = service.insertMention('Hello @al', 9, 6, user);
      expect(result.content).toBe('Hello @[Alice Smith] ');
      expect(result.cursorPos).toBe('Hello @[Alice Smith] '.length);
    });

    it('should preserve text after cursor', () => {
      // "Hey @bo|more" — @ at index 4, cursor at 7 (end of "@bo")
      const result = service.insertMention('Hey @bomore', 7, 4, user);
      expect(result.content).toBe('Hey @[Alice Smith] more');
    });

    it('should return correct mention mapping', () => {
      const result = service.insertMention('@a', 2, 0, user);
      expect(result.mentionMapping).toEqual({
        displayName: 'Alice Smith',
        userId: 'u1',
      });
    });
  });

  // ---------- convertMentionsForSend() ----------

  describe('convertMentionsForSend()', () => {
    it('should convert @[DisplayName] to <@userId>', () => {
      const map = new Map([['Alice Smith', 'u1']]);
      const result = service.convertMentionsForSend('Hello @[Alice Smith]!', map);
      expect(result).toBe('Hello <@u1>!');
    });

    it('should convert multiple mentions', () => {
      const map = new Map([
        ['Alice Smith', 'u1'],
        ['Bob Jones', 'u2'],
      ]);
      const result = service.convertMentionsForSend(
        '@[Alice Smith] and @[Bob Jones] hello',
        map
      );
      expect(result).toBe('<@u1> and <@u2> hello');
    });

    it('should leave unmatched mentions intact', () => {
      const map = new Map<string, string>();
      const result = service.convertMentionsForSend('Hey @[Unknown]', map);
      expect(result).toBe('Hey @[Unknown]');
    });
  });

  // ---------- extractDisplayMentions() ----------

  describe('extractDisplayMentions()', () => {
    it('should extract all mention display names', () => {
      const names = service.extractDisplayMentions('Hey @[Alice] and @[Bob]');
      expect(names).toEqual(['Alice', 'Bob']);
    });

    it('should deduplicate repeated mentions', () => {
      const names = service.extractDisplayMentions('@[Alice] cc @[Alice]');
      expect(names).toEqual(['Alice']);
    });

    it('should return empty for no mentions', () => {
      const names = service.extractDisplayMentions('Hello world');
      expect(names).toEqual([]);
    });
  });

  // ---------- extractMentionQuery() ----------

  describe('extractMentionQuery()', () => {
    it('should find @ at start of string', () => {
      const result = service.extractMentionQuery('@ali', 4);
      expect(result).toEqual({ startIndex: 0, query: 'ali' });
    });

    it('should find @ after whitespace', () => {
      const result = service.extractMentionQuery('Hello @bob', 10);
      expect(result).toEqual({ startIndex: 6, query: 'bob' });
    });

    it('should return null for email-like @', () => {
      const result = service.extractMentionQuery('user@example.com', 16);
      expect(result).toBeNull();
    });

    it('should return null if query contains a space', () => {
      const result = service.extractMentionQuery('@some thing', 11);
      expect(result).toBeNull();
    });

    it('should return null when no @ present', () => {
      const result = service.extractMentionQuery('Hello', 5);
      expect(result).toBeNull();
    });

    it('should return empty query when cursor is right after @', () => {
      const result = service.extractMentionQuery('Hello @', 7);
      expect(result).toEqual({ startIndex: 6, query: '' });
    });
  });

  // ---------- loadChannelMembers() ----------

  describe('loadChannelMembers()', () => {
    it('should load DM members from dm_user', () => {
      const channel: GridChannel = {
        id: 'dm1',
        name: 'DM',
        channel_type: 'dm',
        created_by_id: 'u1',
        created_at: '',
        updated_at: '',
        is_archived: false,
        dm_user: {
          user_id: 'u2',
          display_name: 'Bob Jones',
          username: 'bob',
          is_online: true,
        },
      };
      service.loadChannelMembers('dm1', new Map(), channel);
      const results = service.search('', 'dm1');
      expect(results.length).toBe(1);
      expect(results[0].display_name).toBe('Bob Jones');
    });

    it('should filter out Customer role users for channels', () => {
      const userMap = new Map<string, User>();
      userMap.set('u1', makeUser('Internal User', 'int@oc.com', 'Admin'));
      userMap.set('u2', makeUser('Customer User', 'cust@oc.com', 'Customer'));
      service.loadChannelMembers('ch1', userMap);
      const results = service.search('', 'ch1');
      expect(results.length).toBe(1);
      expect(results[0].display_name).toBe('Internal User');
    });

    it('should filter customers via sRoles array', () => {
      const userMap = new Map<string, User>();
      const customer = makeUser('Buyer', 'buy@oc.com', '');
      customer.sRoles = ['Customer'];
      userMap.set('u1', customer);
      userMap.set('u2', makeUser('Staff', 'staff@oc.com', 'Admin'));
      service.loadChannelMembers('ch1', userMap);
      const results = service.search('', 'ch1');
      expect(results.length).toBe(1);
      expect(results[0].display_name).toBe('Staff');
    });

    it('should sort channel members by display name', () => {
      const userMap = new Map<string, User>();
      userMap.set('u1', makeUser('Zara', 'z@oc.com'));
      userMap.set('u2', makeUser('Anna', 'a@oc.com'));
      service.loadChannelMembers('ch1', userMap);
      const results = service.search('', 'ch1');
      expect(results[0].display_name).toBe('Anna');
      expect(results[1].display_name).toBe('Zara');
    });
  });
});

// ----- helpers -----

function makeUser(fullName: string, email: string, role = 'Admin'): User {
  const parts = fullName.split(' ');
  return {
    sFirstName: parts[0] || '',
    sLastName: parts.slice(1).join(' ') || '',
    sFullName: fullName,
    sRole: role,
    sEmail: email,
    sPhone: '',
    sUID: email,
    dtCreated: new Date(),
    sCreatedBy: '',
  };
}
