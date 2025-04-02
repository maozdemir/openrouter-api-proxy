import httpProxy from 'http-proxy';
import https from 'https';
import logger from './logger.js';
import KeyManager from './key-manager.js';
import { Readable } from 'stream';

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

// Buffer the request body
const bufferRequestBody = async (req) => {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
        });
        req.on('end', () => {
            resolve(body);
        });
        req.on('error', reject);
    });
};

// Response handling
proxyServer.on('proxyRes', async (proxyRes, req, res) => {
    retryCount = 0; // Reset retry count on successful response
    let body = '';
    proxyRes.on('data', chunk => {
        body += chunk;
    });

    proxyRes.on('end', async () => {
        const statusCode = proxyRes.statusCode;
        const contentType = proxyRes.headers['content-type'] || '';
        
        // For SSE responses, try to extract JSON data
        if (contentType.includes('text/event-stream')) {
            const sseData = body.split('\n\n').filter(chunk => chunk.startsWith('data: ')).map(chunk => {
                return chunk.replace('data: ', '');
            });
            body = sseData[sseData.length - 1] || body;
        }

        // Log the response with body
        logger.logResponse({ statusCode: proxyRes.statusCode, headers: proxyRes.headers }, body);

        let shouldRetry = false;
        try {
            if (body) {
                const responseBody = JSON.parse(body);
                // Handle provider errors
                if (responseBody.error?.message === 'Provider returned error' || 
                    (responseBody.error?.code === 429 && responseBody.error?.message?.includes('Provider returned error'))) {
                    logger.warn('Provider error detected, will retry request');
                    shouldRetry = true;
                }

                // Handle rate limits
                else if (responseBody.error?.message?.includes('Rate limit exceeded')) {
                    const metadataHeaders = responseBody.error?.metadata?.headers;
                    if (metadataHeaders && metadataHeaders['X-RateLimit-Reset']) {
                        const resetTimestamp = metadataHeaders['X-RateLimit-Reset'];
                        keyManager.blacklistKeyUntil(req.usedApiKey, resetTimestamp);
                        logger.warn(`Rate limited key blacklisted until ${new Date(parseInt(resetTimestamp)).toISOString()} (ends with: ${req.usedApiKey.slice(-6)})`);
                        shouldRetry = true;
                    }
                }
            }
        } catch (e) {
            logger.error('Error parsing response body:', e);
        }

        // if (shouldRetry) {
        //     // Get a new key for retry
        //     const newKey = await keyManager.getRandomKey();
        //     if (newKey) {
        //         logger.info('Retrying with different API key');
        //         // Store the original request body
        //         if (!req.bufferedBody) {
        //             req.bufferedBody = await bufferRequestBody(req);
        //         }
        //         // Create a new readable stream from the buffered body
        //         const newReq = Object.assign({}, req, {
        //             body: req.bufferedBody,
        //         });
        //         // Set up the new stream
        //         if (req.bufferedBody) {
        //             newReq.pipe = () => {};
        //             const bodyStream = new Readable();
        //             bodyStream.push(req.bufferedBody);
        //             bodyStream.push(null);
        //             newReq.pipe = (target) => bodyStream.pipe(target);
        //         }
        //         newReq.usedApiKey = newKey;
        //         proxyRequest(newReq, res);
        //         return;
        //     } else {
        //         if (shouldRetry) {
        //             // If we should retry but have no keys, send a more appropriate error
        //             logger.error('No API keys available for retry - sending 503');
        //             res.writeHead(503, {
        //                 'Content-Type': 'application/json'
        //             });
        //             res.end(JSON.stringify({ error: { message: 'Service temporarily unavailable - no API keys available' } }));
        //             return;
        //         }
        //         logger.error('No API keys available for retry');
        //     }
        // }

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
});

// Handle proxy request
proxyServer.on('proxyReq', async (proxyReq, req, res, options) => {
    // Set keep-alive and host headers
    proxyReq.setHeader('Connection', 'keep-alive');
    proxyReq.setHeader('Host', 'openrouter.ai');

    // Set the API key from our rotation
    if (req.usedApiKey) {
        proxyReq.setHeader('Authorization', `Bearer ${req.usedApiKey}`);
        logger.debug('Using API key from rotation');
    }

    // If we have a buffered body from a retry, write it to the proxy request
    if (req.bufferedBody) {
        proxyReq.write(req.bufferedBody);
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
        
        // Log the incoming request
        logger.logRequest(req);

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