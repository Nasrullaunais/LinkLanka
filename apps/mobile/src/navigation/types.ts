/**
 * Central type definitions for React Navigation stacks/tabs.
 *
 * Adding param lists here gives us strong typing on
 * `navigation.navigate()`, `route.params`, etc. throughout the app.
 */

// ── Auth Stack (unauthenticated) ─────────────────────────────────────────────
export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

// ── Main Tab Navigator (authenticated, home screen) ──────────────────────────
export type MainTabParamList = {
  Chats: undefined;
  Documents: undefined;
};

// ── App Stack (wraps tabs + full-screen routes like ChatScreen) ───────────────
export type AppStackParamList = {
  HomeTabs: undefined;
  /** groupName: display name to show in the header.
   *   - For DMs this is the OTHER participant's displayName.
   *   - For groups this is the group's name.
   * isDm: true when this is a 1-to-1 direct conversation.
   * preferredLanguage: initial per-conversation language preference (null = use native dialect).
   */
  Chat: {
    groupId: string;
    groupName: string;
    isDm?: boolean;
    preferredLanguage?: string | null;
    otherUserPicture?: string | null;
    /** ID of the other participant in a DM — used to navigate to PersonInfo. */
    otherUserId?: string | null;
  };
  CreateGroup: undefined;
  Profile: undefined;
  PersonalDictionary: undefined;
  GroupInfo: { groupId: string; groupName: string };
  PersonInfo: { userId: string; displayName: string; profilePictureUrl?: string | null };
};
