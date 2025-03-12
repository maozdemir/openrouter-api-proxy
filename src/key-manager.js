import fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const watchFile = fs.watchFile;

class KeyManager {
    constructor(filePath) {
        this.filePath = filePath;
        this.apiKeys = [];
        this.blacklist = new Map(); // key -> expiration timestamp
        this.initialized = false;
        this.initPromise = this.init();
    }

    async init() {
        await this.loadKeys();
        this.initialized = true;

        // Watch for file changes
        watchFile(this.filePath, { persistent: true, interval: 5000 }, () => {
            this.loadKeys();
        });
    }

    async loadKeys() {
        try {
            const data = await readFile(this.filePath, 'utf8');
            this.apiKeys = data.trim().split('\n')
                .map(key => key.trim())
                .filter(key => key !== '');
            
            if (this.apiKeys.length === 0) {
                console.warn('No API keys found in:', this.filePath);
            }
            console.log(`Loaded ${this.apiKeys.length} API keys from ${this.filePath}`);
        } catch (err) {
            console.error('Error loading API keys:', err.message);
            this.apiKeys = [];
        }
    }

    blacklistKeyUntil(key, resetTimestamp) {
        this.blacklist.set(key, parseInt(resetTimestamp));
        const resetDate = new Date(parseInt(resetTimestamp));
        console.log(`API key ${key.substring(0, 6)}... blacklisted until ${resetDate.toISOString()}`);
    }

    isBlacklisted(key) {
        const resetTimestamp = this.blacklist.get(key);
        if (!resetTimestamp) return false;
        
        if (Date.now() >= resetTimestamp) {
            this.blacklist.delete(key);
            return false;
        }
        return true;
    }

    async getRandomKey() {
        if (!this.initialized) {
            await this.initPromise;
        }

        // Filter out blacklisted keys
        const availableKeys = this.apiKeys.filter(key => !this.isBlacklisted(key));
        
        if (availableKeys.length === 0) {
            return null;
        }

        const randomIndex = Math.floor(Math.random() * availableKeys.length);
        return availableKeys[randomIndex];
    }

    getBlacklistStatus() {
        const now = Date.now();
        const status = [];
        for (const [key, expiration] of this.blacklist.entries()) {
            if (now < expiration) {
                const minutesLeft = Math.ceil((expiration - now) / 60000);
                const resetDate = new Date(expiration);
                status.push(`${key.substring(0, 6)}... (resets at ${resetDate.toISOString()})`);
            }
        }
        return status;
    }
}

export default KeyManager;