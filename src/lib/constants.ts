// Its own name, not the main app's "session_token": browsers don't separate
// cookies by port, so with both apps on localhost a login to one replaced the
// other's session (and onboarding then saw a regular user: "אין הרשאה").
export const SESSION_COOKIE = "onboarding_session_token";
