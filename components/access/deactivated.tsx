"use client";

/**
 * Shown, and nothing else, when the API says the account has been deactivated
 * (403 `user_deactivated`, DIAAT-383): nothing can be done in BenchNotes until an
 * administrator reactivates it, so the page says so (its shell has Sign out).
 */
export function Deactivated() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Your account has been deactivated</h1>
      <p className="text-muted-foreground">
        You cannot use BenchNotes while it is deactivated. Ask a BenchNotes
        administrator to reactivate it, then sign in again (Sign out is at the top of the page).
      </p>
    </div>
  );
}
