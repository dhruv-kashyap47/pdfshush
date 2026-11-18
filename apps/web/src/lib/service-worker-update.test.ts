/**
 * The update action must always resolve. A waiting worker that acknowledges
 * `SKIP_WAITING` reloads the page on `controllerchange`; one that never does
 * (older build, dropped message, slow Safari activation) must not leave the
 * banner's Reload button as a no-op. These tests pin both paths, plus the
 * stale-registration fallback.
 *
 * The suite runs in `node`, where `navigator` exists as a read-only getter, so
 * the tests install and restore their own property descriptors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/build-recovery', () => ({
  hardReload: vi.fn(async () => undefined),
}));

import { hardReload } from '@/lib/build-recovery';
import { activateWaiting, applyServiceWorkerUpdate } from './service-worker';

const reload = vi.fn();

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function defineGlobal(name: 'navigator' | 'window', value: unknown) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function restoreGlobal(name: 'navigator' | 'window', descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

function stubNavigator(
  addEventListener: (type: string, listener: () => void, options?: unknown) => void = () =>
    undefined,
) {
  defineGlobal('navigator', { serviceWorker: { addEventListener } });
}

function fakeRegistration(waiting: { postMessage: ReturnType<typeof vi.fn> } | null) {
  return { waiting } as unknown as ServiceWorkerRegistration;
}

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockReset();
  vi.mocked(hardReload).mockClear();
  defineGlobal('window', { location: { reload } });
});

afterEach(() => {
  vi.useRealTimers();
  restoreGlobal('window', windowDescriptor);
  restoreGlobal('navigator', navigatorDescriptor);
});

describe('service worker update action', () => {
  it('reloads once the waiting worker takes control, and does not double-reload', () => {
    const listeners: Array<() => void> = [];
    stubNavigator((type, listener) => {
      if (type === 'controllerchange') listeners.push(listener);
    });
    const waiting = { postMessage: vi.fn() };

    activateWaiting(fakeRegistration(waiting));

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(listeners).toHaveLength(1);

    for (const listener of listeners) listener();
    expect(reload).toHaveBeenCalledTimes(1);

    // The grace timer must see the reload and stay quiet.
    vi.advanceTimersByTime(10_000);
    expect(hardReload).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('falls back to a hardened reload when the worker never acknowledges', () => {
    stubNavigator();
    const waiting = { postMessage: vi.fn() };

    activateWaiting(fakeRegistration(waiting));

    vi.advanceTimersByTime(2_999);
    expect(hardReload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(hardReload).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('hard-reloads when the announced registration has no waiting worker', () => {
    stubNavigator();

    activateWaiting(fakeRegistration(null));

    expect(hardReload).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('hard-reloads when no registration was announced at all', () => {
    stubNavigator();

    applyServiceWorkerUpdate();

    expect(hardReload).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
