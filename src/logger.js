import winston from 'winston';
import 'winston-daily-rotate-file';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
);

const transport = new winston.transports.DailyRotateFile({
    filename: process.env.LOG_FILE || 'logs/proxy-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat
});

const winstonLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [transport]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
    winstonLogger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

function sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    if (sanitized.authorization) {
        sanitized.authorization = sanitized.authorization.substring(0, 12) + '...';
    }
    return sanitized;
}

function logRequest(req) {
    const logData = {
        type: 'request',
        method: req.method,
        url: req.url,
        headers: sanitizeHeaders(req.headers)
    };

    if (process.env.LOG_BODIES === 'true' && req.body) {
        logData.body = req.body;
    }

    winstonLogger.info('Incoming request', logData);
}

function logResponse(res, responseBody) {
    const logData = {
        type: 'response',
        statusCode: res.statusCode,
        headers: sanitizeHeaders(res.headers || {})
    };

    if (process.env.LOG_BODIES === 'true' && responseBody) {
        try {
            logData.body = JSON.parse(responseBody);
        } catch {
            logData.body = responseBody.substring(0, 1000) + '...';
        }
    }

    winstonLogger.info('Outgoing response', logData);
}

// Export wrapper functions that use the winston logger
const logger = {
    error: (...args) => winstonLogger.error(...args),
    warn: (...args) => winstonLogger.warn(...args),
    info: (...args) => winstonLogger.info(...args),
    debug: (...args) => winstonLogger.debug(...args),
    logRequest,
    logResponse
};

export default logger;