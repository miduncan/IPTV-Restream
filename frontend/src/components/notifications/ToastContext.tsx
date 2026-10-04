import React, { createContext, useCallback, useState } from 'react';
import { ToastNotification } from '../../types';

interface ToastContextType {
  addToast: (toast: Omit<ToastNotification, 'id'>) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  toasts: ToastNotification[];
}

export const ToastContext = createContext<ToastContextType>({
  addToast: () => '',
  removeToast: () => {},
  clearToasts: () => {},
  toasts: [],
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const addToast = useCallback(
    ({ type, title, message, duration = 5000 }: Omit<ToastNotification, 'id'>) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: ToastNotification = {
        id,
        type,
        title,
        message,
        duration,
      };

      setToasts((prevToasts) => [...prevToasts, newToast]);

      return id;
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prevToasts) => prevToasts.filter((toast) => toast.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast, clearToasts, toasts }}>
      {children}
    </ToastContext.Provider>
  );
}
