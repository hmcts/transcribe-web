import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface AgendaInputProps {
  agenda: string;
  onChange: (value: string) => void;
}

function AgendaInput({ agenda, onChange }: AgendaInputProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="mb-4 space-y-2"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          className="flex w-full items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Plus className="size-4" />
            <span>
              {agenda
                ? "Agenda Attached"
                : "Attach agenda to structure AI summary"}
            </span>
          </div>
          {isOpen ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">
        <Label htmlFor="agenda" className="text-sm text-muted-foreground">
          Enter meeting agenda items below
        </Label>
        <Textarea
          id="agenda"
          placeholder="1. Project Updates&#10;2. Budget Review&#10;3. Action Items"
          className="h-24 resize-none"
          value={agenda}
          onChange={(e) => onChange(e.target.value)}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

export default AgendaInput;
