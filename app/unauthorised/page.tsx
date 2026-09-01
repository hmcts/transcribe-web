import type React from "react";

function Unauthorised(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-start justify-center bg-background px-4 pt-16">
      <section className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
        <h1 className="mb-3 text-2xl font-bold text-card-foreground">
          Unauthorised Access
        </h1>

        <p className="text-muted-foreground">
          Sorry, you don&apos;t have permission to access this page. Please
          contact your administrator if you believe this is an error.
        </p>
      </section>
    </main>
  );
}

export default Unauthorised;
