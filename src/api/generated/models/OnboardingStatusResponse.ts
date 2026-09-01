/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Response model for user onboarding status and allowlist check.
 *
 * This model contains all the information needed by the frontend to determine
 * the user's access level and what UI to display.
 *
 * Attributes
 * ----------
 * has_completed_onboarding : bool
 * Whether the user has completed the onboarding process.
 * force_onboarding_override : bool
 * Whether onboarding is being forced in development mode.
 * should_show_onboarding : bool
 * Whether the onboarding UI should be displayed to the user.
 * user_id : uuid.UUID
 * Unique identifier for the user.
 * environment : str
 * Current environment (local, dev, prod, etc.).
 * is_allowlisted : bool
 * Whether the user's email is in the allowlist.
 * should_show_coming_soon : bool
 * Whether the "coming soon" page should be displayed instead of the app.
 */
export type OnboardingStatusResponse = {
  has_completed_onboarding: boolean;
  force_onboarding_override: boolean;
  should_show_onboarding: boolean;
  user_id: string;
  environment: string;
  is_allowlisted: boolean;
  should_show_coming_soon: boolean;
};
