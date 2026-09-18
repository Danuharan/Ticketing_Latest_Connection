/** Logged-in user shown in the admin header. Replace via API when backend is connected. */
export interface SessionUser {
  id: string;
  displayName: string;
  initials: string;
  email: string;
}
