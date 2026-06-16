import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { translations } from '../utils/translations';

export default function Profile({ language }) {
  const t = (key) => translations[language]?.[key] || translations['en']?.[key] || key;

  const [username, setUsername] = useState('Admin');
  const [discordLinked, setDiscordLinked] = useState(false);
  const [discordId, setDiscordId] = useState('');
  const [discordUsername, setDiscordUsername] = useState('');
  const [discordAvatar, setDiscordAvatar] = useState('');
  const [discordLinking, setDiscordLinking] = useState(false);
  
  // Profile picture states
  const [pfpType, setPfpType] = useState('initials'); // default 'initials'
  const [pfpValue, setPfpValue] = useState('A');
  const [uploadError, setUploadError] = useState('');
  
  // Security change states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [showChangeUsername, setShowChangeUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [usernamePassword, setUsernamePassword] = useState('');

  const [toast, setToast] = useState(null);

  // Load profile from settings on mount
  useEffect(() => {
    async function loadProfile() {
      try {
        const activeUser = localStorage.getItem('synced-username') || 'Admin';
        const profile = await api.getUserProfile(activeUser);
        if (profile) {
          setUsername(profile.username || activeUser);
          setDiscordLinked(!!profile.discordLinked);
          setDiscordId(profile.discordId || '');
          setDiscordUsername(profile.discordUsername || '');
          setDiscordAvatar(profile.discordAvatar || '');
          setPfpType(profile.pfpType || 'initials');
          setPfpValue(profile.pfpValue || (profile.username ? profile.username[0].toUpperCase() : 'U'));
        } else {
          // Fallback to settings.json
          const s = await api.getSettings(activeUser);
          if (s && s.profile) {
            setUsername(s.profile.username || 'Admin');
            setDiscordLinked(!!s.profile.discordLinked);
            setDiscordId(s.profile.discordId || '');
            setDiscordUsername(s.profile.discordUsername || '');
            setDiscordAvatar(s.profile.discordAvatar || '');
            setPfpType(s.profile.pfpType || 'initials');
            setPfpValue(s.profile.pfpValue || (s.profile.username ? s.profile.username[0].toUpperCase() : 'U'));
          }
        }
      } catch (e) {
        console.warn('Failed to load profile settings:', e);
      }
    }
    loadProfile();
  }, []);

  const handleDiscordLink = async () => {
    if (discordLinking) return;
    setDiscordLinking(true);
    try {
      const res = await api.discordLink();
      if (res && res.success) {
        setDiscordId(res.discordId);
        setDiscordUsername(res.username);
        setDiscordAvatar(res.avatar || '');
        setDiscordLinked(true);
        // Auto-set PFP to Discord avatar
        if (res.avatar) {
          setPfpType('url');
          setPfpValue(res.avatar);
        }
        showToast('Discord linked successfully!', 'success');
      } else {
        showToast(res?.error || 'Failed to link Discord.', 'danger');
      }
    } catch (err) {
      showToast('Discord link error: ' + err.message, 'danger');
    } finally {
      setDiscordLinking(false);
    }
  };

  const handleDiscordUnlink = async () => {
    setDiscordLinked(false);
    setDiscordId('');
    setDiscordUsername('');
    setDiscordAvatar('');
    // Only revert PFP if it was set from Discord
    if (pfpType === 'url' && discordAvatar) {
      setPfpType('initials');
      setPfpValue(username[0]?.toUpperCase() || 'U');
    }
    showToast('Discord unlinked.', 'success');
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showToast(t('pfpSizeAlert'), 'danger');
      return;
    }
    setUploadError('');

    const reader = new FileReader();
    reader.onload = () => {
      setPfpType('base64');
      setPfpValue(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleUsernameChange = async () => {
    const activeUser = localStorage.getItem('synced-username') || 'Admin';
    if (!newUsername.trim()) {
      showToast(language === 'fr' ? 'Nouveau nom d\'utilisateur requis' : 'New Username is required', 'danger');
      return;
    }
    if (!usernamePassword) {
      showToast(language === 'fr' ? 'Mot de passe actuel requis' : 'Current password is required', 'danger');
      return;
    }
    
    // Verify password
    const authRes = await api.loginUser(activeUser, usernamePassword);
    if (!authRes || !authRes.success) {
      showToast(language === 'fr' ? 'Mot de passe incorrect' : 'Incorrect password', 'danger');
      return;
    }

    try {
      const dbData = {
        pfpType,
        pfpValue: pfpType === 'initials' ? newUsername.trim()[0].toUpperCase() : pfpValue,
        discordLinked,
        discordId: discordLinked ? discordId : null,
        discordUsername: discordLinked ? discordUsername : null,
        discordAvatar: discordLinked ? discordAvatar : null,
        newUsername: newUsername.trim()
      };
      
      const dbRes = await api.saveUserProfile(activeUser, dbData);
      if (!dbRes || !dbRes.success) {
        showToast('Database Error: ' + (dbRes?.error || 'Failed to update username'), 'danger');
        return;
      }

      // Update local storage and state
      localStorage.setItem('synced-username', newUsername.trim());
      setUsername(newUsername.trim());
      
      // Update settings.json
      const settings = await api.getSettings(newUsername.trim()) || {};
      if (!settings.profile) settings.profile = {};
      settings.profile.username = newUsername.trim();
      await api.saveSettings(settings, newUsername.trim());

      // Update local storage profile block
      const localProfile = localStorage.getItem('synced-profile');
      if (localProfile) {
        const parsed = JSON.parse(localProfile);
        parsed.username = newUsername.trim();
        localStorage.setItem('synced-profile', JSON.stringify(parsed));
      }

      // Reset states
      setNewUsername('');
      setUsernamePassword('');
      setShowChangeUsername(false);
      window.dispatchEvent(new Event('storage'));
      showToast(language === 'fr' ? 'Nom d\'utilisateur mis à jour' : 'Username updated successfully', 'success');
    } catch (e) {
      showToast('Error: ' + e.message, 'danger');
    }
  };

  const saveProfile = async () => {
    const activeUser = localStorage.getItem('synced-username') || 'Admin';

    const usernameChanged = username.trim() !== activeUser;
    const passwordChanging = !!newPassword;
    const pinChanging = !!newPin;

    if (!username.trim()) {
      showToast(language === 'fr' ? 'Nom d\'utilisateur requis' : 'Username is required', 'danger');
      return;
    }

    // 1. Password verification for username edits or password edits
    if (usernameChanged || passwordChanging) {
      if (!currentPassword) {
        showToast(language === 'fr' ? 'Mot de passe actuel requis pour ces changements' : 'Current password is required to make these changes', 'danger');
        return;
      }
      // Verify password
      const authRes = await api.loginUser(activeUser, currentPassword);
      if (!authRes || !authRes.success) {
        showToast(language === 'fr' ? 'Mot de passe actuel incorrect' : 'Incorrect current password', 'danger');
        return;
      }
    }

    // 2. Validate new password
    if (passwordChanging) {
      if (newPassword.length < 6) {
        showToast(language === 'fr' ? 'Le nouveau mot de passe doit faire au moins 6 caractères' : 'New password must be at least 6 characters', 'danger');
        return;
      }
      if (newPassword !== confirmNewPassword) {
        showToast(t('passwordsMismatch') || 'Passwords do not match', 'danger');
        return;
      }
    }

    // Load old credentials from settings.json fallback to merge
    let fallbackPassword = '';
    try {
      const s = await api.getSettings(activeUser);
      if (s && s.profile) {
        fallbackPassword = s.profile.password;
      }
    } catch {}

    const updatedPassword = newPassword ? newPassword : (currentPassword || fallbackPassword);
    const updatedPin = '0000';

    const finalPfpValue = pfpType === 'initials' ? username.trim()[0].toUpperCase() : pfpValue;

    const profileData = {
      username: username.trim(),
      password: updatedPassword,
      pin: updatedPin,
      discordLinked,
      discordId: discordLinked ? discordId : null,
      discordUsername: discordLinked ? discordUsername : null,
      discordAvatar: discordLinked ? discordAvatar : null,
      pfpType,
      pfpValue: finalPfpValue
    };

    try {
      // 1. Save to SQLite database
      const dbData = {
        pfpType,
        pfpValue: finalPfpValue,
        discordLinked,
        discordId: discordLinked ? discordId : null,
        discordUsername: discordLinked ? discordUsername : null,
        discordAvatar: discordLinked ? discordAvatar : null,
        newUsername: usernameChanged ? username.trim() : undefined,
        password: newPassword ? newPassword : undefined,
        pin: '0000'
      };
      
      const dbRes = await api.saveUserProfile(activeUser, dbData);
      if (!dbRes || !dbRes.success) {
        if (dbRes?.error === 'Username is already taken') {
          showToast(language === 'fr' ? 'Ce nom d\'utilisateur est déjà utilisé' : 'Username is already taken', 'danger');
        } else {
          showToast('Database Error: ' + (dbRes?.error || 'Failed to save'), 'danger');
        }
        return;
      }

      // Update active user in local storage
      if (usernameChanged) {
        localStorage.setItem('synced-username', username.trim());
      }

      // 2. Save to settings.json
      const settings = await api.getSettings(activeUser) || {};
      settings.profile = profileData;
      await api.saveSettings(settings, username.trim());

      // 3. Save to localStorage
      localStorage.setItem('synced-profile', JSON.stringify(profileData));

      // Trigger standard callback or storage sync event
      window.dispatchEvent(new Event('storage'));
      window.dispatchEvent(new Event('profile-updated'));
      
      showToast(t('profileSaved'), 'success');

      // Reset password/pin fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setCurrentPin('');
      setNewPin('');
    } catch (err) {
      showToast('Error: ' + err.message, 'danger');
    }
  };

  return (
    <div className="settings-grid animate-slide-up" style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="page-header">
        <h1 className="page-title">{t('profileSettings')}</h1>
        <p className="page-subtitle">{t('profileSubtitle')}</p>
      </div>

      {toast && (
        <div 
          className={`badge badge-${toast.type} animate-fade-in`} 
          style={{ 
            position: 'fixed', 
            top: 24, 
            right: 24, 
            zIndex: 10000, 
            padding: '12px 20px', 
            borderRadius: 8, 
            fontSize: 14, 
            fontWeight: 600,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Profile Avatar Card */}
      <div className="glass-card settings-section" style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <div 
          style={{ 
            width: 90, 
            height: 90, 
            borderRadius: '50%', 
            background: 'var(--accent-gradient)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            fontSize: pfpType === 'initials' ? 36 : 14, 
            fontWeight: 700, 
            color: '#fff', 
            overflow: 'hidden',
            boxShadow: '0 0 20px rgba(168, 85, 247, 0.4)',
            border: '2px solid rgba(255,255,255,0.1)'
          }}
        >
          {pfpType === 'initials' ? (
            (username || 'U')[0].toUpperCase()
          ) : pfpType === 'base64' || pfpType === 'url' ? (
            <img src={pfpValue} alt="Pfp" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setPfpType('initials')} />
          ) : (
            (username || 'U')[0].toUpperCase()
          )}
        </div>
        
        <div style={{ flex: 1, minWidth: 250 }}>
          <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>{t('changeAvatar')}</h3>
          <p className="settings-section-desc" style={{ marginBottom: 16 }}>{language === 'fr' ? 'Choisissez vos initiales ou téléversez un avatar personnalisé' : 'Select initials or upload a custom image avatar'}</p>
          
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <button
              onClick={() => { setPfpType('initials'); setPfpValue(username[0]?.toUpperCase() || 'U'); }}
              className={`btn ${pfpType === 'initials' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, height: 38, fontWeight: 600 }}
            >
              🔤 {language === 'fr' ? 'Utiliser les Initiales' : 'Use Initials'}
            </button>
            <label 
              className={`btn ${pfpType === 'base64' ? 'btn-primary' : 'btn-secondary'}`} 
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', margin: 0, flex: 1, height: 38, fontWeight: 600 }}
            >
              📤 {t('uploadPfp')}
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleFileUpload} 
                style={{ display: 'none' }} 
              />
            </label>
          </div>

          {uploadError && (
            <div className="setup-error" style={{ marginTop: 8, padding: 8 }}>{uploadError}</div>
          )}
        </div>
      </div>

      {/* Account Info */}
      <div className="glass-card settings-section">
        <h2 className="settings-section-title">🔒 {language === 'fr' ? 'Sécurité du compte' : 'Account Security'}</h2>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <div className="input-group">
            <label className="input-label">{t('usernameLabel')}</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <input 
                type="text" 
                className="input" 
                value={username}
                readOnly
                disabled
                style={{ flex: 1, opacity: 0.6, cursor: 'not-allowed', background: 'rgba(255,255,255,0.02)' }}
              />
              <button 
                type="button" 
                className={`btn ${showChangeUsername ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setShowChangeUsername(!showChangeUsername)}
                style={{ height: 38, padding: '0 16px', fontWeight: 600 }}
              >
                ✏️ {language === 'fr' ? 'Modifier l\'ID' : 'Change ID'}
              </button>
            </div>
          </div>

          {showChangeUsername && (
            <div className="glass-card" style={{ padding: 16, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
              <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 }}>✏️ {language === 'fr' ? 'Changer l\'ID utilisateur' : 'Change User ID'}</h4>
              <div className="input-group">
                <label className="input-label">{language === 'fr' ? 'Nouvel ID' : 'New ID'}</label>
                <input 
                  type="text" 
                  className="input" 
                  value={newUsername} 
                  onChange={(e) => setNewUsername(e.target.value)} 
                  placeholder="e.g. NewAdmin"
                />
              </div>
              <div className="input-group">
                <label className="input-label">{language === 'fr' ? 'Mot de passe actuel' : 'Current Password'}</label>
                <input 
                  type="password" 
                  className="input" 
                  value={usernamePassword} 
                  onChange={(e) => setUsernamePassword(e.target.value)} 
                  placeholder="••••••••"
                />
              </div>
              <button 
                type="button" 
                className="btn btn-primary" 
                onClick={handleUsernameChange}
                style={{ alignSelf: 'flex-end', height: 34, padding: '0 16px' }}
              >
                {language === 'fr' ? 'Confirmer le changement' : 'Confirm Change'}
              </button>
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '8px 0' }} />

          <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)', fontWeight: 600 }}>🔑 {language === 'fr' ? 'Modifier le mot de passe' : 'Change Password'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="input-group" style={{ gridColumn: 'span 2' }}>
              <label className="input-label">{language === 'fr' ? 'Mot de passe actuel' : 'Current Password'}</label>
              <input 
                type="password" 
                className="input" 
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="input-group">
              <label className="input-label">{language === 'fr' ? 'Nouveau mot de passe' : 'New Password'}</label>
              <input 
                type="password" 
                className="input" 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
            </div>
            <div className="input-group">
              <label className="input-label">{language === 'fr' ? 'Confirmer le nouveau mot de passe' : 'Confirm New Password'}</label>
              <input 
                type="password" 
                className="input" 
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Repeat new password"
              />
            </div>
          </div>

        </div>
      </div>

      {/* Discord Integration */}
      <div className="glass-card settings-section">
        <h2 className="settings-section-title">👾 {t('discordLabel')}</h2>
        <p className="settings-section-desc">{t('discordPlaceholder')}</p>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {discordLinked && discordAvatar ? (
              <img 
                src={discordAvatar} 
                alt="Discord Avatar"
                style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(88, 101, 242, 0.5)' }}
                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = ''; }}
              />
            ) : discordLinked ? (
              <span style={{ fontSize: 24 }}>👾</span>
            ) : (
              <span style={{ fontSize: 24 }}>👾</span>
            )}
            <div>
              <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>
                {discordLinked ? 'Linked Discord Account' : 'Not Connected'}
              </h4>
              <p style={{ margin: '2px 0 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                {discordLinked 
                  ? `@${discordUsername || 'Discord User'}` 
                  : 'Link your Discord to receive status alerts and use your Discord avatar as PFP'}
              </p>
            </div>
          </div>
          
          <button 
            className={`btn ${discordLinked ? 'btn-secondary' : 'btn-primary'}`}
            onClick={discordLinked ? handleDiscordUnlink : handleDiscordLink}
            disabled={discordLinking}
            style={discordLinked ? { 
              backgroundColor: 'rgba(239, 68, 68, 0.1)', 
              color: '#f87171', 
              border: '1px solid rgba(239, 68, 68, 0.3)' 
            } : {
              background: discordLinking ? 'var(--bg-input)' : 'linear-gradient(135deg, #5865F2, #4752C4)',
              color: '#fff',
              border: 'none'
            }}
          >
            {discordLinking ? 'Linking...' : (discordLinked ? 'Unlink Discord' : t('linkDiscord'))}
          </button>
        </div>

        {discordLinked && (
          <div style={{ marginTop: 12, padding: 12, background: 'rgba(88, 101, 242, 0.08)', borderRadius: 8, border: '1px solid rgba(88, 101, 242, 0.15)', fontSize: 12, color: 'var(--text-muted)' }}>
            ✅ Your Discord avatar has been set as your profile picture. {discordId ? `Discord ID: ${discordId}` : ''}
          </div>
        )}
      </div>

      {/* Save Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
        <button 
          type="button"
          className="btn btn-secondary" 
          onClick={() => {
            const activeUser = localStorage.getItem('synced-username') || username;
            if (activeUser) {
              (async () => {
                try {
                  const [specsRes, ipRes] = await Promise.all([api.getLocalSpecs(), api.getLocalIP()]);
                  await api.saveSessionData(activeUser, {
                    action: 'logout',
                    ip: ipRes?.ip || '',
                    specs: specsRes?.data || {}
                  });
                } catch (err) {
                  console.warn('Failed to save logout session data:', err);
                }
              })();
            }
            localStorage.removeItem('synced-username');
            localStorage.removeItem('synced-user-id');
            localStorage.removeItem('synced-profile');
            window.dispatchEvent(new Event('storage'));
            window.location.reload();
          }} 
          style={{ padding: '12px 24px', fontWeight: 600, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)' }}
        >
          🚪 Log Out
        </button>
        <button className="btn btn-primary" onClick={saveProfile} style={{ padding: '12px 24px', fontWeight: 600 }}>
          💾 {t('saveConfig')}
        </button>
      </div>
    </div>
  );
}
