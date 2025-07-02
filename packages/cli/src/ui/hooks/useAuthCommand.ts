/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import {
  AuthType,
  Config,
  clearCachedCredentialFile,
  getErrorMessage,
} from '@google/gemini-cli-core';

export const useAuthCommand = (
  settings: LoadedSettings,
  setAuthError: (error: string | null) => void,
  config: Config,
) => {
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(
    settings.merged.selectedAuthType === undefined,
  );

  const [needsReauth, setNeedsReauth] = useState(false);

  const openAuthDialog = useCallback(() => {
    setIsAuthDialogOpen(true);
    setNeedsReauth(true); // Mark that re-auth is needed
  }, []);

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [shouldRefreshAuth, setShouldRefreshAuth] = useState(true);

  useEffect(() => {
    const authFlow = async () => {
      const authType = settings.merged.selectedAuthType;
      if (isAuthDialogOpen || !authType || !shouldRefreshAuth) {
        return;
      }

      try {
        setIsAuthenticating(true);
        await config.refreshAuth(authType);
        console.log(`Authenticated via "${authType}".`);
        setShouldRefreshAuth(false);
        setNeedsReauth(false); // Clear re-auth flag on success
      } catch (e) {
        setAuthError(`Failed to login. Message: ${getErrorMessage(e)}`);
        openAuthDialog();
      } finally {
        setIsAuthenticating(false);
      }
    };

    void authFlow();
  }, [isAuthDialogOpen, settings, config, setAuthError, openAuthDialog, shouldRefreshAuth]);

  const handleAuthSelect = useCallback(
    async (authType: AuthType | undefined, scope: SettingScope) => {
      if (authType) {
        await clearCachedCredentialFile();
        settings.setValue(scope, 'selectedAuthType', authType);
        setShouldRefreshAuth(true);
      } else {
        // User cancelled (pressed ESC)
        // Only disable re-auth if it wasn't needed due to error
        if (!needsReauth) {
          setShouldRefreshAuth(false);
        }
      }
      setIsAuthDialogOpen(false);
      setAuthError(null);
    },
    [settings, setAuthError, needsReauth],
  );

  const cancelAuthentication = useCallback(() => {
    setIsAuthenticating(false);
  }, []);

  return {
    isAuthDialogOpen,
    openAuthDialog,
    handleAuthSelect,
    isAuthenticating,
    cancelAuthentication,
  };
};
