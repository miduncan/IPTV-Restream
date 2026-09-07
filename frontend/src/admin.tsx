import { createRoot } from 'react-dom/client'
import AdminPage from './components/admin/AdminPage.tsx'
import { ToastProvider } from './components/notifications/ToastContext.tsx'
import ToastContainer from './components/notifications/ToastContainer.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <AdminPage />
    <ToastContainer />
  </ToastProvider>
)
