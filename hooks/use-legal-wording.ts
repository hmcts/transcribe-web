import { useCallback, useEffect, useRef, useState } from "react";
import { type DocumentContent, fetchDocumentContent } from "@/lib/admin-api";

/**
 * The legal wording of the jurisdiction `code` (DIAAT-342), loaded as the admin
 * area edits it. Everything it holds is for that jurisdiction: a response for
 * another one (a request that was in flight when `code` changed, or an answer
 * that names a different jurisdiction) is dropped, and a new `code` starts over
 * as loading rather than showing the last one's wording.
 */
export type LegalWordingState =
  | { status: "loading" }
  | { status: "loaded"; content: DocumentContent }
  | { status: "error"; error: unknown };

const LOADING: LegalWordingState = { status: "loading" };

export function useLegalWording(code: string | null) {
  const [result, setResult] = useState<{
    code: string;
    state: LegalWordingState;
  } | null>(null);
  const latest = useRef(0);

  /** `silent`: reload after a save, without the loading state in between. */
  const load = useCallback(
    async (silent = false) => {
      if (!code) return;
      const request = ++latest.current;
      if (!silent) setResult({ code, state: LOADING });
      let state: LegalWordingState;
      try {
        const content = await fetchDocumentContent();
        if (content.jurisdiction && content.jurisdiction.code !== code) {
          throw new Error(
            `The server answered for ${content.jurisdiction.code}, not ${code}, so its wording was not shown.`
          );
        }
        state = { status: "loaded", content };
      } catch (error) {
        state = { status: "error", error };
      }
      if (request === latest.current) setResult({ code, state });
    },
    [code]
  );

  useEffect(() => {
    void load();
    return () => {
      // Whatever is still in flight is for a jurisdiction (or a page) left behind.
      latest.current += 1;
    };
  }, [load]);

  return {
    state: result?.code === code ? result.state : LOADING,
    reload: load,
  };
}
