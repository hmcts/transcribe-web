import { afterAll, vi } from "vitest";

/**
 * sonner removes a dismissed toast 200 ms later, on a timer it never clears. In a
 * file that renders a real <Toaster>, one dismissed by its last test can fire after
 * the test environment is torn down, when React finds no window: Vitest then fails
 * the run with an unhandled error. Let it run first.
 */
export function waitForToastsToGo() {
  afterAll(async () => {
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}
