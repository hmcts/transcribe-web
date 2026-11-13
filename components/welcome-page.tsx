/* eslint-disable react/button-has-type */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */

"use client";

import { FileAudio, Mic, Shield } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DECISIONS_HREF, HEARING_RECORDINGS_HREF } from "@/lib/navigation";
import { getFullNameFromEmail } from "@/lib/utils";
import { useAccess } from "@/providers/access";
import { useJurisdiction } from "@/providers/jurisdiction";
import { useDictationEnabled } from "@/providers/runtime-flags";
import { useUserSettings } from "@/providers/user-settings";

function ContactSupportButton() {
  return (
    <Button asChild variant="default">
      <Link
        href="mailto:JudicialTranscribe@justice.gov.uk"
        aria-label="Contact us via email"
      >
        Contact us
      </Link>
    </Button>
  );
}

function WelcomePage() {
  const { user } = useUserSettings();
  const { hasHearingRecordings, wording } = useJurisdiction();
  // DIAAT-373: what the home page offers follows the active context's
  // permissions, never a role name.
  const { can } = useAccess();

  // DIAAT-392: the runtime flag, else the deploy-time default.
  const dictationEnabled = useDictationEnabled();
  const showDecisions = dictationEnabled && can("dictation.use");
  const showRecordings = can("recording.own") && hasHearingRecordings;
  const showAdmin = can("admin.access");

  const displayName = user?.email ? getFullNameFromEmail(user.email) : "";
  const heading = displayName ? `Welcome back, ${displayName}` : "Welcome back";

  return (
    <div className="relative mx-auto max-w-[1280px] px-4 sm:px-6">
      <div className="absolute left-1/2 right-1/2 top-0 -z-10 -ml-[50vw] -mr-[50vw] h-[28rem] bg-muted/60" />
      <section className="flex flex-col gap-4 pb-36 pt-24 text-foreground">
        <h1 className="text-5xl font-bold tracking-tight">{heading}</h1>
        <p className="text-muted-foreground prose">{wording("home.intro")}</p>

        {(showDecisions || showRecordings || showAdmin) && (
          <div className="flex flex-col gap-4 mt-12 md:flex-row">
            {showDecisions && (
              <Button
                asChild
                className="flex w-full items-center justify-center gap-2 py-6 text-lg md:w-auto"
              >
                <Link href={DECISIONS_HREF}>
                  <Mic className="size-5" />
                  Decisions
                </Link>
              </Button>
            )}
            {showRecordings && (
              <Button
                asChild
                variant="outline"
                className="flex w-full items-center justify-center gap-2 py-6 text-lg md:w-auto"
              >
                <Link href={HEARING_RECORDINGS_HREF}>
                  <FileAudio className="size-5" />
                  {wording("nav.recordings")}
                </Link>
              </Button>
            )}
            {showAdmin && (
              <Button
                asChild
                variant="outline"
                className="flex w-full items-center justify-center gap-2 py-6 text-lg md:w-auto"
              >
                <Link href="/admin">
                  <Shield className="size-5" />
                  Admin
                </Link>
              </Button>
            )}
          </div>
        )}
      </section>

      <section
        className="mb-20 mt-16 rounded-lg border border-border bg-card p-6"
        aria-labelledby="support-heading"
      >
        <h2
          id="support-heading"
          className="mb-2 text-2xl font-bold text-card-foreground"
        >
          Technical Support
        </h2>
        <p className="mb-4 text-muted-foreground">
          For technical queries, bug reports, or feature requests, please
          contact us directly.
        </p>
        <ContactSupportButton />
      </section>
    </div>
  );
}

export default WelcomePage;
