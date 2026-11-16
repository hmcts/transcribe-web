import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ContactSupport } from "@/components/help/contact-support";
import { JurisdictionText } from "@/components/jurisdiction/jurisdiction-content";
import { DictationGuidance } from "@/components/flags/dictation-guidance";
import { TableOfContents } from "@/components/help/table-of-contents";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { DictationOnly } from "@/components/flags/dictation-only";
import { Button } from "@/components/ui/button";
import cn from "@/lib/utils";

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to main content
      </a>
      <main id="main-content" className="container mx-auto max-w-[1280px] px-4 sm:px-6 pt-8">
        {/* Page Header */}
        <section className="py-16 text-center">
          <h1 className="mb-4 text-4xl font-bold tracking-tight">
            Getting started with BenchNotes
          </h1>
          <p className="mx-auto max-w-2xl text-xl text-muted-foreground">
            <JurisdictionText wordingKey="help.subtitle" />
          </p>
        </section>
        {/* Back to home */}
        <Button variant="link" asChild className="mb-4  p-0 h-auto">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors no-underline"
          >
            <ArrowLeft className="size-4" />
            Back to home
          </Link>
        </Button>

        <article
          className={cn(
            "relative lg:grid lg:grid-cols-[1fr_220px] lg:gap-10",
            "prose prose-sm sm:prose-base lg:prose-lg dark:prose-invert max-w-none",
            "[&_ul]:list-none [&_ul]:!pl-0 [&_li]:!pl-0 [&_a]:no-underline"
          )}
        >
          {/* Inline table of contents for mobile/tablet */}
          <section className="mb-8 lg:hidden">
            <TableOfContents contentId="help-content" variant="inline" />
          </section>

          {/* Main content */}
          <section id="help-content" className="max-w-4xl">
            {/* DIAAT-373: the dictation and recording guidance only for a role that uses them. */}
            <DictationGuidance>
            <p>
              BenchNotes supports judicial work with live dictation: speak,
              see your words on screen as you go, edit them, and submit them
              in one of your jurisdiction&apos;s templates, or copy them into
              your own document.
            </p>

            <h2 id="online-training">
              <Link
                href="https://share.articulate.com/uKuDioTE4vVD9RSEEtw8d"
                target="_blank"
                rel="noopener noreferrer"
                className="!underline underline-offset-2 decoration-2 text-primary"
                aria-label="Online training (opens in a new tab)"
              >Online training</Link>
            </h2>
            </DictationGuidance>

            <ContactSupport className="mb-20 [&_h2]:m-0" />

            <DictationGuidance>
            <h2 id="features-overview">Features overview</h2>
            <h3 id="hearing-details-form">Templates and hearing details</h3>
            <p>
              Your jurisdiction&apos;s templates are set up in BenchNotes by its
              administrators. From the home page, select{" "}
              <strong>Decisions</strong>, then <strong>Record a decision</strong>.
              Choose a template under <strong>Hearing details</strong>{" "}
              and answer its questions: some, such as the hearing type, legal
              issues or anonymity, offer your jurisdiction&apos;s own wording.
              Your answers are saved with your dictation as you go.
            </p>

            <DictationOnly>
              <h3 id="live-transcription">Live Transcription</h3>
              <p>
                Speech is converted to text in real-time, and you can edit it
                as you go. When the template has sections (such as Background,
                Evidence and Facts), choose the section you are dictating into
                below the transcript; your notes go into the section whose
                heading they are under. Your dictation, answers and notes are
                saved as you go and can be restored within 24 hours if you
                leave the page.
              </p>

              <h3 id="document-generation">Document Generation</h3>
              <p>
                Submitting a hearing fills the template with your answers and
                your dictation, section by section, and generates a Word
                document. When processing finishes, go to{" "}
                <strong>Decisions</strong> and choose{" "}
                <strong>Download document</strong> for the hearing; documents
                are available for 24 hours.
                With no template, copy your text into your own document
                instead.
              </p>
            </DictationOnly>
            </DictationGuidance>

            <h3 id="privacy">Privacy</h3>
            <p>
              Your recordings are private and only accessible to you. Audio is
              processed then deleted; only transcript text is retained. All data
              is processed within secure Ministry of Justice infrastructure.{" "}
              <Link
                href="/privacy"
                className="!underline underline-offset-2 decoration-2 text-primary"
              >
                View Privacy Policy
              </Link>
            </p>

            <DictationGuidance>
            <h3 id="troubleshooting">Troubleshooting</h3>
            <Accordion type="single" collapsible className="not-prose">
              <AccordionItem value="microphone">
                <AccordionTrigger>Microphone not working</AccordionTrigger>
                <AccordionContent>
                  Check browser permissions and system settings, then refresh
                  the page.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="transcription">
                <AccordionTrigger>Inaccurate transcription</AccordionTrigger>
                <AccordionContent>
                  Speak more slowly and clearly. Technical terms may need manual
                  correction.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            </DictationGuidance>
          </section>

          {/* Table of contents sidebar */}
          <aside className="hidden lg:block">
            <section className="sticky top-20">
              <TableOfContents contentId="help-content" />
            </section>
          </aside>
        </article>

        <section className="pt-8 mb-16">
          <ContactSupport />
        </section>
      </main>
    </div>
  );
}
