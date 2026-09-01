"use client";

import { Check } from "lucide-react";

export default function Step3ReviewEdit() {
  return (
    <div className="w-full space-y-6">
      <div className="grid grid-cols-12 items-start gap-6">
        {/* Video Section */}
        <div className="col-span-12 md:col-span-7 lg:col-span-8">
          <div className="relative w-full overflow-hidden rounded-lg bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-800 p-6 text-white shadow-sm">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(255,255,255,0.08),transparent_30%),radial-gradient(circle_at_90%_20%,rgba(255,255,255,0.1),transparent_35%)]" />
            <div className="relative space-y-4">
              <p className="text-sm font-semibold uppercase tracking-wide text-white/70">
                Review checklist
              </p>
              <h2 className="text-2xl font-semibold leading-tight sm:text-3xl">
                Tighten your summary before you submit
              </h2>
              <ul className="space-y-2 text-base text-white/90">
                <li>Skim for names, places, acronyms, and job titles.</li>
                <li>Capture context and body language that text may miss.</li>
                <li>Keep within the 4,000 character target for NDelius.</li>
              </ul>
              <div className="rounded-lg bg-white/10 p-3 text-sm text-white/90 backdrop-blur">
                Tip: If something looks off, play back the relevant clip before
                editing so you can correct in one pass.
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar: Title + Checklist */}
        <div className="col-span-12 min-w-0 md:col-span-5 md:min-w-[280px] lg:col-span-4 lg:min-w-[320px]">
          <div className="mb-4 text-left">
            <h1 className="text-3xl font-semibold sm:text-4xl">
              Review and edit
            </h1>
            <h2 className="bg-gradient-to-r from-purple-600 to-purple-400 bg-clip-text text-xl font-medium text-transparent">
              Your professional judgement is key
            </h2>
          </div>
          <h3 className="text-xl font-semibold text-black">
            Common corrections
          </h3>
          <div className="space-y-4 text-black">
            <div className="flex items-start space-x-3">
              <Check className="mt-1 size-5 shrink-0 text-green-600" />
              <p className="text-base">
                Verify names, pronouns, places, and acronyms.
              </p>
            </div>
            <div className="flex items-start space-x-3">
              <Check className="mt-1 size-5 shrink-0 text-green-600" />
              <p className="text-base">
                Add missing specifics (risk-relevant facts, DOBs).
              </p>
            </div>
            <div className="flex items-start space-x-3">
              <Check className="mt-1 size-5 shrink-0 text-green-600" />
              <p className="text-base">
                Stay under 4,000 characters for NDelius.
              </p>
            </div>
            <div className="flex items-start space-x-3">
              <Check className="mt-1 size-5 shrink-0 text-green-600" />
              <p className="text-base">
                Describe body language, observations and wider context.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
