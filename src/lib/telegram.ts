export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: {
          user?: TelegramUser;
        };
        ready?: () => void;
        expand?: () => void;
        close?: () => void;
        HapticFeedback?: {
          impactOccurred?: (style: 'light' | 'medium' | 'heavy') => void;
          notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
        };
      };
    };
  }
}

export const FALLBACK_TELEGRAM_ID = 123456789;
export const FALLBACK_FIRST_NAME = ' Myat Thu (Demo)';

export function getTelegramUser(): { telegram_id: number; first_name: string; isTelegramWebApp: boolean } {
  if (typeof window !== 'undefined') {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser && typeof tgUser.id === 'number') {
      return {
        telegram_id: tgUser.id,
        first_name: tgUser.first_name || 'User',
        isTelegramWebApp: true,
      };
    }
  }

  return {
    telegram_id: FALLBACK_TELEGRAM_ID,
    first_name: 'Myat Thu',
    isTelegramWebApp: false,
  };
}

export function initTelegramWebApp(): void {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    try {
      window.Telegram.WebApp.ready?.();
      window.Telegram.WebApp.expand?.();
    } catch {
      // Ignore in regular browser
    }
  }
}

export function triggerHaptic(type: 'success' | 'warning' | 'error' = 'success'): void {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(type);
  } catch {
    // Ignore outside Telegram
  }
}

