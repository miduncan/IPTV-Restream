export const USERNAME_STORAGE_KEY = 'streamhub.chat.username';
export const USERNAME_CHANGED_EVENT = 'streamhub-username-changed';

export function readStoredUsername() {
  try {
    const value = window.localStorage.getItem(USERNAME_STORAGE_KEY)?.trim();
    return value && value.length >= 2 && value.length <= 24 ? value : '';
  } catch {
    return '';
  }
}

export function storeUsername(username: string) {
  try {
    window.localStorage.setItem(USERNAME_STORAGE_KEY, username);
  } catch {
    // Keep the name available to this page even when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(USERNAME_CHANGED_EVENT, { detail: username }));
}
