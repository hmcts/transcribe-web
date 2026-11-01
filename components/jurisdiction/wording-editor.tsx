"use client";

import { Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchJurisdictionWording,
  type JurisdictionWording,
  saveJurisdictionWording,
} from "@/lib/jurisdiction-api";
import { type WordingKey, wordingFor } from "@/lib/jurisdiction-wording";
import { useJurisdiction } from "@/providers/jurisdiction";

/**
 * A jurisdiction's own admins change its screen wording (DIAAT-356): the
 * jurisdiction this tab works in, and no other. The API refuses anyone else.
 */

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";

export function JurisdictionWordingEditor() {
  const { current } = useJurisdiction();
  const isAdmin = current?.role === "admin";
  const [loaded, setLoaded] = useState<JurisdictionWording | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchJurisdictionWording();
      setLoaded(data);
      setDraft({ ...data.wording });
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  async function save() {
    setSaving(true);
    try {
      // `loaded` is set before the form shows, so a save always names its version.
      const saved = await saveJurisdictionWording(draft, loaded?.version ?? "");
      setLoaded(saved);
      setDraft({ ...saved.wording });
      toast.success(
        `Saved. Everyone in ${saved.code}, you included, sees the new wording when they next load a page.`
      );
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container max-w-3xl space-y-6 py-6 md:py-10">
      <h1 className="text-3xl font-bold">
        {current ? `${current.name} wording` : "Jurisdiction wording"}
      </h1>
      {!isAdmin ? (
        <p className="text-muted-foreground">
          Only an admin for {current?.code ?? "this jurisdiction"} can change its
          wording.
        </p>
      ) : error ? (
        <div className="space-y-4">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : !loaded ? (
        <div role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">Loading the wording</span>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="text-muted-foreground">
            What judges in {loaded.code} see. Leave a line blank to use the
            standard text, shown in grey.
          </p>
          {Object.entries(loaded.keys).map(([key, description]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`wording-${key}`}>{description}</Label>
              <Input
                id={`wording-${key}`}
                value={draft[key] ?? ""}
                placeholder={wordingFor(undefined, key as WordingKey)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [key]: e.target.value }))
                }
                maxLength={500}
              />
            </div>
          ))}
          <Button type="submit" disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Save wording
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="ml-2"
            disabled={saving}
            onClick={() => void load()}
          >
            Discard changes
          </Button>
        </form>
      )}
    </div>
  );
}
