/**
 * The two role values the Admin screens must name (authz contract, section 3).
 *
 * Everything else about roles comes from the API: what a caller may assign is
 * `GET /api/admin/roles`, what a user holds is in the lists the API returns, and
 * what the UI shows is decided by permissions. These two are the roles the
 * Jurisdictions screen and the Super administrators screen are about, and those
 * screens have to say which role they assign, because the API lists roles and
 * tells the web nothing about which one is which.
 *
 * This is not an authorisation decision: the API enforces who may assign what
 * (403 `assignment_not_allowed`), and the screens are shown by permission
 * (`jurisdiction_admin.assign`, `jurisdiction_super_admin.assign`). It is the web's
 * second list of role values, beside lib/access/requestable-roles.ts, and goes
 * away if the API ever labels the roles it returns.
 */

/** Assigned per jurisdiction, from the Jurisdictions screen. */
export const JURISDICTION_ADMINISTRATOR = "JurisdictionAdministrator";

/** Global (no jurisdiction), from the Super administrators screen. */
export const JURISDICTION_SUPER_ADMINISTRATOR =
  "JurisdictionSuperAdministrator";
