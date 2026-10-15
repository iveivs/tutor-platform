export const preferenceKey = (scope: string, name: string) => `tutor-platform:${scope}:${name}`;

export const readPreference = (key: string) => typeof window === "undefined" ? null : window.localStorage.getItem(key);

export const writePreference = (key: string, value: string) => {
  if (typeof window !== "undefined") window.localStorage.setItem(key, value);
};
