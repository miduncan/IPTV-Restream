import { Loader } from 'lucide-react';
import AdminLayout from './AdminLayout';
import AdminLogin from './AdminLogin';
import SettingsEditor from './SettingsEditor';
import { useAdminSettings } from './useAdminSettings';

function AdminPage() {
  const adminSettings = useAdminSettings();

  if (adminSettings.pageState === 'loading') {
    return (
      <main className="admin-shell flex min-h-screen items-center justify-center text-[#EAF0F6]">
        <div className="flex items-center gap-3 text-[#91A0AF]">
          <Loader className="h-5 w-5 animate-spin text-[#4EA1FF]" />
          Loading admin settings
        </div>
      </main>
    );
  }

  if (adminSettings.pageState === 'login') {
    return <AdminLogin message={adminSettings.message} onLogin={adminSettings.login} />;
  }

  if (adminSettings.pageState === 'error') {
    return (
      <main className="admin-shell flex min-h-screen items-center justify-center px-5 text-[#EAF0F6]">
        <section className="admin-panel max-w-lg p-8 text-center">
          <h1 className="text-2xl font-semibold">Settings are unavailable</h1>
          <p className="mt-2 text-[#91A0AF]">{adminSettings.message}</p>
          <button type="button" onClick={adminSettings.loadSettings} className="admin-primary mt-6 px-5 py-2.5">
            Try again
          </button>
        </section>
      </main>
    );
  }

  return (
    <AdminLayout authRequired={adminSettings.authRequired} onSignOut={adminSettings.signOut}>
      <SettingsEditor
        settings={adminSettings.settings}
        message={adminSettings.message}
        isSaving={adminSettings.isSaving}
        hasChanges={adminSettings.hasChanges}
        validationMessage={adminSettings.validationMessage}
        onSave={adminSettings.saveSettings}
        onUpdate={adminSettings.updateSetting}
      />
    </AdminLayout>
  );
}

export default AdminPage;
