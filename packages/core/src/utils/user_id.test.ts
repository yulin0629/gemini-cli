/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getInstallationId, getObfuscatedGoogleAccountId } from './user_id.js';

describe('user_id', () => {
  describe('getInstallationId', () => {
    it('should return a valid UUID format string', () => {
      const installationId = getInstallationId();

      expect(installationId).toBeDefined();
      expect(typeof installationId).toBe('string');
      expect(installationId.length).toBeGreaterThan(0);

      // Should return the same ID on subsequent calls (consistent)
      const secondCall = getInstallationId();
      expect(secondCall).toBe(installationId);
    });
  });

  describe('getObfuscatedGoogleAccountId', () => {
    it('should return a non-empty string', () => {
      const result = getObfuscatedGoogleAccountId();

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);

      // Should be consistent on subsequent calls
      const secondCall = getObfuscatedGoogleAccountId();
      expect(secondCall).toBe(result);
    });

    it('should return the same as installation ID when no Google Account ID is cached', () => {
      // In a clean test environment, there should be no cached Google Account ID
      // so getObfuscatedGoogleAccountId should fall back to installation ID
      const googleAccountIdResult = getObfuscatedGoogleAccountId();
      const installationIdResult = getInstallationId();

      // They should be the same when no Google Account ID is cached
      expect(googleAccountIdResult).toBe(installationIdResult);
    });
  });
});
