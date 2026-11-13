/**
 * The roles a user may ask for on the access request form (authz contract,
 * section 3: `POST /api/access-requests` takes only these two; the API answers
 * 400 `role_not_requestable` for any other).
 *
 * This is the web's one list of role values, and it is not an authorisation
 * decision: the values are what the request endpoint accepts, and the API
 * enforces them. It stays here until the API lists them itself.
 */
export interface RequestableRole {
  value: string;
  label: string;
  description: string;
}

export const REQUESTABLE_ROLES: RequestableRole[] = [
  {
    value: "Judge",
    label: "Judge",
    description: "Dictate, record and see your own work",
  },
  {
    value: "LegalTextManager",
    label: "Legal text manager",
    description: "Manage the legal text of documents",
  },
];
