const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ApiErrorLike = {
  message?: unknown;
  response?: {
    data?: {
      message?: unknown;
    };
  };
};

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return SIMPLE_EMAIL_REGEX.test(normalizeEmail(value));
}

export function getApiErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  const err = error as ApiErrorLike;
  const apiMessage = err?.response?.data?.message;

  if (Array.isArray(apiMessage)) {
    const lines = apiMessage.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );

    if (lines.length > 0) return lines.join('\n');
  }

  if (typeof apiMessage === 'string' && apiMessage.trim().length > 0) {
    return apiMessage;
  }

  if (typeof err?.message === 'string' && err.message.trim().length > 0) {
    return `Network error: ${err.message}`;
  }

  return fallback;
}