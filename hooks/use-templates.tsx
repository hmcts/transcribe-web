import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { TemplateMetadata } from "@/src/api/generated";

export default function useTemplates() {
  const [templates, setTemplates] = useState<TemplateMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        setIsLoading(true);
        const result = await apiClient.getTemplates();

        if (result.error) {
          throw new Error("Failed to fetch templates");
        }

        const { data } = result;
        if (data) {
          setTemplates(data.templates);
        }
      } catch (err) {
        console.error("Error fetching templates:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    }

    fetchTemplates();
  }, []);

  return { templates, isLoading, error };
}
