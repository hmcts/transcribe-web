"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  type FeatureFlag,
  fetchFeatureFlags,
  setFeatureFlag,
} from "@/lib/admin-feature-flags-api";
import { errorMessage } from "@/lib/admin-request";
import { useRuntimeFlags } from "@/providers/runtime-flags";

/**
 * Admin > Feature flags (DIAAT-392; `feature_flags.manage`): the system-wide
 * switches, each with what it does. A change is stored and audited by the API,
 * and reaches everyone's screens the next time they load the flags, with no
 * redeploy.
 */

function formatTime(timestamp: string | null): string {
  if (!timestamp) return "";
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime())
    ? timestamp
    : parsed.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function FeatureFlagsPanel() {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const { reload } = useRuntimeFlags();

  const load = useCallback(async () => {
    setError(null);
    try {
      setFlags(await fetchFeatureFlags());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(flag: FeatureFlag, value: boolean) {
    setSaving(flag.name);
    try {
      setFlags(await setFeatureFlag(flag.name, value));
      toast.success(`${flag.name} is now ${value ? "on" : "off"}`);
      void reload();
    } catch (err) {
      // The switch stays where the API has it.
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Feature flags</h2>
        <p className="text-sm text-muted-foreground">
          Switches for the whole service. A change applies without a new release,
          and reaches people the next time their page loads.
        </p>
      </div>
      {error ? (
        <div role="alert" className="py-4 text-destructive">
          <p>{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : flags === null ? (
        <div className="flex justify-center py-8" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">Loading flags</span>
        </div>
      ) : flags.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">There are no flags.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {flags.map((flag) => {
            const labelId = `flag-${flag.name}`;
            return (
              <li key={flag.name} className="flex items-start justify-between gap-4 p-4">
                <div className="space-y-1">
                  <p id={labelId} className="font-medium">
                    {flag.name}
                  </p>
                  <p className="text-sm text-muted-foreground">{flag.description}</p>
                  {flag.updated_at && (
                    <p className="text-xs text-muted-foreground">
                      Last changed {formatTime(flag.updated_at)}
                      {flag.updated_by ? ` by ${flag.updated_by}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{flag.value ? "On" : "Off"}</span>
                  <Switch
                    aria-labelledby={labelId}
                    checked={flag.value}
                    disabled={saving !== null}
                    onCheckedChange={(value) => void toggle(flag, value)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
