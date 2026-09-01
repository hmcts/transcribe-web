"use client";

export default function Step2BasicTutorial() {
  return (
    <div className="w-full space-y-6">
      {/* Content area - YouTube-like: main player left, sidebar right */}
      <div className="grid grid-cols-12 items-start gap-6">
        {/* Video Section */}
        <div className="col-span-12 md:col-span-7 lg:col-span-8">
          <div className="relative w-full overflow-hidden rounded-lg bg-gradient-to-br from-blue-900 via-slate-900 to-blue-700 p-6 text-white shadow-sm">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.12),transparent_30%)]" />
            <div className="relative space-y-4">
              <p className="text-sm font-semibold uppercase tracking-wide text-white/70">
                Quick tips
              </p>
              <h2 className="text-2xl font-semibold leading-tight sm:text-3xl">
                Record confidently on web or mobile
              </h2>
              <ul className="space-y-2 text-base text-white/90">
                <li>Pick a quiet spot and speak clearly into your device.</li>
                <li>Check your mic input in the browser permissions prompt.</li>
                <li>
                  Stay on the page while recording; we will email when done.
                </li>
              </ul>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg bg-white/10 p-3 text-sm backdrop-blur">
                  <p className="font-semibold">Max duration</p>
                  <p className="text-white/80">Up to 2 hours per session</p>
                </div>
                <div className="rounded-lg bg-white/10 p-3 text-sm backdrop-blur">
                  <p className="font-semibold">Start anywhere</p>
                  <p className="text-white/80">Virtual or in-person meetings</p>
                </div>
                <div className="rounded-lg bg-white/10 p-3 text-sm backdrop-blur">
                  <p className="font-semibold">We notify you</p>
                  <p className="text-white/80">
                    Email when your summary is ready
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Steps Section */}
        <div className="col-span-12 min-w-0 md:col-span-5 md:min-w-[280px] lg:col-span-4 lg:min-w-[320px]">
          <div className="mb-4 text-left">
            <h1 className="text-3xl font-semibold sm:text-4xl">
              Transcribe a Meeting
            </h1>
            <h2 className="bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-xl font-medium text-transparent">
              Using Judicial Transcribe is simple
            </h2>
          </div>
          <div
            className="space-y-4 text-black"
            aria-label="How to record a meeting steps"
          >
            <p className="text-base">
              <span className="mr-2 font-semibold text-blue-600">1.</span>
              Click start new meeting and select in person or virtual meeting
            </p>
            <p className="text-base">
              <span className="mr-2 font-semibold text-blue-600">2.</span>
              Give permission to use your microphone
            </p>
            <p className="text-base">
              <span className="mr-2 font-semibold text-blue-600">3.</span>
              Click start recording
            </p>
            <p className="text-base">
              <span className="mr-2 font-semibold text-blue-600">4.</span>
              Click stop recording
            </p>
            <p className="text-base">
              <span className="mr-2 font-semibold text-blue-600">5.</span>
              We&apos;ll email you when your summary is ready for review
            </p>
            <p className="mt-6 text-base text-black">
              You can record for up to 2 hours per session.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
