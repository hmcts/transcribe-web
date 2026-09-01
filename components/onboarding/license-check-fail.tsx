import { useState } from "react";
import { Button } from "@/components/ui/button";

interface LicenseCheckFailProps {
  onRetry?: () => void;
}

export default function LicenseCheckFail({ onRetry }: LicenseCheckFailProps) {
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSignUp = () => {
    window.open(
      "https://forms.office.com/Pages/ResponsePage.aspx?id=KEeHxuZx_kGp4S6MNndq2EiI1IAZnLFNv6xx2eNp-M5UNFE4STRRN1M5QUdZV05aUkVTOVBIOE9CMy4u",
      "_blank"
    );
    setIsSubmitted(true);
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      // Fallback: reload the page
      window.location.reload();
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 text-center">
      <div className="space-y-6">
        <h2 className="text-3xl font-bold text-gray-900">
          Sorry, Judicial Transcribe will be coming soon! 🚀
        </h2>

        <div className="space-y-4">
          <p className="text-lg leading-relaxed text-gray-700">
            To support our rollout, we&apos;re doing a phased allocation of
            licenses.
          </p>

          <p className="text-lg leading-relaxed text-gray-700">
            If you want early access, click below to complete our application
            form.
          </p>
        </div>
      </div>

      <div className="space-y-4 pt-4">
        <Button
          onClick={handleSignUp}
          disabled={isSubmitted}
          className={`px-8 py-6 text-lg font-semibold transition-all ${
            isSubmitted
              ? "cursor-default bg-green-900 text-white hover:bg-green-900"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {isSubmitted ? "You've signed up" : "Join the waiting list"}
        </Button>

        <div className="text-sm text-gray-500">
          <p>Having trouble? Try refreshing or check your connection.</p>
          <Button
            onClick={handleRetry}
            variant="outline"
            className="mt-2 px-4 py-2 text-sm"
          >
            Retry License Check
          </Button>
        </div>
      </div>
    </div>
  );
}

LicenseCheckFail.defaultProps = {
  onRetry: undefined,
};
