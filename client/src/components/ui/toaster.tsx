import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

let toastListeners: ((toast: Toast) => void)[] = [];
let toastId = 0;

export function toast(options: Omit<Toast, 'id'>) {
  const id = String(++toastId);
  const newToast = { ...options, id };
  toastListeners.forEach(listener => listener(newToast));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (toast: Toast) => {
      setToasts(prev => [...prev, toast]);
      // Auto-remove after 5 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, 5000);
    };

    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter(l => l !== listener);
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`
            p-4 rounded-lg shadow-lg max-w-sm animate-in slide-in-from-right
            ${toast.variant === 'destructive'
              ? 'bg-red-600 text-white'
              : 'bg-white border text-gray-900'
            }
          `}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="font-medium">{toast.title}</p>
              {toast.description && (
                <p className={`text-sm mt-1 ${toast.variant === 'destructive' ? 'text-red-100' : 'text-gray-600'}`}>
                  {toast.description}
                </p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="p-1 rounded hover:bg-black/10"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
