import Link from "next/link";
import { SUPPORT_EMAIL } from "@/components/help/contact-support";
import { Button } from "@/components/ui/button";

/**
 * Shown, and nothing else, to a signed-in user who belongs to no jurisdiction
 * (DIAAT-330). Placeholder wording until the product team agrees it; asking for
 * access from this screen comes with the admin area (DIAAT-328).
 */
export default function NoJurisdiction() {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 sm:px-6"
    >
      <h1 className="text-3xl font-bold">
        You do not have access to Bench Notes yet
      </h1>
      <p className="text-lg text-muted-foreground">
        You have signed in, but you have not been added to a jurisdiction.
      </p>
      <p className="text-lg text-muted-foreground">
        To ask for access, email the Bench Notes team. Tell them your name and
        which jurisdiction you sit in.
      </p>
      <div>
        <Button asChild>
          <Link
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Bench Notes access")}`}
          >
            Email {SUPPORT_EMAIL}
          </Link>
        </Button>
      </div>
    </main>
  );
}
