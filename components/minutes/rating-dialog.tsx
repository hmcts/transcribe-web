/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/label-has-associated-control */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Rating } from "@/components/ui/rating";
import { Textarea } from "@/components/ui/textarea";

interface RatingDialogProps {
  rating: number | null;
  comment: string | null;
  onSubmit: (rating: number, comment: string | null) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

function RatingDialog({
  rating,
  comment,
  onSubmit,
  isOpen,
  onOpenChange,
}: RatingDialogProps) {
  const [localRating, setLocalRating] = useState(rating);
  const [localComment, setLocalComment] = useState(comment);

  // Reset local state when dialog closes without submission
  useEffect(() => {
    if (!isOpen) {
      setLocalRating(rating);
      setLocalComment(comment);
    }
  }, [isOpen, rating, comment]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <div
          className="flex items-center gap-2 text-neutral-600 dark:text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
          onClick={() => onOpenChange(true)}
        >
          <span className="text-sm">Rate summary</span>
          <div className="flex items-center gap-1">
            <Rating
              value={localRating}
              onChange={(value) => setLocalRating(value)}
              className="size-8 text-yellow-400 dark:text-yellow-500"
            />
          </div>
        </div>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            Rate summary
          </DialogTitle>
          <DialogDescription className="text-center text-neutral-600 dark:text-neutral-400">
            Your feedback helps us improve our AI summaries. We read every
            single response! 🙏
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6 py-4">
          <div className="flex flex-col items-center gap-3">
            <Rating
              value={localRating}
              onChange={(value) => setLocalRating(value)}
              className="size-12 text-yellow-400 dark:text-yellow-500"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="feedback-textarea"
              className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Any specific feedback? (Optional)
            </label>
            <Textarea
              id="feedback-textarea"
              value={localComment ?? ""}
              onChange={(e) => setLocalComment(e.target.value)}
              className="min-h-[100px] resize-none"
            />
          </div>
          <Button
            onClick={() => {
              if (localRating !== null) {
                onSubmit(localRating, localComment);
                onOpenChange(false); // Close dialog after submission
              }
            }}
            className="w-full bg-indigo-600 dark:bg-indigo-700 text-white transition-all hover:bg-indigo-700 dark:hover:bg-indigo-800 disabled:opacity-50"
            disabled={!localRating}
          >
            {localRating ? "Submit Feedback" : "Select a Rating"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default RatingDialog;
