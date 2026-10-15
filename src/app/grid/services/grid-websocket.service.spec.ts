import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { GridWebsocketService } from './grid-websocket.service';

class FakeSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: any[] = [];
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  open(): void { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  close(code = 1000, reason = ''): void { this.readyState = FakeSocket.CLOSED; this.onclose?.({ code, reason }); }
}

describe('Grid WebSocket recovery', () => {
  let service: GridWebsocketService;
  let auth: any;
  let original: typeof WebSocket;
  beforeEach(() => {
    original = window.WebSocket;
    (window as any).WebSocket = FakeSocket;
    FakeSocket.instances = [];
    localStorage.setItem('userDocId', 'brent');
    auth = { getIdToken: jasmine.createSpy().and.returnValue(Promise.resolve('test-token')), getCurrentUserDocId: () => 'brent' };
    service = new GridWebsocketService({ wsUrl: 'wss://example.invalid' } as any, auth);
  });
  afterEach(() => { service.disconnect(); window.WebSocket = original; localStorage.removeItem('userDocId'); });

  it('reconnects after a clean server close and rejoins the selected conversation', fakeAsync(() => {
    service.joinChannel('dm'); void service.connect(); flushMicrotasks();
    FakeSocket.instances[0].open(); FakeSocket.instances[0].close(1000);
    tick(3000); flushMicrotasks(); FakeSocket.instances[1].open();
    expect(FakeSocket.instances[1].sent).toContain({ type: 'join_channel', channel_id: 'dm' });
    service.disconnect();
  }));

  it('keeps retrying through more than ten failures', fakeAsync(() => {
    void service.connect(); flushMicrotasks();
    for (let i = 0; i < 12; i++) {
      FakeSocket.instances[i].close(1006); tick(31000); flushMicrotasks();
    }
    expect(FakeSocket.instances.length).toBe(13);
    service.disconnect();
  }));

  it('does not revive an intentional disconnect while token refresh is pending', fakeAsync(() => {
    let resolve!: (token: string) => void;
    auth.getIdToken.and.returnValue(new Promise<string>(done => resolve = done));
    void service.connect(); service.disconnect(); resolve('late-token'); flushMicrotasks();
    expect(FakeSocket.instances.length).toBe(0);
  }));

  it('allows only the newest forced connection after overlapping token refreshes', fakeAsync(() => {
    const resolves: ((token: string) => void)[] = [];
    auth.getIdToken.and.callFake(() => new Promise<string>(done => resolves.push(done)));
    void service.connect(); service.forceReconnect();
    resolves[1]('new-token'); flushMicrotasks(); resolves[0]('old-token'); flushMicrotasks();
    expect(FakeSocket.instances.length).toBe(1);
    expect(FakeSocket.instances[0].url).toContain('new-token');
  }));

  it('does not create competing sockets from repeated connect calls', fakeAsync(() => {
    void service.connect(); void service.connect(); flushMicrotasks(); void service.connect();
    expect(FakeSocket.instances.length).toBe(1);
  }));

  it('reports server channel-join acknowledgements for history catch-up', fakeAsync(() => {
    const joined = jasmine.createSpy(); service.channelJoined$.subscribe(joined);
    void service.connect(); flushMicrotasks(); FakeSocket.instances[0].open();
    FakeSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'channel_joined', channel_id: 'dm' }) });
    expect(joined).toHaveBeenCalledWith('dm'); service.disconnect();
  }));
});
