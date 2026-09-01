import { htmlToText } from "html-to-text";
import { Copy } from "lucide-react";
import { useState } from "react";
import { track } from "@/lib/analytics";

export interface DownloadStyleCopyButtonProps {
  textToCopy: string;
  posthogEventName: string;
  onCopy: () => void;
}

export default function DownloadStyleCopyButton({
  textToCopy,
  posthogEventName,
  onCopy,
}: DownloadStyleCopyButtonProps) {
  const [showCopied, setShowCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const plainText = htmlToText(textToCopy, {
        wordwrap: false,
        selectors: [{ selector: "a", options: { ignoreHref: true } }],
      });

      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([textToCopy], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
    } catch (_err) {
      // Fallback for browsers that don't support ClipboardItem API
      await navigator.clipboard.writeText(
        htmlToText(textToCopy, { wordwrap: false })
      );
    }

    track(posthogEventName, {
      contentLength: textToCopy.length,
    });

    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);

    if (onCopy) onCopy();
  };

  return (
    <button
      className={`flex items-center justify-center gap-2
                rounded-md px-4 py-2 text-white
                shadow-sm transition-all duration-200
                ${showCopied ? "bg-green-600" : "bg-green-700 hover:bg-green-800"}`}
      onClick={handleCopy}
      title="Copy content"
      type="button"
    >
      <Copy className="size-5 md:mr-2" />
      <span className="hidden md:inline">
        {showCopied ? "Copied!" : "Copy"}
      </span>
    </button>
  );
}
