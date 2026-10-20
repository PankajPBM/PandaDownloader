const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');

const LICENSE_SERVER = 'https://pblicense.prakashkushwaha77.com.np';
const TRIAL_SALT = 'PANDA_TRIAL_SECURE_SALT_v1_2026';
const TRIAL_DURATION_DAYS = 30;

class LicenseManager {
  constructor() {
    this.userDataPath = app ? app.getPath('userData') : process.cwd();
    this.licenseFile = path.join(this.userDataPath, 'panda_license.json');
    this.trialFile = path.join(this.userDataPath, 'panda_trial.dat');
    this.machineId = this.generateMachineId();
    this.licenseData = null;
    this.trialData = null;
    
    this.loadLocalLicense();
    this.initOrLoadTrial();
  }

  /**
   * Generates a stable hardware fingerprint tied to this physical machine
   */
  generateMachineId() {
    try {
      const parts = [
        os.hostname(),
        os.platform(),
        os.arch(),
        os.cpus()[0]?.model || 'UNKNOWN_CPU',
        os.totalmem()
      ];

      // Add network interface MAC addresses for stability
      const nics = os.networkInterfaces();
      for (const name of Object.keys(nics)) {
        for (const net of nics[name] || []) {
          if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
            parts.push(net.mac);
            break;
          }
        }
      }

      return crypto
        .createHash('sha256')
        .update(parts.join('###'))
        .digest('hex')
        .substring(0, 32)
        .toUpperCase();
    } catch (e) {
      return crypto.createHash('sha256').update(os.hostname()).digest('hex').substring(0, 32).toUpperCase();
    }
  }

  computeTrialHash(installedAt) {
    return crypto
      .createHmac('sha256', TRIAL_SALT)
      .update(`${this.machineId}::${installedAt}::${TRIAL_DURATION_DAYS}`)
      .digest('hex');
  }

  _getVaultKey() {
    return crypto.scryptSync(this.machineId + 'PANDA_HW_VAULT_2026_SECURE', 'pb_tech_zone_salt_9814891277', 32);
  }

  _encryptData(obj) {
    try {
      const key = this._getVaultKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const json = JSON.stringify(obj);
      let enc = cipher.update(json, 'utf8', 'hex');
      enc += cipher.final('hex');
      const tag = cipher.getAuthTag().toString('hex');
      return JSON.stringify({
        encrypted: true,
        version: 2,
        iv: iv.toString('hex'),
        tag: tag,
        data: enc
      });
    } catch (e) {
      return JSON.stringify(obj);
    }
  }

  _decryptData(raw) {
    try {
      if (!raw || typeof raw !== 'string') return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.encrypted && parsed.iv && parsed.tag && parsed.data) {
        const key = this._getVaultKey();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
        let dec = decipher.update(parsed.data, 'hex', 'utf8');
        dec += decipher.final('utf8');
        return JSON.parse(dec);
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  /**
   * Initialize or verify local 30-day trial with AES-256-GCM encrypted tamper resistance
   */
  initOrLoadTrial() {
    try {
      if (fs.existsSync(this.trialFile)) {
        const raw = fs.readFileSync(this.trialFile, 'utf-8');
        const parsed = this._decryptData(raw);

        // Verify integrity
        if (parsed) {
          const expectedHash = this.computeTrialHash(parsed.installedAt);
          if (parsed.hash === expectedHash && parsed.machineId === this.machineId) {
            // Anti-rollback check: system clock should not be significantly behind lastSeenAt
            const now = Date.now();
            const lastSeen = parsed.lastSeenAt ? new Date(parsed.lastSeenAt).getTime() : 0;
            if (now < lastSeen - (1000 * 60 * 60 * 2)) {
              // Clock rolled back by more than 2 hours
              console.warn('[LicenseManager] System clock rollback detected.');
              parsed.isTampered = true;
            }

            parsed.lastSeenAt = new Date().toISOString();
            this.trialData = parsed;
            this.saveTrial(this.trialData);
            return;
          }
        }
      }
    } catch (e) {
      console.warn('[LicenseManager] Error reading trial file:', e.message);
    }

    // First install or trial file missing: initialize fresh 30-day trial
    const nowIso = new Date().toISOString();
    const trialRecord = {
      installedAt: nowIso,
      trialDays: TRIAL_DURATION_DAYS,
      machineId: this.machineId,
      lastSeenAt: nowIso,
      hash: this.computeTrialHash(nowIso),
      isTampered: false
    };

    this.trialData = trialRecord;
    this.saveTrial(trialRecord);
  }

  saveTrial(data) {
    try {
      const encrypted = this._encryptData(data);
      fs.writeFileSync(this.trialFile, encrypted, 'utf-8');
    } catch (e) {
      console.error('[LicenseManager] Failed to save trial data:', e);
    }
  }

  loadLocalLicense() {
    try {
      if (fs.existsSync(this.licenseFile)) {
        const raw = fs.readFileSync(this.licenseFile, 'utf-8');
        this.licenseData = this._decryptData(raw);
      }
    } catch (e) {
      this.licenseData = null;
    }
  }

  saveLocalLicense(data) {
    try {
      this.licenseData = data;
      const encrypted = this._encryptData(data);
      fs.writeFileSync(this.licenseFile, encrypted, 'utf-8');
    } catch (e) {
      console.error('Failed to save local license:', e);
    }
  }

  clearLocalLicense() {
    try {
      this.licenseData = null;
      if (fs.existsSync(this.licenseFile)) {
        fs.unlinkSync(this.licenseFile);
      }
    } catch (e) {}
  }

  /**
   * Check if app is fully unlocked (via active license or active 30-day trial)
   */
  isAppUnlocked() {
    const info = this.getLicenseInfo();
    return info.isValid === true;
  }

  /**
   * Returns current license state
   */
  getLicenseInfo() {
    // 1. If user has an activated license key
    if (this.licenseData && this.licenseData.licenseKey) {
      const { licenseKey, customerName, licenseType, expiryDate, lastVerifiedAt } = this.licenseData;

      let isExpired = false;
      let formattedExpiry = 'Lifetime (No Expiry)';

      if (expiryDate && expiryDate !== 'Lifetime (No Expiry)') {
        const expMs = new Date(expiryDate).getTime();
        if (!isNaN(expMs)) {
          isExpired = expMs < Date.now();
          const d = new Date(expiryDate);
          formattedExpiry = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      }

      const effectiveType = licenseType || (expiryDate ? 'SUBSCRIPTION' : 'PERPETUAL');

      return {
        isValid: !isExpired,
        isLicensed: true,
        isTrial: false,
        isExpired,
        trialDaysRemaining: 0,
        machineId: this.machineId,
        customerName: customerName || 'Valued Customer',
        licenseKey: licenseKey,
        licenseType: effectiveType,
        expiryDate: formattedExpiry,
        rawExpiryDate: expiryDate || null,
        lastVerifiedAt: lastVerifiedAt || null,
        status: isExpired ? 'License Expired' : 'Active (Licensed)',
        reason: isExpired ? 'Your license has expired. Please contact support on WhatsApp to renew.' : null
      };
    }

    // 2. Fallback: 30-day trial calculation
    if (!this.trialData) {
      this.initOrLoadTrial();
    }

    const installedMs = this.trialData?.installedAt ? new Date(this.trialData.installedAt).getTime() : Date.now();
    const trialTotalMs = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
    const elapsedMs = Math.max(0, Date.now() - installedMs);
    const msRemaining = trialTotalMs - elapsedMs;
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
    const trialExpiryDate = new Date(installedMs + trialTotalMs).toISOString();
    const isTrialExpired = (daysRemaining <= 0) || Boolean(this.trialData?.isTampered);

    return {
      isValid: !isTrialExpired,
      isLicensed: false,
      isTrial: true,
      isExpired: isTrialExpired,
      trialDaysRemaining: daysRemaining,
      trialExpiryDate: trialExpiryDate,
      installedAt: this.trialData?.installedAt || new Date().toISOString(),
      machineId: this.machineId,
      customerName: 'Trial User',
      licenseKey: null,
      licenseType: '30-DAY TRIAL',
      expiryDate: trialExpiryDate,
      lastVerifiedAt: this.trialData?.lastSeenAt || null,
      status: isTrialExpired ? 'Trial Expired' : `Trial (${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left)`,
      reason: isTrialExpired 
        ? 'Your 30-Day Free Trial has expired. Please activate your license to continue using Panda Downloader.' 
        : null
    };
  }

  /**
   * Online Activation via Cloudflare Authority Server
   */
  async activateOnline(licenseKey) {
    if (!licenseKey || typeof licenseKey !== 'string') {
      return { success: false, message: 'Please enter a valid license key.' };
    }

    const cleanKey = licenseKey.trim().toUpperCase();

    try {
      const response = await fetch(`${LICENSE_SERVER}/api/v1/activate-online`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: cleanKey,
          machineHash: this.machineId,
          hostName: os.hostname(),
          clientVersion: app ? app.getVersion() : '1.1.0'
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return {
          success: false,
          message: data.message || 'Activation failed. Please check your key or contact support.'
        };
      }

      // Parse fields returned directly by server API
      let customerName = data.customerName || data.CustomerName || data.customer_name || 'Licensed User';
      let expiryDate = data.expiryUtc || data.expiryDate || data.ExpiryDate || data.expiry_utc || null;
      let licenseType = data.licenseType || data.LicenseType || data.license_type || (expiryDate ? 'SUBSCRIPTION' : 'PERPETUAL');

      // Also parse envelope token details if present
      if (data.licenseFileContent) {
        try {
          const parsedEnvelope = JSON.parse(data.licenseFileContent);
          if (parsedEnvelope.CustomerName || parsedEnvelope.customer_name) {
            customerName = parsedEnvelope.CustomerName || parsedEnvelope.customer_name;
          }
          if (parsedEnvelope.ExpiryDate || parsedEnvelope.expiry_date || parsedEnvelope.ExpiryUtc || parsedEnvelope.expiry_utc) {
            expiryDate = parsedEnvelope.ExpiryDate || parsedEnvelope.expiry_date || parsedEnvelope.ExpiryUtc || parsedEnvelope.expiry_utc;
          }
          if (parsedEnvelope.LicenseType || parsedEnvelope.license_type) {
            licenseType = parsedEnvelope.LicenseType || parsedEnvelope.license_type;
          }
        } catch (e) {}
      }

      const record = {
        licenseKey: cleanKey,
        customerName,
        licenseType,
        expiryDate,
        licenseFileContent: data.licenseFileContent,
        activatedAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString()
      };

      this.saveLocalLicense(record);

      return {
        success: true,
        message: 'Panda Downloader successfully activated!',
        info: this.getLicenseInfo()
      };
    } catch (err) {
      return {
        success: false,
        message: 'Could not connect to PB License Authority server. Check your internet connection.'
      };
    }
  }

  /**
   * Heartbeat check on startup
   */
  async checkHeartbeat() {
    if (!this.licenseData || !this.licenseData.licenseKey) return;

    try {
      const response = await fetch(`${LICENSE_SERVER}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: this.licenseData.licenseKey,
          machineHash: this.machineId
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        if (data.valid === false || data.is_active === 0) {
          if (data.reason === 'EXPIRED') {
            this.licenseData.isExpired = true;
            this.licenseData.expiryDate = data.expiryUtc || data.expiryDate || this.licenseData.expiryDate;
            this.saveLocalLicense(this.licenseData);
          } else {
            // Admin suspended or revoked this license remotely
            this.clearLocalLicense();
            console.warn('[LicenseManager] License was revoked remotely by administrator.');
          }
        } else {
          // Sync live attributes from server
          if (data.customerName) this.licenseData.customerName = data.customerName;
          if (data.licenseType) this.licenseData.licenseType = data.licenseType;
          if (data.expiryUtc !== undefined || data.expiryDate !== undefined) {
            this.licenseData.expiryDate = data.expiryUtc || data.expiryDate || null;
            if (this.licenseData.expiryDate && (!this.licenseData.licenseType || this.licenseData.licenseType === 'PERPETUAL')) {
              this.licenseData.licenseType = 'SUBSCRIPTION';
            }
          }
          this.licenseData.lastVerifiedAt = new Date().toISOString();
          this.saveLocalLicense(this.licenseData);
        }
      }
    } catch (e) {
      // Offline grace: allow app to continue running without network check
      console.log('[LicenseManager] Heartbeat skipped (offline mode).');
    }
  }

  /**
   * Sync license with authority server
   */
  async syncLicense() {
    if (!this.licenseData || !this.licenseData.licenseKey) {
      return { success: false, message: 'No active license to sync.' };
    }
    await this.checkHeartbeat();
    return {
      success: true,
      info: this.getLicenseInfo()
    };
  }

  /**
   * Deactivate license on this PC
   */
  async deactivate() {
    if (!this.licenseData || !this.licenseData.licenseKey) {
      this.clearLocalLicense();
      return { success: true };
    }

    const currentKey = this.licenseData.licenseKey;

    try {
      await fetch(`${LICENSE_SERVER}/api/v1/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: currentKey,
          machineHash: this.machineId
        })
      });
    } catch (e) {}

    this.clearLocalLicense();
    return { success: true, message: 'License deactivated successfully.' };
  }
}

module.exports = new LicenseManager();
