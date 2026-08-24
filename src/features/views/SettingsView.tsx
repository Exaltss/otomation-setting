/**
 * Setting — vault master password + manajemen API key berbagai AI.
 * Key yang ditambahkan di sini menjadi key primary yang dipakai user.
 */
import { CredentialPanel } from '../credentials/CredentialPanel';

export function SettingsView() {
  return (
    <div>
      <h2>Setting</h2>
      <p>
        Kelola master password vault dan tambahkan API key berbagai AI.
        Key di sini berfungsi sebagai key primary yang dapat digunakan user.
      </p>
      <CredentialPanel />
    </div>
  );
}