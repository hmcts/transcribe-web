import Link from "next/link";
import { Button } from "@/components/ui/button";
import cn from "@/lib/utils";

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

export function ContactSupport({ className }: { className?: string }) {
  return (
    <section
      className={cn(
        "mt-8 rounded-lg border border-neutral-200 bg-neutral-50 p-6 dark:border-neutral-800 dark:bg-neutral-900",
        className
      )}
    >
      <h2 className="text-lg font-semibold">Need support?</h2>
      <p className="mb-4 text-muted-foreground">
        For any technical issues, questions, or feedback about Judicial
        Transcribe, please contact us.
      </p>
      <div className="flex flex-wrap gap-3">
        <ContactSupportButton />
      </div>
    </section>
  );
}
