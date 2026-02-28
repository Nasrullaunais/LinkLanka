/**
 * Personal Context / "My Dictionary" API service.
 *
 * Kept in a separate file from api.ts so that the team member
 * working on this feature can iterate without merge conflicts.
 */
import apiClient from './api';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersonalContextItem {
  id: string;
  userId: string;
  slangWord: string;
  standardMeaning: string;
  dialectType: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalContextCount {
  count: number;
  max: number;
}

// ── API calls ────────────────────────────────────────────────────────────────

/** Fetch all dictionary entries for the currently authenticated user. */
export async function fetchPersonalContext(): Promise<PersonalContextItem[]> {
  const { data } = await apiClient.get<PersonalContextItem[]>(
    '/personal-context',
  );
  return data;
}

/** Get the current count and maximum allowed entries. */
export async function fetchPersonalContextCount(): Promise<PersonalContextCount> {
  const { data } = await apiClient.get<PersonalContextCount>(
    '/personal-context/count',
  );
  return data;
}

/** Add a new word to the personal dictionary. */
export async function addPersonalContext(
  slangWord: string,
  standardMeaning: string,
  dialectType?: string,
): Promise<PersonalContextItem> {
  const { data } = await apiClient.post<PersonalContextItem>(
    '/personal-context',
    { slangWord, standardMeaning, dialectType },
  );
  return data;
}

/** Update the meaning and/or dialect of an existing entry. */
export async function updatePersonalContext(
  id: string,
  standardMeaning?: string,
  dialectType?: string | null,
): Promise<PersonalContextItem> {
  const { data } = await apiClient.patch<PersonalContextItem>(
    `/personal-context/${id}`,
    { standardMeaning, dialectType },
  );
  return data;
}

/** Delete a dictionary entry. */
export async function deletePersonalContext(id: string): Promise<void> {
  await apiClient.delete(`/personal-context/${id}`);
}
