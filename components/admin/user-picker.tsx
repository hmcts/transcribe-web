"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AdminUser, fetchAdminUsers } from "@/lib/admin-users-api";

/**
 * Who a role goes to (DIAAT-385): type a sign-in email, or pick someone from the
 * people who have already signed in (the API searches by email, and offers every
 * such person, whether or not they asked for access). A typed email that matches
 * nobody becomes a pending assignment, claimed at that person's first sign-in.
 */

export interface PickedUser {
  /** Set when a signed-in user was chosen from the list. */
  user: AdminUser | null;
  /** What is in the box: the chosen user's email, or the text typed. */
  email: string;
}

export const NOBODY: PickedUser = { user: null, email: "" };

/** The email to send for a typed address, or null if it is not one yet. */
export function typedEmail(picked: PickedUser): string | null {
  const email = picked.email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

export function hasTarget(picked: PickedUser): boolean {
  return picked.user !== null || typedEmail(picked) !== null;
}

/** Whether another suggestion has the same address as `user`. */
function sharedEmail(matches: AdminUser[], user: AdminUser): boolean {
  return matches.some(
    (other) =>
      other.id !== user.id &&
      other.email.toLowerCase() === user.email.toLowerCase()
  );
}

const SEARCH_DELAY_MS = 250;
const MIN_SEARCH_LENGTH = 2;
const SUGGESTIONS = 5;

export function UserPicker({
  id,
  label = "Sign-in email",
  value,
  onChange,
  disabled,
}: {
  id: string;
  label?: string;
  value: PickedUser;
  onChange: (next: PickedUser) => void;
  disabled?: boolean;
}) {
  const [matches, setMatches] = useState<AdminUser[]>([]);
  const [searched, setSearched] = useState(false);
  const typed = value.email.trim();
  const picked = value.user !== null;

  useEffect(() => {
    if (picked || typed.length < MIN_SEARCH_LENGTH) {
      setMatches([]);
      setSearched(false);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      fetchAdminUsers({ search: typed, pageSize: SUGGESTIONS })
        .then((page) => {
          if (!current) return;
          setMatches(page.items.filter((u) => !u.pending));
          setSearched(true);
        })
        .catch(() => {
          if (!current) return;
          // Not being able to search must not stop an email being typed.
          setMatches([]);
          setSearched(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [typed, picked]);

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="email"
          autoComplete="off"
          value={value.email}
          readOnly={picked}
          disabled={disabled}
          onChange={(e) => onChange({ user: null, email: e.target.value })}
          placeholder="first.last@justice.gov.uk"
          className="w-72"
          aria-describedby={`${id}-hint`}
        />
        {picked && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(NOBODY)}
            disabled={disabled}
          >
            Change
          </Button>
        )}
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {picked
          ? "Signed in before. Their roles apply to them now."
          : "People who have signed in appear as you type. Anyone else is added by email and gets the roles when they first sign in."}
      </p>
      {!picked && matches.length > 0 && (
        <ul
          aria-label="People who have signed in"
          className="w-72 rounded-md border bg-background text-sm"
        >
          {matches.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted"
                onClick={() => onChange({ user, email: user.email })}
              >
                <span>{user.email}</span>
                {(user.name || sharedEmail(matches, user)) && (
                  <span className="text-xs text-muted-foreground">
                    {user.name}
                    {sharedEmail(matches, user) &&
                      // Two accounts with one address (API: 409 `ambiguous_email`
                      // when assigned by email): tell them apart.
                      `${user.name ? ", " : ""}account ending ${user.id.slice(-4)}`}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!picked && searched && matches.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nobody who has signed in matches. A full email is added as pending.
        </p>
      )}
    </div>
  );
}
