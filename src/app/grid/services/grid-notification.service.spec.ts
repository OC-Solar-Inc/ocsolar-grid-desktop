import { GridNotificationService } from './grid-notification.service';

describe('GridNotificationService', () => {
  let electronShowNotification: jasmine.Spy;

  beforeEach(() => {
    localStorage.clear();
    electronShowNotification = jasmine.createSpy('showNotification');
    (window as any).electronAPI = { showNotification: electronShowNotification };
    // Force document.hidden to false so suppression tests are deterministic
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  });

  afterEach(() => {
    delete (window as any).electronAPI;
    delete (document as any).hidden;
    localStorage.clear();
  });

  function create(): GridNotificationService {
    return new GridNotificationService();
  }

  // ---------- Master toggle ----------

  it('auto-enables in Electron on first launch', () => {
    const service = create();
    expect(service.isEnabled()).toBeTrue();
    expect(localStorage.getItem('gridNotificationsEnabled')).toBe('true');
  });

  it('sends nothing when Desktop Notifications is toggled off', () => {
    const service = create();
    service.disable();
    service.showNotification('Alice', 'hi', 'dm', 'c1');
    service.showNotification('#general', 'hi', 'channel', 'c2');
    service.showNotification('Mentioned', 'hi', 'mention', 'c3');
    expect(electronShowNotification).not.toHaveBeenCalled();
  });

  it('persists the disabled state across restarts', () => {
    create().disable();
    const service = create();
    expect(service.isEnabled()).toBeFalse();
    service.showNotification('Alice', 'hi', 'dm', 'c1');
    expect(electronShowNotification).not.toHaveBeenCalled();
  });

  it('re-enables via requestPermission in Electron without a browser prompt', async () => {
    const service = create();
    service.disable();
    const granted = await service.requestPermission();
    expect(granted).toBeTrue();
    expect(service.isEnabled()).toBeTrue();
  });

  // ---------- Per-type checkboxes ----------

  it('blocks only the unchecked type (channel off, dm/mention on)', () => {
    const service = create();
    service.setPreference('channel', false);

    service.showNotification('#general', 'Bob: hello', 'channel', 'c1');
    expect(electronShowNotification).not.toHaveBeenCalled();

    service.showNotification('Alice', 'hi', 'dm', 'c2');
    service.showNotification('Mentioned in #general', 'hey you', 'mention', 'c1');
    expect(electronShowNotification).toHaveBeenCalledTimes(2);
    expect(electronShowNotification).toHaveBeenCalledWith('Alice', 'hi');
    expect(electronShowNotification).toHaveBeenCalledWith('Mentioned in #general', 'hey you');
  });

  it('persists per-type preferences across restarts', () => {
    create().setPreference('channel', false);
    const service = create();
    service.showNotification('#general', 'Bob: hello', 'channel', 'c1');
    expect(electronShowNotification).not.toHaveBeenCalled();
    service.showNotification('Alice', 'hi', 'dm', 'c2');
    expect(electronShowNotification).toHaveBeenCalledTimes(1);
  });

  it('re-checking a type allows it again', () => {
    const service = create();
    service.setPreference('dm', false);
    service.showNotification('Alice', 'hi', 'dm', 'c1');
    expect(electronShowNotification).not.toHaveBeenCalled();

    service.setPreference('dm', true);
    service.showNotification('Alice', 'hi again', 'dm', 'c1');
    expect(electronShowNotification).toHaveBeenCalledWith('Alice', 'hi again');
  });

  // ---------- Channel suppression ----------

  it('suppresses notifications for the channel currently being viewed while visible', () => {
    const service = create();
    service.setCurrentChannel('c1');
    service.showNotification('Alice', 'hi', 'dm', 'c1');
    expect(electronShowNotification).not.toHaveBeenCalled();
  });

  it('still notifies for other channels while viewing one', () => {
    const service = create();
    service.setCurrentChannel('c1');
    service.showNotification('Alice', 'hi', 'dm', 'c2');
    expect(electronShowNotification).toHaveBeenCalledWith('Alice', 'hi');
  });

  it('notifies for the current channel when the window is hidden', () => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    const service = create();
    service.setCurrentChannel('c1');
    service.showNotification('Alice', 'hi', 'dm', 'c1');
    expect(electronShowNotification).toHaveBeenCalledWith('Alice', 'hi');
  });

  // ---------- Body handling ----------

  it('truncates bodies longer than 100 characters', () => {
    const service = create();
    const longBody = 'x'.repeat(150);
    service.showNotification('Alice', longBody, 'dm', 'c1');
    expect(electronShowNotification).toHaveBeenCalledWith('Alice', 'x'.repeat(100) + '...');
  });
});
