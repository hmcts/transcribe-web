export function CookieBanner() {
  return (
    <div
      className="cookie-banner fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-muted"
      data-nosnippet
      role="region"
      aria-label="Cookies on Judicial Transcribe"
      hidden
    >
      {/* Initial message */}
      <div className="cookie-banner-message px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-2 text-base font-semibold">
            Cookies on Judicial Transcribe
          </h2>
          <p className="mb-1 text-sm text-muted-foreground">
            We use some essential cookies to make this service work.
          </p>
          <p className="mb-3 text-sm text-foreground">
            We'd like to set additional cookies so we can understand how people
            use the service and make improvements.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="cookie-banner-accept-button inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Accept additional cookies
            </button>
            <button
              type="button"
              className="cookie-banner-reject-button inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent"
            >
              Reject additional cookies
            </button>
            <a href="/cookies" className="text-sm text-primary underline-offset-4 hover:underline">
              View cookie settings
            </a>
          </div>
        </div>
      </div>

      {/* Accepted confirmation */}
      <div className="cookie-banner-accept-message px-4 py-4 sm:px-6" hidden>
        <div className="mx-auto max-w-7xl">
          <p className="mb-3 text-sm text-foreground">
            You've accepted additional cookies. You can{" "}
            <a href="/cookies" className="text-primary underline-offset-4 hover:underline">
              change your cookie settings
            </a>{" "}
            at any time.
          </p>
          <button
            type="button"
            className="cookie-banner-hide-button inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent"
          >
            Hide this message
          </button>
        </div>
      </div>

      {/* Rejected confirmation */}
      <div className="cookie-banner-reject-message px-4 py-4 sm:px-6" hidden>
        <div className="mx-auto max-w-7xl">
          <p className="mb-3 text-sm text-foreground">
            You've rejected additional cookies. You can{" "}
            <a href="/cookies" className="text-primary underline-offset-4 hover:underline">
              change your cookie settings
            </a>{" "}
            at any time.
          </p>
          <button
            type="button"
            className="cookie-banner-hide-button inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent"
          >
            Hide this message
          </button>
        </div>
      </div>
    </div>
  );
}
