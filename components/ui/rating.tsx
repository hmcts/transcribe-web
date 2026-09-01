/* eslint-disable react/require-default-props */
/* eslint-disable react/react-in-jsx-scope */
/* eslint-disable import/prefer-default-export */
import { Star } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface RatingProps {
  value: number | null;
  onChange: (value: number) => void;
  className?: string;
  readonly?: boolean;
}

export function Rating({
  value,
  onChange,
  className,
  readonly = false,
}: RatingProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  return (
    <div
      className="flex items-center gap-0.5"
      onMouseLeave={() => setHoverValue(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            "w-6 h-6 transition-all duration-150",
            !readonly && "cursor-pointer hover:scale-110",
            star <= (hoverValue || value || 0)
              ? "fill-current text-yellow-400"
              : "fill-none text-gray-300 hover:text-gray-400",
            className
          )}
          onClick={() => !readonly && onChange(star)}
          onMouseEnter={() => !readonly && setHoverValue(star)}
        />
      ))}
      {value && !readonly && (
        <span className="ml-1.5 text-sm font-medium text-gray-600">
          {value}/5
        </span>
      )}
    </div>
  );
}
