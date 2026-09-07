import { createRoot } from 'react-dom/client'
import AdminPage from './components/admin/AdminPage.tsx'
import { ToastProvider } from './components/notifications/ToastContext.tsx'
import ToastContainer from './components/notifications/ToastContainer.tsx'
import AuthGate from './components/auth/AuthGate.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <AuthGate requireAdmin>
      <AdminPage />
    </AuthGate>
    <ToastContainer />
  </ToastProvider>
)
