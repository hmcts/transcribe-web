import { Plus } from "lucide-react";
/* eslint-disable react/require-default-props */
import React from "react";
import { Button } from "@/components/ui/button";

interface StartNewRecordingButtonProps {
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  size?: "default" | "large";
  fullWidth?: boolean;
  disabled?: boolean;
  showIcon?: boolean;
}

const StartNewRecordingButton = React.forwardRef<
  HTMLButtonElement,
  StartNewRecordingButtonProps
>(
  (
    {
      onClick,
      className = "",
      size = "default",
      fullWidth = true,
      disabled = false,
      showIcon = true,
      ...props
    },
    ref
  ) => {
    const baseClasses =
      "bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-2";
    const sizeClasses = size === "large" ? "py-6 text-lg" : "py-2";
    const widthClasses = fullWidth ? "w-full" : "";

    return (
      <Button
        ref={ref}
        onClick={onClick}
        disabled={disabled}
        className={`${baseClasses} ${sizeClasses} ${widthClasses} ${className}`}
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...props}
      >
        {showIcon && (
          <Plus className={size === "large" ? "size-5" : "mr-2 size-4"} />
        )}
        Go to recording
      </Button>
    );
  }
);

StartNewRecordingButton.displayName = "StartNewRecordingButton";

export default StartNewRecordingButton;
