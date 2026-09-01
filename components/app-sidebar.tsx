"use client";

import { Gavel, Plus, Scale, Shield } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

import type { DocumentContent } from "@/lib/admin-api";

type Category = "hearing-types" | "legal-frameworks" | "anonymity";

export type Selection = {
  category: Category;
  id: string;
  isNew?: boolean;
};

type SearchResult = {
  id: string;
  label: string;
  category: Category;
};

const SECTIONS: {
  key: Category;
  label: string;
  icon: typeof Gavel;
}[] = [
  { key: "hearing-types", label: "Hearing Types", icon: Gavel },
  { key: "legal-frameworks", label: "Legal Frameworks", icon: Scale },
  { key: "anonymity", label: "Anonymity", icon: Shield },
];

function getItems(content: DocumentContent, key: Category) {
  if (key === "hearing-types") {
    return content.hearing_types.map((h) => ({ id: h.id, label: h.title }));
  }
  if (key === "legal-frameworks") {
    return content.legal_frameworks.map((f) => ({ id: f.id, label: f.title }));
  }
  return content.anonymity.statuses.map((a) => ({ id: a.id, label: a.title }));
}

function getCategoryLabel(category: Category): string {
  if (category === "hearing-types") return "Hearing Types";
  if (category === "legal-frameworks") return "Legal Frameworks";
  return "Anonymity";
}

export function AppSidebar({
  documentContent,
  selection,
  onItemSelect,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  documentContent: DocumentContent;
  selection: Selection | null;
  onItemSelect: (sel: Selection) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const searchResults = useMemo<SearchResult[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    return SECTIONS.flatMap((section) =>
      getItems(documentContent, section.key)
        .filter((item) => item.label.toLowerCase().includes(query))
        .map((item) => ({
          id: item.id,
          label: item.label,
          category: section.key,
        }))
    );
  }, [documentContent, searchQuery]);

  const resultsByCategory = useMemo(() => {
    const grouped: Record<Category, SearchResult[]> = {
      "hearing-types": [],
      "legal-frameworks": [],
      anonymity: [],
    };

    for (const result of searchResults) {
      grouped[result.category].push(result);
    }
    return grouped;
  }, [searchResults]);

  const handleSearchSelect = (result: SearchResult) => {
    onItemSelect({
      category: result.category,
      id: result.id,
    });
    setSearchQuery("");
  };

  return (
    <Sidebar collapsible="none" {...props}>
      <SidebarHeader className="p-4">
        <SidebarMenu className="p-2">
          <SidebarMenuItem className="">
            <span className="font-semibold">Legal Text Management</span>
          </SidebarMenuItem>
        </SidebarMenu>

        <Command
          className="overflow-hidden rounded-lg border bg-background"
          shouldFilter={false}
        >
          <CommandInput
            placeholder="Search legal text..."
            aria-label="Search legal text"
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          {searchQuery.trim() && (
            <CommandList className="max-h-56">
              <CommandEmpty>No matching section found.</CommandEmpty>
              {SECTIONS.map((section) => {
                const sectionResults = resultsByCategory[section.key];
                if (sectionResults.length === 0) return null;
                return (
                  <CommandGroup
                    key={`search-${section.key}`}
                    heading={getCategoryLabel(section.key)}
                  >
                    {sectionResults.map((result) => (
                      <CommandItem
                        key={`${result.category}-${result.id}`}
                        value={`${result.label} ${getCategoryLabel(result.category)}`}
                        onSelect={() => handleSearchSelect(result)}
                      >
                        {result.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
          )}
        </Command>
      </SidebarHeader>

      <SidebarSeparator className="my-4" />

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {SECTIONS.map((section) => {
              const items = getItems(documentContent, section.key);
              const Icon = section.icon;
              const canAdd =
                section.key === "hearing-types" ||
                section.key === "legal-frameworks";

              return (
                <SidebarMenuItem key={section.key}>
                  <SidebarMenuButton className="font-medium">
                    <Icon className="size-4" />
                    {section.label}
                  </SidebarMenuButton>
                  <SidebarMenuSub>
                    {items.map((item) => (
                      <SidebarMenuSubItem key={item.id}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={
                            selection?.category === section.key &&
                            selection.id === item.id
                          }
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onItemSelect({
                                category: section.key,
                                id: item.id,
                              })
                            }
                          >
                            {item.label}
                          </button>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                    {canAdd && (
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <button
                            type="button"
                            onClick={() =>
                              onItemSelect({
                                category: section.key,
                                id: `__new_${Date.now()}`,
                                isNew: true,
                              })
                            }
                            className="text-sidebar-foreground/50"
                          >
                            <Plus className="size-3" />
                            Add{" "}
                            {section.key === "hearing-types"
                              ? "hearing type"
                              : "framework"}
                          </button>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    )}
                  </SidebarMenuSub>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
