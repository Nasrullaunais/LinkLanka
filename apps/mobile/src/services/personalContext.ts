/**
 * Personal Context / "My Dictionary" API service.
 *
 * Kept in a separate file from api.ts so that the team member
 * working on this feature can iterate without merge conflicts.
 */
import apiClient, { type DialectTargetLanguage } from './api';

// ── Types ────────────────────────────────────────────────────────────────────

export type PersonalContextDialect = DialectTargetLanguage;

export const PERSONAL_CONTEXT_DIALECTS: PersonalContextDialect[] = [
  'singlish',
  'english',
  'tanglish',
];

export const PERSONAL_CONTEXT_DIALECT_LABELS: Record<
  PersonalContextDialect,
  string
> = {
  singlish: 'Singlish',
  english: 'English',
  tanglish: 'Tanglish',
};

export interface PersonalContextLanguageCount {
  count: number;
  max: number;
  remaining: number;
}

export interface PersonalContextItem {
  id: string;
  userId: string;
  slangWord: string;
  standardMeaning: string;
  dialectType: PersonalContextDialect;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalContextCount {
  // Legacy fields retained by backend for compatibility.
  count: number;
  max: number;
  totalCount: number;
  totalMax: number;
  perLanguage: Record<PersonalContextDialect, PersonalContextLanguageCount>;
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
  dialectType: PersonalContextDialect,
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
  dialectType?: PersonalContextDialect,
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
