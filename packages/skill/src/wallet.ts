/**
 * Agent wallet management.
 *
 * Per evaluation M1: encrypted keystore with password.
 * Uses ethers.js Wallet.createRandom() for key generation.
 * Keystore is AES-256 encrypted, stored in skill data directory.
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

export class Wallet {
  private wallet: ethers.Wallet | null = null;
  private keystorePath: string;

  constructor(keystorePath: string) {
    this.keystorePath = keystorePath;
  }

  /**
   * Generate a new wallet. Called on first skill run.
   * Returns the address. Keystore saved encrypted.
   */
  async generate(password: string): Promise<string> {
    const wallet = ethers.Wallet.createRandom();
    const keystore = await wallet.encrypt(password);
    fs.writeFileSync(this.keystorePath, keystore);
    this.wallet = wallet;
    return wallet.address;
  }

  /**
   * Unlock an existing wallet from keystore.
   */
  async unlock(password: string): Promise<string> {
    if (!fs.existsSync(this.keystorePath)) {
      throw new Error('No wallet found. Run setup first.');
    }
    const keystore = fs.readFileSync(this.keystorePath, 'utf-8');
    this.wallet = await ethers.Wallet.fromEncryptedJson(keystore, password) as ethers.Wallet;
    return this.wallet.address;
  }

  /**
   * Get the wallet connected to a provider.
   */
  connect(provider: ethers.Provider): ethers.Wallet {
    if (!this.wallet) throw new Error('Wallet not unlocked');
    return this.wallet.connect(provider);
  }

  /**
   * Get the wallet address (works even without provider).
   */
  get address(): string {
    return this.wallet?.address || '';
  }

  /**
   * Check if wallet exists on disk.
   */
  get exists(): boolean {
    return fs.existsSync(this.keystorePath);
  }

  /**
   * Check if wallet is unlocked.
   */
  get isUnlocked(): boolean {
    return this.wallet !== null;
  }

  /**
   * Export private key (for backup).
   */
  exportPrivateKey(): string {
    if (!this.wallet) throw new Error('Wallet not unlocked');
    return this.wallet.privateKey;
  }
}
