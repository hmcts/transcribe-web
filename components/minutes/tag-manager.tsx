"use client";

import { Plus, Tag as TagIcon, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  addTagToTranscription,
  getAllTranscriptionMetadata,
  getTranscriptionTags,
  removeTagFromTranscription,
  type Tag,
} from "@/lib/database";

interface TagManagerProps {
  transcriptionId: string;
}

export default function TagManager({ transcriptionId }: TagManagerProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const loadTags = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedTags = await getTranscriptionTags(transcriptionId);
      setTags(loadedTags);
    } catch (error) {
      console.error("Error loading tags:", error);
    } finally {
      setIsLoading(false);
    }
  }, [transcriptionId]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const handleAddTag = async () => {
    if (!newTagName.trim()) {
      setIsAddingTag(false);
      setNewTagName("");
      return;
    }

    try {
      const normalizedName = newTagName.trim().toLowerCase();
      await addTagToTranscription(transcriptionId, normalizedName);
      setNewTagName("");
      setIsAddingTag(false);
      await loadTags();
      // Refresh metadata to update tags in the list
      await getAllTranscriptionMetadata();
    } catch (error) {
      console.error("Error adding tag:", error);
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    try {
      await removeTagFromTranscription(transcriptionId, tagName);
      await loadTags();
      // Refresh metadata to update tags in the list
      await getAllTranscriptionMetadata();
    } catch (error) {
      console.error("Error removing tag:", error);
    }
  };

  if (isLoading) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <TagIcon className="size-4 text-muted-foreground" />
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="group inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
          >
            <span>{tag.name}</span>
            <button
              type="button"
              onClick={() => handleRemoveTag(tag.name)}
              className="opacity-0 transition-opacity hover:text-blue-600 group-hover:opacity-100 dark:hover:text-blue-200"
              aria-label={`Remove tag ${tag.name}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {isAddingTag ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              className="h-6 w-24 rounded-full bg-muted px-2.5 py-0.5 text-xs"
              aria-label="New tag name"
              placeholder="Tag name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAddTag();
                } else if (e.key === "Escape") {
                  setIsAddingTag(false);
                  setNewTagName("");
                }
              }}
              onBlur={handleAddTag}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsAddingTag(true)}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium hover:bg-muted/80"
          >
            <Plus className="size-3" />
            <span>Add tag</span>
          </button>
        )}
      </div>
    </div>
  );
}
