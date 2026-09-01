import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ContactSupport } from "@/components/help/contact-support";
import { MultistepTutorial } from "@/components/help/multistep-tutorial";
import { TableOfContents } from "@/components/help/table-of-contents";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
            Getting started with Judicial Transcribe
          </h1>
          <p className="mx-auto max-w-2xl text-xl text-muted-foreground">
            Getting started with Judicial Transcribe for the First-tier Tribunal
            Immigration and Asylum Chamber
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
            <p>
              Judicial Transcribe is an advanced AI-powered tool designed to
              support judicial work by providing accurate live transcription of
              oral decisions and accurately transcribing arguments presented
              orally at Tribunal hearings. By capturing both hearings and
              determinations in real time, the tool significantly reduces the
              need for manual note-taking, allowing judges to focus on the
              substance of proceedings and engage with the parties.
            </p>
            <p>
              This tool is designed to allow for integration with other
              supporting products reducing the administrative elements of
              decision preparation.
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

            <ContactSupport className="mb-20 [&_h2]:m-0" />

            {/* Quick Start Guide */}
            <section
              className="pb-20 [&_h4]:mt-2 [&_ol]:my-0 [&_li]:my-0"
              aria-labelledby="quick-start-heading"
            >
              <h2 id="quick-start">Quick Start Guide</h2>
              <MultistepTutorial />
            </section>

            <h2 id="features-overview">Features overview</h2>
            <h3 id="hearing-details-form">Hearing Details Form</h3>
            <p className="mb-3">
              The form captures essential information for your decision
              document:
            </p>
            <div className="w-full overflow-x-auto">
              <table
                className={cn(
                  "w-full min-w-[560px] text-sm",
                  "[&_th]:py-3 [&_th]:px-4 [&_th]:font-semibold [&_th]:text-left",
                  "[&_td]:py-3 [&_td]:px-4 [&_td]:font-medium [&_td]:text-muted-foreground",
                  "[&_tbody_tr]:border-b [&_thead_tr]:border-b-[3px]",
                  "[&_tr:nth-child(even)]:bg-foreground/[2.5%]"
                )}
              >
                <thead>
                  <tr>
                    <th className="py-3 pr-4 text-left font-semibold">Field</th>
                    <th className="py-3 text-left font-semibold">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Jurisdiction</td>
                    <td className="py-3 text-muted-foreground">
                      Pre-set to First-tier Tribunal Immigration and Asylum
                      Chamber.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Hearing date</td>
                    <td className="py-3 text-muted-foreground">
                      Defaults to today&apos;s date; can be changed if needed.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Judge name</td>
                    <td className="py-3 text-muted-foreground">
                      Pre-populated from your account details with
                      &quot;Judge&quot; prefix displayed.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Case number</td>
                    <td className="py-3 text-muted-foreground">
                      The appeal reference number.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Hearing location</td>
                    <td className="py-3 text-muted-foreground">
                      Select from the list of tribunal centres, or choose
                      &quot;Other&quot; to specify a different location.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Hearing type</td>
                    <td className="py-3 text-muted-foreground">
                      Face to face, CVP, decision on papers, or other.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">
                      Appellant and respondent details
                    </td>
                    <td className="py-3 text-muted-foreground">
                      Names and representatives (required for face-to-face and
                      CVP hearings).
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Legal issues</td>
                    <td className="py-3 text-muted-foreground">
                      Select all relevant legal frameworks for the case.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Anonymity order</td>
                    <td className="py-3 text-muted-foreground">
                      Indicate whether an anonymity order was granted, refused,
                      or not sought.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 id="live-transcription">Live Transcription</h3>
            <p>
              Speech is converted to text in real-time. The first speaker is
              labelled as &quot;Judge&quot;. Use the section tabs to organise
              your dictation into Background, Evidence, and Facts. Recording
              auto-saves locally and can be paused and resumed at any time.
            </p>

            <h3 id="document-generation">Document Generation</h3>
            <p>
              Submitting a hearing generates a Word document using the official
              decision template. Form data, dates (in long format), and legal
              framework content are automatically populated. Documents are
              available for download for 24 hours.
            </p>

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
