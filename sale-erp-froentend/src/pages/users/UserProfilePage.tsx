import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Upload, UserRound, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { usersApi } from '../../api/endpoints';
import type { UpdateProfileRequest } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { useAuth } from '../../hooks/useAuth';
import { PERMISSIONS } from '../../auth/permissions';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const UserProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, hasPermission } = useAuth();
  const canViewProfile = hasPermission(PERMISSIONS.USER_PROFILE);
  const canUpdateProfile = hasPermission(PERMISSIONS.USER_UPDATE_PROFILE);
  const canChangePassword = hasPermission(PERMISSIONS.USER_CHANGE_PASSWORD);
  const pictureRef = useRef<HTMLInputElement>(null);
  const [activePanel, setActivePanel] = useState<'profile' | 'password'>(canViewProfile ? 'profile' : 'password');
  const [profileForm, setProfileForm] = useState<UpdateProfileRequest>({ firstName: '', lastName: '', userName: '', email: '', mobileNo: '' });
  const [profilePictureName, setProfilePictureName] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordErrors, setPasswordErrors] = useState<Partial<typeof passwordForm>>({});

  const profile = useQuery({
    queryKey: ['user-profile'],
    queryFn: usersApi.getProfile,
    enabled: activePanel === 'profile' && canViewProfile,
  });

  useEffect(() => {
    const panel = (location.state as { panel?: 'profile' | 'password' } | null)?.panel;
    if (panel === 'profile' && canViewProfile) setActivePanel(panel);
    if (panel === 'password' && canChangePassword) setActivePanel(panel);
  }, [canChangePassword, canViewProfile, location.state]);
  useEffect(() => {
    if (activePanel === 'profile' && !canViewProfile && canChangePassword) setActivePanel('password');
    if (activePanel === 'password' && !canChangePassword && canViewProfile) setActivePanel('profile');
  }, [activePanel, canChangePassword, canViewProfile]);
  useEffect(() => {
    if (!profile.data?.data) return;
    const data = profile.data.data;
    setProfileForm({
      firstName: data.firstName || '',
      lastName: data.lastName || '',
      userName: data.userName || '',
      email: data.email || '',
      mobileNo: data.mobileNo || '',
    });
  }, [profile.data?.data]);

  const updateProfile = useMutation({
    mutationFn: () => usersApi.updateProfile(profileForm),
    onSuccess: () => {
      toast.success('Profile updated successfully');
      profile.refetch();
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update profile'),
  });

  const setProfileField = (field: keyof UpdateProfileRequest, value: string) => {
    setProfileForm((current) => ({ ...current, [field]: value }));
  };
  const submitProfile = () => {
    if (!profileForm.firstName.trim()) return toast.error('First name is required');
    if (!profileForm.lastName.trim()) return toast.error('Last name is required');
    if (!profileForm.userName.trim()) return toast.error('Username is required');
    if (!profileForm.email.trim()) return toast.error('Email is required');
    if (!profileForm.mobileNo.trim()) return toast.error('Mobile is required');
    updateProfile.mutate();
  };

  const changePassword = useMutation({
    mutationFn: () => usersApi.changePassword({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    }),
    onSuccess: () => {
      toast.success('Password changed successfully. Please login again.');
      logout();
      navigate('/login', { replace: true });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to change password'),
  });
  const setPasswordField = (field: keyof typeof passwordForm, value: string) => {
    setPasswordForm((current) => ({ ...current, [field]: value }));
    setPasswordErrors((current) => ({ ...current, [field]: undefined }));
  };
  const submitPassword = () => {
    const errors: Partial<typeof passwordForm> = {};
    if (!passwordForm.currentPassword.trim()) errors.currentPassword = 'Current password is required';
    if (!passwordForm.newPassword.trim()) errors.newPassword = 'New password is required';
    else if (passwordForm.newPassword.length < 8) errors.newPassword = 'New password must be at least 8 characters';
    if (!passwordForm.confirmPassword.trim()) errors.confirmPassword = 'Confirm password is required';
    else if (passwordForm.confirmPassword !== passwordForm.newPassword) errors.confirmPassword = 'Confirm password must match new password';
    setPasswordErrors(errors);
    if (Object.keys(errors).length) return;
    changePassword.mutate();
  };

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">{activePanel === 'profile' ? 'Profile' : 'Change Password'}</h1>
        </div>

        {activePanel === 'profile' ? (
          <>
            {profile.isLoading ? <div className="p-10"><Loader /></div> : (
              <>
                <div className="space-y-5 p-5">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Profile Picture</label>
                    <div className="flex items-center gap-3">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-400">
                        <UserRound size={38} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2">
                          {canUpdateProfile && <button type="button" onClick={() => pictureRef.current?.click()} className="inline-flex h-9 items-center gap-2 rounded border border-blue-500 bg-white px-3 text-sm font-semibold text-blue-600 hover:bg-blue-50">
                            <Upload size={16} /> Browse
                          </button>}
                          {canUpdateProfile && <button type="button" onClick={() => { setProfilePictureName(''); if (pictureRef.current) pictureRef.current.value = ''; }} className="inline-flex h-9 items-center gap-2 rounded border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50">
                            <X size={16} /> Reset
                          </button>}
                        </div>
                        <p className="mt-1 truncate text-xs text-gray-500">{profilePictureName || 'Allowed JPG, GIF or PNG. Max size of 1MB'}</p>
                        <input ref={pictureRef} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" onChange={(event) => setProfilePictureName(event.target.files?.[0]?.name || '')} />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block text-sm text-gray-600">First Name<input disabled={!canUpdateProfile} className={`${inputClass} mt-1`} value={profileForm.firstName} onChange={(event) => setProfileField('firstName', event.target.value)} /></label>
                    <label className="block text-sm text-gray-600">Last Name<input disabled={!canUpdateProfile} className={`${inputClass} mt-1`} value={profileForm.lastName} onChange={(event) => setProfileField('lastName', event.target.value)} /></label>
                    <label className="block text-sm text-gray-600">Username<input disabled={!canUpdateProfile} className={`${inputClass} mt-1`} value={profileForm.userName} onChange={(event) => setProfileField('userName', event.target.value)} /></label>
                    <label className="block text-sm text-gray-600">Email Address<input disabled={!canUpdateProfile} className={`${inputClass} mt-1`} type="email" value={profileForm.email} onChange={(event) => setProfileField('email', event.target.value)} /></label>
                    <label className="block text-sm text-gray-600">Mobile<input disabled={!canUpdateProfile} className={`${inputClass} mt-1`} value={profileForm.mobileNo} onChange={(event) => setProfileField('mobileNo', event.target.value)} /></label>
                    <label className="block text-sm text-gray-600">Status<input className={`${inputClass} mt-1 bg-gray-50`} value={profile.data?.data?.status || ''} readOnly /></label>
                    <label className="block text-sm text-gray-600">Role Name<input className={`${inputClass} mt-1 bg-gray-50`} value={profile.data?.data?.roleName || ''} readOnly /></label>
                  </div>
                </div>
                <div className="flex gap-3 px-5 pb-5">
                  {canUpdateProfile && <Button type="button" isLoading={updateProfile.isPending} onClick={submitProfile}>Submit</Button>}
                  <Button type="button" variant="secondary" onClick={() => navigate('/dashboard')}>Close</Button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              <label className="text-sm text-gray-600">Current Password<input className={`${inputClass} mt-1`} type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordField('currentPassword', event.target.value)} />{passwordErrors.currentPassword && <span className="mt-1 block text-xs text-red-600">{passwordErrors.currentPassword}</span>}</label>
              <label className="text-sm text-gray-600">New Password<input className={`${inputClass} mt-1`} type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordField('newPassword', event.target.value)} />{passwordErrors.newPassword && <span className="mt-1 block text-xs text-red-600">{passwordErrors.newPassword}</span>}</label>
              <label className="text-sm text-gray-600">Confirm Password<input className={`${inputClass} mt-1`} type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordField('confirmPassword', event.target.value)} />{passwordErrors.confirmPassword && <span className="mt-1 block text-xs text-red-600">{passwordErrors.confirmPassword}</span>}</label>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <Button type="button" isLoading={changePassword.isPending} onClick={submitPassword}>Submit</Button>
              <Button type="button" variant="secondary" onClick={() => navigate('/dashboard')}>Close</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
