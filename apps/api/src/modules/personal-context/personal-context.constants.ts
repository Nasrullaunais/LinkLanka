export const PERSONAL_CONTEXT_DIALECTS = [
  'singlish',
  'english',
  'tanglish',
] as const;

export type PersonalContextDialect = (typeof PERSONAL_CONTEXT_DIALECTS)[number];

export const PERSONAL_CONTEXT_DIALECT_LABELS: Record<
  PersonalContextDialect,
  string
> = {
  singlish: 'Singlish',
  english: 'English',
  tanglish: 'Tanglish',
};

export const DEFAULT_PERSONAL_CONTEXT_DIALECT: PersonalContextDialect =
  'english';
