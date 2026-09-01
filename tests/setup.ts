/**
 * Vitest setup file for test configuration
 */

import { afterEach, beforeAll, vi } from "vitest";

// Setup environment variables for tests
beforeAll(() => {
  // Set test environment variables
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";
  // Note: NODE_ENV is automatically set to "test" by Vitest
});

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Mock window.URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
global.URL.revokeObjectURL = vi.fn();

// Ensure localStorage has all standard methods (jsdom may omit clear/key without a localstorage-file)
if (typeof localStorage.clear !== "function") {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  });
}

// Mock MediaRecorder if not available in test environment
if (!global.MediaRecorder) {
  global.MediaRecorder = vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    ondataavailable: null,
    onstop: null,
    state: "inactive",
  })) as any;
}

// Mock navigator.mediaDevices if not available
if (!global.navigator.mediaDevices) {
  (global.navigator as any).mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [
        {
          stop: vi.fn(),
          kind: "audio",
          label: "Mock Audio Track",
        },
      ],
    }),
  };
}
