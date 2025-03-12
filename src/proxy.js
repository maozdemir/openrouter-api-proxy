import httpProxy from 'http-proxy';
import https from 'https';
import logger from './logger.js';
import KeyManager from './key-manager.js';

// Initialize key manager
const keyManager = new KeyManager('./config/api-keys.txt');

// Create a custom HTTPS agent
const agent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 256,
    maxFreeSockets: 256,
    timeout: 60000,
    rejectUnauthorized: false
});

// Create proxy server
const proxyServer = httpProxy.createProxyServer({
    target: {
        protocol: 'https:',
        host: 'openrouter.ai',
        port: 443,
        agent: agent
    },
    changeOrigin: true,
    secure: false,
    xfwd: true,
    timeout: 60000,
    proxyTimeout: 60000
});

let retryCount = 0;
const MAX_RETRIES = 3;

// Error handling with retry
proxyServer.on('error', (err, req, res) => {
    logger.error('Proxy error:', { 
        error: err.message, 
        code: err.code,
        method: req.method,
        url: req.url
    });

    if (err.code === 'ECONNRESET' && retryCount < MAX_RETRIES) {
        retryCount++;
        logger.info(`Retrying request (attempt ${retryCount})`);
        proxyRequest(req, res);
        return;
    }

    retryCount = 0;
    if (!res.headersSent) {
        res.writeHead(500);
        res.end('Proxy error occurred');
    }
});

// Response handling
proxyServer.on('proxyRes', async (proxyRes, req, res) => {
    retryCount = 0; // Reset retry count on successful response
    const statusCode = proxyRes.statusCode;

    // Handle rate limits and blacklisting
    if (statusCode === 429 && req.usedApiKey) {
        const resetTimestamp = proxyRes.headers['x-ratelimit-reset'];
        if (resetTimestamp) {
            keyManager.blacklistKeyUntil(req.usedApiKey, resetTimestamp);
            logger.warn(`Rate limited key blacklisted until ${new Date(parseInt(resetTimestamp)).toISOString()}`);
            
            // Retry with a different key
            const newKey = await keyManager.getRandomKey();
            if (newKey) {
                logger.info('Retrying with different API key');
                req.usedApiKey = newKey;
                proxyRequest(req, res);
                return;
            }
        }
    }

    // Log different levels based on status code
    if (statusCode >= 500) {
        logger.error(`Server error response: ${statusCode} for ${req.method} ${req.url}`);
    } else if (statusCode === 429) {
        logger.warn(`Rate limited: ${statusCode} for ${req.method} ${req.url}`);
    } else if (statusCode === 401) {
        logger.warn(`Unauthorized: ${statusCode} for ${req.method} ${req.url}`);
    } else if (statusCode >= 400) {
        logger.warn(`Client error: ${statusCode} for ${req.method} ${req.url}`);
    } else {
        logger.info(`Response: ${statusCode} for ${req.method} ${req.url}`);
    }

    // Log rate limit headers if present
    const remaining = proxyRes.headers['x-ratelimit-remaining'];
    const reset = proxyRes.headers['x-ratelimit-reset'];
    if (remaining !== undefined) {
        logger.info('Rate limit status:', {
            remaining,
            reset: reset ? new Date(parseInt(reset)).toISOString() : undefined
        });
    }
});

// Handle proxy request
proxyServer.on('proxyReq', (proxyReq, req, res, options) => {
    // Set keep-alive and host headers
    proxyReq.setHeader('Connection', 'keep-alive');
    proxyReq.setHeader('Host', 'openrouter.ai');

    // Set the API key from our rotation
    if (req.usedApiKey) {
        proxyReq.setHeader('Authorization', `Bearer ${req.usedApiKey}`);
        logger.debug('Using API key from rotation');
    }
});

// Function to make proxy request
const proxyRequest = async (req, res) => {
    try {
        // Get an API key if we don't have one yet
        if (!req.usedApiKey) {
            const apiKey = await keyManager.getRandomKey();
            if (!apiKey) {
                logger.error('No API keys available');
                res.writeHead(503);
                res.end('Service Unavailable: No API keys available');
                return;
            }
            req.usedApiKey = apiKey;
        }

        logger.info(`Forwarding ${req.method} request to ${req.url}`);
        proxyServer.web(req, res);
    } catch (error) {
        logger.error('Error in proxy request:', error);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end('Internal Server Error');
        }
    }
};

export default (req, res, next) => {
    proxyRequest(req, res);
};